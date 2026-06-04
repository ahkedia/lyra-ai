// lyra-brain-capture — Lyra's WRITE path into the gbrain brain.
//
// Two triggers (both route through the serialized brain-capture.sh → flock, so they
// never collide with the nightly sync / dream cycle on the PGLite single-writer DB):
//
//   1. EXPLICIT — "/remember <text>" command, or a message starting with
//      "remember this / save to brain / note to brain". Captures verbatim.
//   2. END-OF-THREAD AUTO-SUMMARY — on agent_end, if the exchange was substantive,
//      capture the raw user→Lyra exchange as a `conversation` page. The nightly dream
//      cycle (synthesize/extract_facts/consolidate) distills + dedups it. We keep the
//      plugin cheap (no extra LLM call) and let the daemon do the wisdom work.
//
// Fail-safe: capture is fire-and-forget (detached spawn). Errors never block Lyra.

import { spawn } from "child_process";

const CAPTURE = "/root/lyra-ai/scripts/brain-capture.sh";

// explicit triggers
const EXPLICIT_RE =
  /^(?:\/remember\b|remember this[:\s]|save (?:this )?to (?:the )?brain[:\s]?|note to brain[:\s])/i;

// minimum substance for auto-summary (chars) — avoid capturing "ok", "thanks", etc.
const MIN_USER_CHARS = 80;
const MIN_REPLY_CHARS = 200;

function fireCapture(content, type, prefix) {
  try {
    const child = spawn("/bin/bash", [CAPTURE, "stdin", type, prefix], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.write(content);
    child.stdin.end();
    child.unref();
  } catch {
    /* never throw into Lyra */
  }
}

function stripExplicit(text) {
  return text.replace(EXPLICIT_RE, "").trim();
}

const plugin = {
  id: "lyra-brain-capture",
  name: "Lyra Brain Capture",
  description:
    "Lyra's write path into gbrain: /remember + 'save to brain' (explicit) and end-of-thread auto-summary (agent_end). Serialized via brain-capture.sh flock.",

  register(api) {
    // --- 1a. explicit slash command ---
    api.registerCommand({
      name: "remember",
      description: "Save a note to your brain (gbrain)",
      acceptsArgs: true,
      handler: async (ctx) => {
        const text = (ctx.args ?? "").trim();
        if (!text || text.length < 5) {
          return { text: "Usage: /remember <something worth keeping>", continueAgent: false };
        }
        fireCapture(text, "note", "lyra/remember");
        api.logger.info("[lyra-brain-capture] /remember captured");
        return { text: "🧠 saved to your brain.", continueAgent: false };
      },
    });

    // --- 1b. explicit natural-language ("remember this: ...", "save to brain ...") ---
    api.on("message_received", (event) => {
      try {
        const text = String(event?.text || event?.message || "").trim();
        if (text && EXPLICIT_RE.test(text)) {
          const body = stripExplicit(text);
          if (body.length >= 5) {
            fireCapture(body, "note", "lyra/remember");
            api.logger.info("[lyra-brain-capture] explicit capture from message");
          }
        }
      } catch {
        /* non-fatal */
      }
      return undefined; // never alter routing
    });

    // --- 2. end-of-thread auto-summary (raw exchange; dream cycle distills it) ---
    api.on("agent_end", (event) => {
      try {
        const userMsg = String(event?.prompt || event?.userMessage || "").trim();
        const reply = String(event?.reply || event?.response || event?.text || "").trim();
        // skip if either side is thin, or it was an explicit-capture turn (already saved)
        if (userMsg.length < MIN_USER_CHARS || reply.length < MIN_REPLY_CHARS) return undefined;
        if (EXPLICIT_RE.test(userMsg)) return undefined;
        const page = `# Conversation (${new Date().toISOString().slice(0, 10)})\n\n**Akash:** ${userMsg}\n\n**Lyra:** ${reply}`;
        fireCapture(page, "conversation", "lyra/conversations");
        api.logger.info("[lyra-brain-capture] agent_end auto-summary captured");
      } catch {
        /* non-fatal */
      }
      return undefined;
    });

    api.logger.info("[lyra-brain-capture] registered (/remember + explicit + agent_end auto-capture)");
  },
};

export default plugin;
