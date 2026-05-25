// Regression tests for prompt builders.
//
// We do NOT test LLM output (non-deterministic). Instead we assert that each
// prompt contains its load-bearing instructions — the things that, if missing,
// would silently break the pipeline downstream (links not appended, formats
// drifting, JSON not returned, etc.). These tests catch prompt-template
// regressions when prompts get edited.
//
// When you intentionally tighten/loosen a prompt, update the assertion list
// in the same commit so the regression bar moves with intent.

import { describe, it, expect } from "vitest";
import {
  buildXThreadPrompt,
  buildLinkedInCopyPrompt,
  buildPullQuotesPrompt,
  buildSubstackHeadlinePrompt,
  buildNewsletterHookPrompt,
} from "../scripts/draft-generator.js";

const TOPIC = "the model is a commodity. the system is the moat.";
const BLOG = "this is a fixture blog body used for prompt tests. ".repeat(40);

describe("buildXThreadPrompt", () => {
  const p = buildXThreadPrompt(TOPIC, BLOG);

  it("mentions the topic and includes a blog excerpt", () => {
    expect(p).toContain(TOPIC);
    expect(p).toContain("BLOG EXCERPT");
  });

  it("requires the {{SUBSTACK_URL}} placeholder in the final tweet", () => {
    expect(p).toContain("{{SUBSTACK_URL}}");
  });

  it("constrains the thread to 5-9 tweets", () => {
    expect(p).toMatch(/5 to 9 tweets/i);
  });

  it("forbids em-dash and en-dash substitutes", () => {
    expect(p.toLowerCase()).toContain("em dash");
    expect(p.toLowerCase()).toContain("en dash");
  });

  it("requires lowercase body and TWEET N: numbering", () => {
    expect(p.toLowerCase()).toContain("all-lowercase");
    expect(p).toContain("TWEET");
  });

  it("forbids hashtags and 'thread' announcements", () => {
    expect(p.toLowerCase()).toMatch(/no hashtags/);
    expect(p.toLowerCase()).toMatch(/no\s+"?🧵|no\s+"?thread/);
  });
});

describe("buildLinkedInCopyPrompt", () => {
  const p = buildLinkedInCopyPrompt(TOPIC, BLOG);

  it("mentions the topic and blog excerpt", () => {
    expect(p).toContain(TOPIC);
    expect(p).toContain("BLOG EXCERPT");
  });

  it("specifies the link-in-first-comment pattern", () => {
    expect(p).toContain("first comment");
    expect(p).toContain("full write-up in the comments");
  });

  it("forbids URLs in the post body", () => {
    expect(p.toLowerCase()).toMatch(/do not include any url|no.*url.*in.*body|substack link.*separate/i);
  });

  it("targets 700-800 chars with hard cap 850", () => {
    expect(p).toContain("700-800");
    expect(p).toContain("850");
  });

  it("forbids em-dash and requires lowercase", () => {
    expect(p.toLowerCase()).toContain("em dash");
    expect(p.toLowerCase()).toContain("all-lowercase");
  });
});

describe("buildPullQuotesPrompt", () => {
  const p = buildPullQuotesPrompt(TOPIC, BLOG);

  it("requests 3 standalone quotes", () => {
    expect(p).toMatch(/3 standalone pull-quotes/i);
  });

  it("requires JSON output with a 'quotes' array", () => {
    expect(p).toContain('"quotes"');
    expect(p.toLowerCase()).toContain("strict json");
  });

  it("specifies 180-260 char length and self-contained criteria", () => {
    expect(p).toContain("180-260");
    expect(p.toLowerCase()).toContain("self-contained");
  });

  it("requires 3 distinct angles, not rephrasings", () => {
    expect(p.toLowerCase()).toContain("distinct from each other");
  });
});

describe("buildSubstackHeadlinePrompt", () => {
  const p = buildSubstackHeadlinePrompt(TOPIC, BLOG);

  it("requests JSON with title and subtitle keys", () => {
    expect(p).toContain('"title"');
    expect(p).toContain('"subtitle"');
    expect(p.toLowerCase()).toContain("strict json");
  });

  it("specifies 40-70 char title and 80-140 char subtitle", () => {
    expect(p).toContain("40-70");
    expect(p).toContain("80-140");
  });

  it("forbids 'how to' / listicle openers", () => {
    expect(p.toLowerCase()).toContain("how to");
  });
});

describe("buildNewsletterHookPrompt", () => {
  const p = buildNewsletterHookPrompt(TOPIC, BLOG);

  it("requests a single sentence", () => {
    expect(p.toLowerCase()).toContain("one sentence");
  });

  it("specifies 80-160 char range", () => {
    expect(p).toContain("80-160");
  });

  it("forbids 'in this article' framing", () => {
    expect(p.toLowerCase()).toContain('in this article');
  });
});
