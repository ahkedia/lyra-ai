/**
 * Input sanitization utilities
 * Copied from insight-engine.js lines 55-63
 */

export function sanitizeInput(text) {
  if (!text) return "";
  return text
    .replace(/\[\s*system\s*\]/gi, "[filtered]")
    .replace(/\bignore\s+(previous|above|all)\s+instructions?\b/gi, "[filtered]")
    .replace(/\byou\s+are\s+now\b/gi, "[filtered]")
    .slice(0, 4000);
}

export function sanitizeForTelegram(text) {
  if (!text) return "";
  return text
    .replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&")
    .slice(0, 4096);
}

export function truncate(text, maxLen = 280) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
