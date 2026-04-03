import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { summarizeSourceContent } from "./groq.js";
import { Innertube } from "youtubei.js";

let youtube;

async function getYoutubeClient() {
  if (!youtube) {
    youtube = await Innertube.create();
  }
  return youtube;
}

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
        "Accept-Language": "en-US,en;q=0.9",
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

async function fetchYoutubeTranscript(videoId) {
  if (!videoId) return "";

  try {
    const yt = await getYoutubeClient();
    async function withAsyncTimeout(promise, ms = 10000) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), ms)
      );
      return Promise.race([promise, timeout]);
    }

    const info = await withAsyncTimeout(yt.getInfo(videoId));
    const transcriptData = await info.getTranscript();

    const segments =
      transcriptData?.transcript?.content?.body?.initial_segments || [];

    return segments
      .map((s) => cleanText(s.snippet?.text))
      .filter(Boolean)
      .join(" ");
  } catch (err) {
    console.error("Youtube Transcript Failed:", err.message);
    return "";
  }
}

async function extractYoutube(urlObj) {
  const videoId = getYoutubeId(urlObj);
  const canonicalUrl = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : urlObj.toString();
  const html = await fetchText(canonicalUrl);
  const metaDescription = parseMetaDescription(html);
  const shortDescription = parseShortDescription(html);
  const transcript = await fetchYoutubeTranscript(videoId);
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const title =
    cleanText((titleMatch ? titleMatch[1] : "").replace("- YouTube", "")) ||
    "YouTube video";
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
