/**
 * Anthropic API utilities (Claude Sonnet + Haiku)
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
    throw new Error(`Anthropic ${model}: ${json.error?.message}`);
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
