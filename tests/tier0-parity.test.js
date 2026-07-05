/**
 * Tier-0 split-brain guard: the router plugin (JS regexes) and crud/parse.py
 * (Python handlers) are two hand-maintained copies of "what is deterministic
 * CRUD". If the plugin matches a phrase that Python cannot handle, the message
 * dead-ends (bypasses the LLM, then the CRUD layer misses). This test runs a
 * representative corpus through BOTH sides and fails on drift.
 *
 * When this fails: update plugins/lyra-model-router/index.js TIER0_PATTERNS and
 * crud/parse.py together (see the "keep aligned" comments in both files).
 */
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const crudDir = join(repoRoot, "crud");

// CRUD corpus: phrase → intent crud/parse.py must produce. Every phrase must
// ALSO match the plugin's TIER0_PATTERNS (asserted below), proving both sides
// agree end to end.
const CORPUS = [
  ["/reminders", "list_reminders"],
  ["show my reminders", "list_reminders"],
  ["list my current tasks", "list_reminders"],
  ["what's in my meal plan", "list_meals"],
  ["show me my meals", "list_meals"],
  ["show my upcoming trips", "list_trips"],
  ["remind me to buy milk tomorrow", "add_reminder"],
  ["set a reminder to call the landlord", "add_reminder"],
  ["add a reminder: pay rent friday", "add_reminder"],
  ["create a reminder to renew passport", "add_reminder"],
  ["add milk to my shopping list", "add_item"],
  ["add eggs to the grocery list", "add_item"],
  ["add call dentist to my reminders", "add_item"],
  ["mark buy milk as done", "mark_done"],
  ["done: buy milk", "mark_done"],
];

// Extract the TIER0_PATTERNS literal from the plugin source. Evaluating just
// the array literal avoids importing the plugin (top-level side effects:
// log-path resolution, file reads) while still testing the real shipped regexes.
function loadPluginTier0Patterns() {
  const src = readFileSync(
    join(repoRoot, "plugins", "lyra-model-router", "index.js"),
    "utf8",
  );
  const m = src.match(/const TIER0_PATTERNS = (\[[\s\S]*?\n\]);/);
  assert.ok(m, "TIER0_PATTERNS array not found in plugin source");
  const patterns = new Function(`return ${m[1]};`)();
  assert.ok(Array.isArray(patterns) && patterns.length > 10, "suspiciously small pattern table");
  return patterns;
}

test("plugin TIER0_PATTERNS match every corpus phrase (JS side)", () => {
  const patterns = loadPluginTier0Patterns();
  for (const [phrase] of CORPUS) {
    assert.ok(
      patterns.some((p) => p.test(phrase)),
      `plugin TIER0_PATTERNS no longer match: ${JSON.stringify(phrase)}`,
    );
  }
});

test("crud/parse.py detect_intent handles every corpus phrase (Python side)", () => {
  const py = `
import json, sys
from parse import detect_intent
corpus = json.loads(sys.stdin.read())
failures = []
for phrase, expected in corpus:
    d = detect_intent(phrase)
    got = d.get("intent") if d else None
    if got != expected:
        failures.append([phrase, expected, got])
print(json.dumps(failures))
`;
  const out = execFileSync("python3", ["-c", py], {
    cwd: crudDir,
    encoding: "utf8",
    input: JSON.stringify(CORPUS),
  });
  const failures = JSON.parse(out.trim().split("\n").pop());
  assert.deepStrictEqual(
    failures,
    [],
    `parse.py drifted from plugin patterns:\n${failures
      .map(([p, e, g]) => `  ${JSON.stringify(p)}: expected ${e}, got ${g}`)
      .join("\n")}`,
  );
});

test("job trigger regex stays aligned between plugin and crud/job_application.py", () => {
  const pluginSrc = readFileSync(
    join(repoRoot, "plugins", "lyra-model-router", "index.js"),
    "utf8",
  );
  // Phase A marker phrases: both sides must agree these trigger the job pipeline.
  const jobPhrases = [
    "applying to the PM role at Revolut",
    "write a cover letter for the N26 opening",
    "draft an outreach message to the hiring manager",
  ];
  const patterns = loadPluginTier0Patterns();
  for (const phrase of jobPhrases) {
    assert.ok(
      patterns.some((p) => p.test(phrase)),
      `plugin no longer treats as job trigger: ${JSON.stringify(phrase)}`,
    );
  }
  const py = `
import json, sys, re
from job_application import _JOB_TRIGGER_RE
phrases = json.loads(sys.stdin.read())
failures = [p for p in phrases if not _JOB_TRIGGER_RE.search(p)]
print(json.dumps(failures))
`;
  const out = execFileSync("python3", ["-c", py], {
    cwd: crudDir,
    encoding: "utf8",
    input: JSON.stringify(jobPhrases),
  });
  const failures = JSON.parse(out.trim().split("\n").pop());
  assert.deepStrictEqual(failures, [], `job_application.py trigger drifted: ${out}`);
});
