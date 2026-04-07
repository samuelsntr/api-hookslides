import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

function getCandidateModels() {
  return Array.from(
    new Set(
      [
        process.env.GROQ_MODEL,
        "openai/gpt-oss-120b",
        "llama-3.1-8b-instant",
        "llama3-8b-8192",
        "llama3-70b-8192",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
      ].filter(Boolean),
    ),
  );
}

async function runGroqPrompt(prompt, temperature = 0.7) {
  const candidateModels = getCandidateModels();
  let response;
  let lastErr;
  for (const model of candidateModels) {
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt },
        ],
        temperature,
      });
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const code = err?.error?.code || err?.code;
      const message = typeof err?.message === "string" ? err.message : "";
      const lower = message.toLowerCase();
      const retryableModelError =
        code === "model_decommissioned" ||
        lower.includes("model_decommissioned") ||
        lower.includes("decommissioned") ||
        lower.includes("no longer supported");
      if (!retryableModelError) {
        throw err;
      }
    }
  }
  if (!response) {
    const message =
      typeof lastErr?.message === "string"
        ? lastErr.message
        : "All Groq models failed.";
    throw new Error(message);
  }
  return response.choices[0]?.message?.content ?? "";
}

export async function summarizeSourceContent(sourceType, sourceText) {
  const trimmed = (sourceText || "").trim().slice(0, 20000);
  if (!trimmed) {
    throw new Error("Source content is empty after extraction.");
  }
  const prompt = `You are a content analyst.

Task:
Detect the primary language of the source content (English or Indonesian) and summarize it into concise creator-ready notes for an Instagram carousel writer IN THAT DETECTED LANGUAGE.

Rules:
- Keep all important facts and key ideas
- Keep chronology if the source is story-based
- Write entirely in the same language as the source (English or Indonesian).
- If Indonesian, use natural, conversational language (Bahasa Indonesia gaul/kasual tapi profesional, tidak kaku).
- Do not include emojis
- Do not include hashtags
- Return plain text only
- Keep output between 220 and 420 words

Source type: ${sourceType}

Source content:
${trimmed}

Output format:
Title:
Main points:
- ...
- ...
- ...
Key insights:
- ...
- ...
Actionable takeaways:
- ...
- ...
`;
  const content = await runGroqPrompt(prompt, 0.4);
  return content.trim();
}

export async function generateSlides(input, tone) {
  const prompt = `You are a world-class Instagram content strategist specializing in high-performing carousel posts.

Your goal is to transform raw input into a scroll-stopping, highly engaging Instagram carousel.

OBJECTIVE:
Create a carousel that:
- Grabs attention instantly
- Keeps users swiping
- Delivers clear, valuable insights
- Feels natural, human, and non-generic

PERFORMANCE GOAL:
- Slide 1 must create strong curiosity, tension, or surprise
- Each slide should make the user want to continue
- Optimize for saves, shares, and engagement
- Avoid generic or obvious advice

REQUIREMENTS:
- EXACTLY 6 slides
- Each slide:
  - title (max 6 words)
  - body (max 30 words, 1–2 short sentences)
- Keep wording concise, clear, and natural
- Avoid repeating sentence patterns across slides

FLOW STRUCTURE:

Slide 1 — Hook
- Very short, punchy title (max 5–6 words)
- Create curiosity, tension, or a bold claim
- Body must feel intriguing and make users want to swipe
- No list formatting

Slide 2 — Problem / Context
- Clearly describe a relatable pain, mistake, or situation
- Make the reader feel the problem
- No list formatting

Slides 3–5 — Value
- Focus on meaningful, non-generic insights
- Each slide must contain ONE clear idea
- EXACTLY ONE of these slides MUST include exactly 3 short takeaways
- These 3 takeaways must be extremely concise (max 7-10 words each)
- Format naturally (no numbering, no heavy lists)
- Avoid generic advice like “be consistent” or “work hard”

Slide 6 — CTA
- Provide a clear, natural call to action
- Make it relevant to the content
- Avoid generic CTAs like “follow for more”

CONTENT STRATEGY:
${tone}

STRATEGY EXECUTION RULES:

If strategy is "Viral Hook":
- Use bold, surprising, or curiosity-driven statements
- Prioritize attention and emotional impact

If strategy is "Storytelling":
- Use a narrative flow with emotion and relatability
- Make it feel personal and human

If strategy is "Authority":
- Use confident, insightful statements
- Present structured thinking or strong perspectives

If strategy is "Actionable Value":
- Focus on practical, useful insights
- Make content feel immediately applicable

If strategy is "Contrarian":
- Challenge common beliefs
- Use bold, opinionated statements (but still logical)

LANGUAGE & STYLE RULES:
- IMPORTANT: First, detect the primary language of the INPUT (English or Indonesian).
- You MUST write the entire carousel in that EXACT SAME language.
- If English: Use simple, clean syntax. Short, punchy sentences.
- If Indonesian: Gunakan Bahasa Indonesia yang natural, asik, tidak kaku, dan mudah dicerna (seperti gaya tulisan creator lokal populer). Hindari gaya bahasa mesin/terjemahan kaku. Gunakan kata ganti santai yang profesional (seperti 'kamu' atau 'kita').
- Short, clean sentences (Kalimat pendek dan padat)
- No emojis
- No hashtags
- No filler phrases
- Avoid repetition
- Avoid generic statements

FLOW RULE:
- Ensure each slide naturally connects to the next
- Maintain logical or narrative progression
- Avoid disconnected ideas

INPUT:
${input}

OUTPUT:
Return ONLY valid JSON.
Do not include explanations.
Do not wrap in code fences.
Do not include extra keys.

{
  "slides": [
    { "title": "", "body": "" },
    { "title": "", "body": "" },
    { "title": "", "body": "", "takeaways": ["", "", ""] },
    { "title": "", "body": "" },
    { "title": "", "body": "" },
    { "title": "", "body": "" }
  ]
}
Note: The "takeaways" key should only appear in EXACTLY ONE of the slides (Slide 3, 4, or 5).`;

  const raw = await runGroqPrompt(prompt, 0.8);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse AI response");
  }
  if (!data.slides || !Array.isArray(data.slides) || data.slides.length !== 6) {
    throw new Error("AI response does not contain 6 slides");
  }
  return data.slides;
}
