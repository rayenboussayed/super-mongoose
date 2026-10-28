import { describe, expect, it } from "vitest";
import { parseEjson, parseObjectText, stringifyEjson, documentPreview, idText } from "../../src/server/ejson";

describe("ejson helpers", () => {
  it("parses a document", () => {
    expect(parseObjectText('{ "name": "a", "n": 1 }', "x")).toEqual({ name: "a", n: 1 });
  });

  it("rejects a non object", () => {
    expect(() => parseObjectText('["a"]', "x")).toThrow();
  });

  it("rejects invalid text", () => {
    expect(() => parseObjectText("{ bad", "x")).toThrow();
  });

  it("round trips extended values", () => {
    const parsed = parseEjson('{ "_id": { "$oid": "507f1f77bcf86cd799439011" } }', "x");
    expect(stringifyEjson(parsed)).toContain("$oid");
  });

  it("builds document previews", () => {
    expect(documentPreview({ _id: "id", name: "a", status: "active" })).toContain('name: "a"');
  });

  it("ids stringify compactly", () => {
    expect(idText("abc")).toBe('"abc"');
  });

  it("rejects oversized input", () => {
    expect(() => parseEjson("a".repeat(600000), "x")).toThrow();
  });

  it("truncates long previews", () => {
    const doc: Record<string, unknown> = { _id: "id" };
    for (let index = 0; index < 20; index += 1) {
      doc[`field${index}`] = "x".repeat(20);
    }
    expect(documentPreview(doc, 40).length).toBeLessThanOrEqual(43);
  });
});
