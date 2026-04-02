import { Router } from "express";
import { generateSlides } from "../services/groq.js";
import { insertHistory } from "../db/index.js";
import { normalizeInputForGeneration } from "../services/ingestion.js";

const router = Router();

router.post("/", async (req, res) => {
  const { input, tone } = req.body;

  if (!input || typeof input !== "string" || !input.trim()) {
    return res.status(400).json({ error: "Input is required" });
  }

  const strategy =
    tone && typeof tone === "string" && tone.trim() ? tone : "Viral Hook";
  const { vibe } = req.body;

  try {
    const normalized = await normalizeInputForGeneration(input.trim());
    const slides = await generateSlides(
      normalized.preparedInput,
      strategy.trim(),
    );
    const resultJson = JSON.stringify({ slides });
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    insertHistory(input.trim(), strategy.trim(), resultJson, ip, vibe).catch(() => {});
    res.json({
      slides,
      source: {
        type: normalized.sourceType,
        url: normalized.sourceUrl,
        title: normalized.sourceTitle,
      },
    });
  } catch (err) {
    console.error("AI Generation Error:", JSON.stringify(err, null, 2) || err);
    
    let userMessage = "Failed to generate slides. Please try again.";
    const rawError = err?.error || err;
    const code = rawError?.code || "";
    const message = rawError?.message || "";

    if (code === "rate_limit_exceeded") {
      userMessage = "AI service is currently busy (rate limit). Please wait a moment.";
    } else if (message.includes("TPM") || message.includes("tokens per minute")) {
      userMessage = "Input is too long for the AI to process. Please try a shorter idea.";
    } else if (message.includes("billing") || message.includes("quota")) {
      userMessage = "AI service quota exceeded. Falling back to template mode.";
    }

    res.status(500).json({ 
      error: userMessage,
      debug: {
        raw: message,
        code: code,
        full: err
      }
    });
  }
});

export default router;
