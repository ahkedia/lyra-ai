/**
 * Anthropic API utilities (Claude Sonnet + Haiku) with MiniMax fallback.
 * If Anthropic returns 400 billing (credit exhausted), silently retry on
 * MiniMax-M2.7 so workflows keep running.
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_MODEL = "MiniMax-M2.7";

async function minimaxRequest(systemPrompt, userPrompt, maxTokens) {
  // MiniMax M2.x is a reasoning model: half of completion budget gets eaten by
  // reasoning tokens. Double the cap so the actual answer has room.
  const res = await fetch("https://api.minimaxi.chat/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MINIMAX_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      max_tokens: Math.max(maxTokens * 2, 1000),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok || json?.base_resp?.status_code) {
    const code = json?.base_resp?.status_code;
    const msg = json?.base_resp?.status_msg || JSON.stringify(json).slice(0, 200);
    throw new Error(`MiniMax fallback failed: ${code} ${msg}`);
  }
  return json.choices?.[0]?.message?.content || "";
}

export async function anthropicRequest(model, systemPrompt, userPrompt, maxTokens = 1500) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    const errMsg = json.error?.message || "";
    if (res.status === 400 && /credit balance/i.test(errMsg)) {
      console.warn(`[anthropic→minimax] Anthropic ${model} billing failed, falling back to ${MINIMAX_MODEL}`);
      return minimaxRequest(systemPrompt, userPrompt, maxTokens);
    }
    throw new Error(`Anthropic ${model}: ${errMsg}`);
  }
  return json.content?.[0]?.text || "";
}

export async function generateWithSonnet(systemPrompt, userPrompt, maxTokens = 2000) {
  return anthropicRequest("claude-sonnet-4-6", systemPrompt, userPrompt, maxTokens);
}

export async function humanizeWithHaiku(systemPrompt, userPrompt, maxTokens = 1500) {
  return anthropicRequest("claude-haiku-4-5-20251001", systemPrompt, userPrompt, maxTokens);
}

/**
 * Parse JSON from a model response that may be wrapped in ```json fences,
 * preceded by prose, or otherwise dirty. Returns null if no valid JSON found.
 */
export function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : (text.match(/\{[\s\S]*\}/)?.[0] || text.trim());
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Q2 quality gate: 0–10 suitability for a long-form founder blog (concrete, not generic).
 * Returns parsed { score, reason } or null if JSON parse fails.
 */
export async function evaluateTopicGate(topic, source, domain, collectorScore) {
  const system = "You are a strict editor. Return only valid JSON, no markdown.";
  const user = `Topic title: ${JSON.stringify(topic)}
Source: ${JSON.stringify(source)}
Domain: ${JSON.stringify(domain)}
Collector score (recency + source weight): ${collectorScore}

Question: Could this topic sustain an 800–1500 word blog post in one technical founder's voice (concrete career detail from payments/credit/brokerage-style work), not generic thought leadership or SEO filler?

Score 0–10 where:
- 0–3: too vague, trend-chasing, or no anchor
- 4–6: ok hook but thin or repetitive
- 7–8: strong, specific angle; could be great with research
- 9–10: unmistakably sharp; rare

Return JSON only:
{"score": <number>, "reason": "<one sentence>"}`;
  const text = await humanizeWithHaiku(system, user, 400);
  const jsonSlice = (() => {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const brace = text.match(/\{[\s\S]*\}/);
    return brace ? brace[0] : text.trim();
  })();
  try {
    const parsed = JSON.parse(jsonSlice);
    const score = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
    if (Number.isNaN(score)) return null;
    return { score, reason: parsed.reason || "" };
  } catch {
    return null;
  }
}
