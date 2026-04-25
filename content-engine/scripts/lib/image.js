/**
 * Image generation utilities
 * Primary: Nano Banana (Gemini image generation)
 * Fallback: DALL-E 3
 */

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GEMINI_TIMEOUT_MS = 60000;
const DALLE_TIMEOUT_MS = 60000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate image using Nano Banana (Gemini 3.1 Flash Image Preview)
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */
export async function generateImageNanoBanana(prompt) {
  if (!GOOGLE_AI_API_KEY) {
    throw new Error("GOOGLE_AI_API_KEY not configured");
  }

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GOOGLE_AI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
    GEMINI_TIMEOUT_MS
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nano Banana: ${res.status} - ${text}`);
  }

  const json = await res.json();
  
  // Extract base64 image data from response
  const candidates = json.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith("image/")) {
        const base64Data = part.inlineData.data;
        const mimeType = part.inlineData.mimeType;
        return `data:${mimeType};base64,${base64Data}`;
      }
    }
  }

  throw new Error("Nano Banana returned no image data");
}

export async function generateImageDalle(prompt, size = "1024x1024") {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size,
        quality: "standard",
      }),
    },
    DALLE_TIMEOUT_MS
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DALL-E 3: ${res.status} - ${text}`);
  }

  const json = await res.json();
  const url = json.data?.[0]?.url;
  if (!url) {
    throw new Error("DALL-E returned no image URL");
  }
  return url;
}

export async function generateImage(prompt) {
  // Primary: Nano Banana (Gemini)
  try {
    console.log("Trying Nano Banana (Gemini) image generation...");
    return await generateImageNanoBanana(prompt);
  } catch (err) {
    console.log(`Nano Banana failed: ${err.message}`);
  }

  // Fallback: DALL-E 3
  if (OPENAI_API_KEY) {
    try {
      console.log("Falling back to DALL-E 3...");
      return await generateImageDalle(prompt);
    } catch (err) {
      console.log(`DALL-E 3 failed: ${err.message}`);
    }
  }

  throw new Error("All image generation methods failed");
}

export function buildDoodlePrompt(concept, domain) {
  const domainHint = doodleConfig.domainHints[domain] || doodleConfig.fallbackHint;
  return `${doodleConfig.basePrompt}\nSubject: ${concept}\nDomain context: ${domainHint}`;
}
