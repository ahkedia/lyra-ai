import { describe, it, expect } from "vitest";
import { richTextChunks } from "../scripts/lib/notion.js";

describe("richTextChunks", () => {
  it("returns single empty segment for empty / null input", () => {
    expect(richTextChunks("")).toEqual([{ text: { content: "" } }]);
    expect(richTextChunks(null)).toEqual([{ text: { content: "" } }]);
    expect(richTextChunks(undefined)).toEqual([{ text: { content: "" } }]);
  });

  it("returns single segment for strings under chunk size", () => {
    const result = richTextChunks("hello world");
    expect(result).toEqual([{ text: { content: "hello world" } }]);
  });

  it("returns single segment exactly at chunk size", () => {
    const text = "a".repeat(1900);
    const result = richTextChunks(text);
    expect(result).toHaveLength(1);
    expect(result[0].text.content).toBe(text);
  });

  it("splits at chunk boundary for strings over chunk size", () => {
    const text = "a".repeat(1900) + "b".repeat(500);
    const result = richTextChunks(text);
    expect(result).toHaveLength(2);
    expect(result[0].text.content).toBe("a".repeat(1900));
    expect(result[1].text.content).toBe("b".repeat(500));
  });

  it("each segment stays under default 1900-char limit", () => {
    const text = "x".repeat(5000);
    const result = richTextChunks(text);
    for (const chunk of result) {
      expect(chunk.text.content.length).toBeLessThanOrEqual(1900);
    }
  });

  it("concatenated segments equal original input", () => {
    const text = "x".repeat(1900) + "y".repeat(1900) + "z".repeat(500);
    const result = richTextChunks(text);
    const reconstructed = result.map((c) => c.text.content).join("");
    expect(reconstructed).toBe(text);
  });

  it("respects custom chunk size", () => {
    const text = "abcdefghij";
    const result = richTextChunks(text, 3);
    expect(result.map((c) => c.text.content)).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("coerces non-string input to string", () => {
    const result = richTextChunks(12345);
    expect(result).toEqual([{ text: { content: "12345" } }]);
  });
});
