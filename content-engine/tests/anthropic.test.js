import { describe, it, expect } from "vitest";
import { parseJsonLoose } from "../scripts/lib/anthropic.js";

describe("parseJsonLoose", () => {
  it("returns null for empty / null / non-string input", () => {
    expect(parseJsonLoose("")).toBeNull();
    expect(parseJsonLoose(null)).toBeNull();
    expect(parseJsonLoose(undefined)).toBeNull();
    expect(parseJsonLoose(42)).toBeNull();
    expect(parseJsonLoose({ a: 1 })).toBeNull();
  });

  it("parses bare JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('{"score":7,"reason":"ok"}')).toEqual({ score: 7, reason: "ok" });
  });

  it("strips ```json fences", () => {
    const wrapped = '```json\n{"quotes":["a","b","c"]}\n```';
    expect(parseJsonLoose(wrapped)).toEqual({ quotes: ["a", "b", "c"] });
  });

  it("strips bare ``` fences without language tag", () => {
    const wrapped = '```\n{"x":1}\n```';
    expect(parseJsonLoose(wrapped)).toEqual({ x: 1 });
  });

  it("handles JSON preceded by prose", () => {
    const input = 'Here is the JSON:\n\n{"title":"foo","subtitle":"bar"}';
    expect(parseJsonLoose(input)).toEqual({ title: "foo", subtitle: "bar" });
  });

  it("returns null for invalid JSON inside fences", () => {
    expect(parseJsonLoose("```json\n{not valid}\n```")).toBeNull();
  });

  it("returns null for completely invalid input", () => {
    expect(parseJsonLoose("just some prose, no json here")).toBeNull();
  });
});
