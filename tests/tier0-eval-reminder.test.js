/**
 * L-10 regression: tier0-reminder-add eval prompt must match Python CRUD + router prefix.
 * Ensures "Remind me to [eval] pick up groceries tomorrow" never falls through to LLM
 * because parse missed [eval] in the reminder body.
 */
import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const crudDir = join(__dirname, "..", "crud");

const EVAL_REMINDER_PROMPT = "Remind me to [eval] pick up groceries tomorrow";

test("parse.detect_intent classifies eval reminder as add_reminder (no Notion call in this check)", () => {
  const py = `
from parse import detect_intent
d = detect_intent(${JSON.stringify(EVAL_REMINDER_PROMPT)})
assert d is not None and d.get("intent") == "add_reminder", repr(d)
print("ok")
`;
  const out = execFileSync("python3", ["-c", py], {
    cwd: crudDir,
    encoding: "utf8",
  });
  assert.ok(out.includes("ok"));
});

test("router TIER0 prefix matches eval reminder (sync with plugins/lyra-model-router/index.js)", () => {
  const remindPrefix = /^remind me (?:to |about )?/i;
  assert.ok(
    remindPrefix.test(EVAL_REMINDER_PROMPT),
    "Update TIER0_PATTERNS / parse.py together if this fails",
  );
});
