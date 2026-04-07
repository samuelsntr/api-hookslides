import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { summarizeSourceContent } from "./groq.js";
import { Innertube } from "youtubei.js";

const FETCH_TIMEOUT_MS = 12000;

function withTimeout(ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(id) };
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function isLikelyUrl(value) {
  if (!value || typeof value !== "string") return false;
  return /^https?:\/\//i.test(value.trim());
}

function getSafeUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are supported.");
  }
  return parsed;
}

function isYoutubeUrl(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  return (
    host.includes("youtube.com") ||
    host.includes("youtu.be") ||
    host.includes("youtube-nocookie.com")
  );
}

function getYoutubeId(urlObj) {
  const host = urlObj.hostname.toLowerCase();
  if (host.includes("youtu.be")) {
    return urlObj.pathname.replace("/", "").trim();
  }
  if (urlObj.searchParams.get("v")) {
    return urlObj.searchParams.get("v");
  }
  const parts = urlObj.pathname.split("/").filter(Boolean);
  const embedIndex = parts.findIndex(
    (part) => part === "embed" || part === "shorts",
  );
  if (embedIndex >= 0 && parts[embedIndex + 1]) {
    return parts[embedIndex + 1];
  }
  return "";
}

async function fetchText(url) {
  const { controller, clear } = withTimeout();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        Referer: "https://www.google.com/",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch URL (${res.status})`);
    }
    return await res.text();
  } finally {
    clear();
  }
}

function cleanupReaderMirrorText(markdown) {
  const text = cleanText(markdown || "");
  return text
    .replace(/^title:\s*/i, "")
    .replace(/^url source:\s*/i, "")
    .replace(/^markdown content:\s*/i, "")
    .trim();
}

function extractMirrorTitle(markdown, fallbackUrl) {
  const lines = (markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => line.startsWith("# "));
  if (heading) {
    return cleanText(heading.replace(/^#+\s*/, "")).slice(0, 140);
  }
  try {
    const host = new URL(fallbackUrl).hostname.replace(/^www\./, "");
    return `Article from ${host}`;
  } catch {
    return "Untitled article";
  }
}

async function fetchArticleViaMirror(url) {
  const mirroredUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
  const markdown = await fetchText(mirroredUrl);
  const cleaned = cleanupReaderMirrorText(markdown);
  if (!cleaned) {
    throw new Error("Mirror extraction returned empty content.");
  }
  const firstLine = cleaned.split("\n")[0] || "";
  return {
    sourceType: "article",
    sourceTitle:
      extractMirrorTitle(markdown, url) ||
      cleanText(firstLine).slice(0, 140) ||
      "Untitled article",
    extractedText: cleaned.slice(0, 30000),
  };
}

async function extractArticle(url) {
  try {
    const html = await fetchText(url);
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();
    let title = cleanText(parsed?.title || dom.window.document.title || "");
    let body = cleanText(parsed?.textContent || "");
    if (!body) {
      body = cleanText(dom.window.document.body?.textContent || "");
    }
    if (!title) {
      title = "Untitled article";
    }
    if (!body) {
      throw new Error(
        "Could not extract readable content from this article URL.",
      );
    }
    return {
      sourceType: "article",
      sourceTitle: title,
      extractedText: `${title}\n\n${body}`.slice(0, 30000),
    };
  } catch (err) {
    const message = typeof err?.message === "string" ? err.message : "";
    if (
      message.includes("(403)") ||
      message.includes("(401)") ||
      message.includes("(406)")
    ) {
      return fetchArticleViaMirror(url);
    }
    throw err;
  }
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function parseMetaDescription(html) {
  const m =
    html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
    ) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  return m ? cleanText(m[1]) : "";
}

function parseShortDescription(html) {
  const m = html.match(/"shortDescription":"([\s\S]*?)"/);
  return m ? cleanText(decodeJsonString(m[1])) : "";
}

function stripTags(value) {
  return cleanText(value.replace(/<[^>]+>/g, " "));
}

/**
 * Extract the video title from the YouTube watch page HTML.
 * Tries multiple sources in order of reliability:
 *   1. og:title meta tag  (always the clean video title)
 *   2. ytInitialData videoPrimaryInfoRenderer title runs
 *   3. <title> tag (strip " - YouTube" suffix)
 */
function parseYoutubeTitle(html) {
  // 1. og:title (most reliable — always the plain video title without suffix)
  const ogTitleMatch =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
  if (ogTitleMatch) {
    const t = cleanText(ogTitleMatch[1]);
    if (t) return t;
  }

  // 2. ytInitialData title runs embedded in the page JS
  const ytTitleMatch = html.match(/"videoPrimaryInfoRenderer".*?"title":\{"runs":\[\{"text":"([^"]+)"/);
  if (ytTitleMatch) {
    const t = cleanText(ytTitleMatch[1]);
    if (t) return t;
  }

  // 3. <title> tag fallback
  const titleTagMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleTagMatch) {
    const t = cleanText(
      titleTagMatch[1]
        .replace(/\s*[-–|]\s*YouTube\s*$/i, "")
        .replace(/\s*-\s*YouTube\s*$/i, ""),
    );
    if (t) return t;
  }

  return "";
}

/**
 * Method 1: Extract caption track URL from the video page HTML and fetch
 * the transcript XML directly via YouTube's timedtext endpoint.
 * This avoids the Innertube API entirely and is less likely to be blocked.
 */
async function fetchTranscriptFromCaptionTrack(videoId, html) {
  // Parse the captionTracks array from the serialized ytInitialPlayerResponse
  const captionTracksMatch = html.match(/"captionTracks":(\[.*?\])/s);
  if (!captionTracksMatch) return "";

  let captionTracks;
  try {
    captionTracks = JSON.parse(captionTracksMatch[1]);
  } catch {
    return "";
  }

  if (!captionTracks || captionTracks.length === 0) return "";

  // Prefer English, fall back to first available
  const track =
    captionTracks.find(
      (t) => (t.languageCode === "en" || t.languageCode === "id") && !t.kind,
    ) ||
    captionTracks.find((t) => t.languageCode === "en" || t.languageCode === "id") ||
    captionTracks[0];

  if (!track?.baseUrl) return "";

  // Fetch the transcript XML
  const { controller, clear } = withTimeout(10000);
  try {
    const res = await fetch(track.baseUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
      },
    });
    if (!res.ok) return "";
    const xml = await res.text();
    // Parse <text> nodes from XML
    const matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
    return matches
      .map((m) =>
        cleanText(
          m[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/<[^>]+>/g, " "),
        ),
      )
      .filter(Boolean)
      .join(" ");
  } finally {
    clear();
  }
}

/**
 * Method 2: Use youtubei.js Innertube client (works well locally,
 * may be blocked from cloud datacenter IPs).
 */
async function fetchTranscriptViaInnertube(videoId) {
  async function withAsyncTimeout(promise, ms = 10000) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms),
    );
    return Promise.race([promise, timeout]);
  }
  const yt = await Innertube.create();
  const info = await withAsyncTimeout(yt.getInfo(videoId));
  const transcriptData = await info.getTranscript();
  const segments =
    transcriptData?.transcript?.content?.body?.initial_segments || [];
  return segments
    .map((s) => cleanText(s.snippet?.text))
    .filter(Boolean)
    .join(" ");
}

/**
 * Method 3: Use Supadata API — a managed service that reliably fetches
 * YouTube transcripts from production/cloud environments.
 * Requires SUPADATA_API_KEY env variable. Free tier: 100 req/month.
 * Sign up at https://supadata.ai
 */
async function fetchTranscriptViaSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error("SUPADATA_API_KEY not configured");

  // Safeguard: Only use Supadata in production or if explicitly forced
  const isProd = process.env.NODE_ENV === "production";
  const forceLocal = process.env.ALLOW_SUPADATA_LOCAL === "true";
  
  if (!isProd && !forceLocal) {
    console.log("[Transcript] Skipping Supadata fallback because environment is not production.");
    return "";
  }

  const { controller, clear } = withTimeout(15000);
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=true`,
      {
        signal: controller.signal,
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) throw new Error(`Supadata API error: ${res.status}`);
    const data = await res.json();
    // data.content is an array of { text, offset, duration } objects
    if (Array.isArray(data.content)) {
      return data.content
        .map((seg) => cleanText(seg.text))
        .filter(Boolean)
        .join(" ");
    }
    // Some responses return a plain text field
    if (typeof data.content === "string") return cleanText(data.content);
    return "";
  } finally {
    clear();
  }
}

/**
 * Main transcript fetcher — tries multiple methods in order:
 * 1. Parse caption track from video page HTML (no Innertube, least blocked)
 * 2. youtubei.js Innertube API (reliable locally)
 * 3. Supadata managed API (reliable in production cloud, needs API key)
 */
async function fetchYoutubeTranscript(videoId, pageHtml = "") {
  if (!videoId) return "";

  // Method 1: caption track URL from page HTML
  try {
    const transcript = await fetchTranscriptFromCaptionTrack(videoId, pageHtml);
    if (transcript) {
      console.log("[Transcript] Method 1 (caption track) succeeded.");
      return transcript;
    }
  } catch (err) {
    console.warn("[Transcript] Method 1 failed:", err.message);
  }

  // Method 2: youtubei.js Innertube
  try {
    const transcript = await fetchTranscriptViaInnertube(videoId);
    if (transcript) {
      console.log("[Transcript] Method 2 (Innertube) succeeded.");
      return transcript;
    }
  } catch (err) {
    console.warn("[Transcript] Method 2 (Innertube) failed:", err.message);
  }

  // Method 3: Supadata API (production-reliable, requires API key)
  try {
    const transcript = await fetchTranscriptViaSupadata(videoId);
    if (transcript) {
      console.log("[Transcript] Method 3 (Supadata) succeeded.");
      return transcript;
    }
  } catch (err) {
    console.warn("[Transcript] Method 3 (Supadata) failed:", err.message);
  }

  console.error("[Transcript] All methods failed for video:", videoId);
  return "";
}

async function extractYoutube(urlObj) {
  const videoId = getYoutubeId(urlObj);
  const canonicalUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : urlObj.toString();
  const html = await fetchText(canonicalUrl);
  const metaDescription = parseMetaDescription(html);
  const shortDescription = parseShortDescription(html);
  // Pass the already-fetched HTML so Method 1 can parse caption tracks without an extra request
  const transcript = await fetchYoutubeTranscript(videoId, html);
  const title = parseYoutubeTitle(html) || "YouTube Video";
  const combined = [title, shortDescription, metaDescription, transcript]
    .map(cleanText)
    .filter(Boolean)
    .join("\n\n");
  if (!combined) {
    throw new Error("Could not extract usable content from this YouTube URL.");
  }
  return {
    sourceType: "youtube",
    sourceTitle: title,
    extractedText: combined.slice(0, 30000),
  };
}

export async function normalizeInputForGeneration(userInput) {
  const trimmed = (userInput || "").trim();
  if (!trimmed) {
    throw new Error("Input is required");
  }
  if (!isLikelyUrl(trimmed)) {
    return {
      sourceType: "text",
      sourceUrl: null,
      sourceTitle: null,
      extractedText: trimmed,
      preparedInput: trimmed,
    };
  }
  const urlObj = getSafeUrl(trimmed);
  const extracted = isYoutubeUrl(urlObj)
    ? await extractYoutube(urlObj)
    : await extractArticle(urlObj.toString());
  const summarized = await summarizeSourceContent(
    extracted.sourceType,
    extracted.extractedText,
  );
  return {
    sourceType: extracted.sourceType,
    sourceUrl: urlObj.toString(),
    sourceTitle: extracted.sourceTitle,
    extractedText: extracted.extractedText,
    preparedInput: summarized,
  };
}
