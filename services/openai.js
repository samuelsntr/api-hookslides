// import OpenAI from "openai";
// import dotenv from "dotenv";

// dotenv.config();

// const client = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// export async function generateSlides(input, tone) {
//   const prompt = `You are a world-class Instagram content strategist specializing in viral carousel posts.

// Your goal is to transform raw input into a high-performing Instagram carousel.

// OBJECTIVE:
// Convert the input into a carousel that is:
// - Engaging
// - Easy to read
// - Valuable

// REQUIREMENTS:
// - EXACTLY 6 slides
// - Each slide:
//   - title (max 10 words)
//   - body (max 35 words, 1-3 short sentences)
// - Keep wording complete, natural, and non-repetitive
// - Do not repeat the same sentence pattern across slides

// STRUCTURE:
// Slide 1: Hook (attention-grabbing)
//   - Body must be a concise standalone statement
//   - No list formatting
// Slide 2: Problem or Context
//   - Body explains pain point or situation clearly
//   - No list formatting
// Slides 3-5: Key Ideas (one idea per slide)
//   - Body gives one concrete value point per slide
//   - No numbered list syntax in JSON body
//   - Keep idea distinct from other slides
// Slide 6: CTA (encourage engagement)
//   - Body gives one clear call to action
//   - No list formatting

// CONTENT STRATEGY:
// ${tone}

// STYLE:
// - Simple English
// - Short sentences
// - No emojis
// - No hashtags
// - Avoid filler phrases
// - Avoid duplicated wording between slides

// INPUT:
// ${input}

// OUTPUT:
// Return ONLY valid JSON:

// {
//   "slides": [
//     { "title": "", "body": "" },
//     { "title": "", "body": "" },
//     { "title": "", "body": "" },
//     { "title": "", "body": "" },
//     { "title": "", "body": "" },
//     { "title": "", "body": "" }
//   ]
// }`;

//   const response = await client.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [
//       { role: "system", content: "You are a helpful assistant." },
//       { role: "user", content: prompt },
//     ],
//     response_format: { type: "json_object" },
//   });

//   const raw = response.choices[0]?.message?.content ?? "";
//   let data;
//   try {
//     data = JSON.parse(raw);
//   } catch {
//     throw new Error("Failed to parse AI response");
//   }
//   if (!data.slides || !Array.isArray(data.slides) || data.slides.length !== 6) {
//     throw new Error("AI response does not contain 6 slides");
//   }
//   return data.slides;
// }
