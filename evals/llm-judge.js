/**
 * LLM-as-judge scorer using Claude Haiku.
 * Sends the test response + rubric to Haiku for scoring.
 */

import https from 'https';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Call Claude Haiku to judge a response against a rubric.
 * @param {string} response - Lyra's response to evaluate
 * @param {object} config - { rubric, prompt (original test prompt) }
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<{ passed: boolean, score: number, detail: string }>}
 */
export async function judgeResponse(response, config, apiKey) {
  const rubric = config.rubric || 'Is this a good response?';
  const originalPrompt = config.prompt || '';

  const systemPrompt = `You are an eval judge for Lyra, a personal AI assistant. Score the assistant's response on a scale of 1-5 based on the rubric. Be strict but fair.

Scoring:
1 = Complete failure (wrong, harmful, or nonsensical)
2 = Poor (partially addresses but with major issues)
3 = Acceptable (addresses the core need with minor issues)
4 = Good (clear, correct, well-structured)
5 = Excellent (exceeds expectations)

Respond with ONLY a JSON object: {"score": <1-5>, "reasoning": "<one sentence>"}`;

  const userMessage = `Original prompt: "${originalPrompt}"

Assistant's response:
"""
${response.slice(0, 2000)}
"""

Rubric: ${rubric}

Score this response.`;

  try {
    let result = await callHaiku(systemPrompt, userMessage, apiKey);
    // Strip markdown code fences if present
    result = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(result);
    const score = parsed.score || 0;
    return {
      passed: score >= 3,
      score,
      detail: `LLM Judge: ${score}/5 — ${parsed.reasoning || 'No reasoning'}`,
    };
  } catch (err) {
    return {
      passed: false,
      score: 0,
      detail: `LLM Judge error: ${err.message}`,
    };
  }
}

/**
 * Call Claude Haiku via the Anthropic API.
 */
function callHaiku(system, user, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 150,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
            return;
          }
          const text = parsed.content?.[0]?.text || '';
          resolve(text);
        } catch (err) {
          reject(new Error(`Failed to parse Haiku response: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
