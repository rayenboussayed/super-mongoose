import { describe, expect, it } from "vitest";
import { parseListDocumentsInput, parseExplainInput, parseCreateCollectionInput, parseSaveDocumentInput, parseDeleteDocumentInput, parseCreateIndexInput, parseDropIndexInput, asOptionalString } from "../../src/server/inputs";

describe("input parsing", () => {
  it("parses list input", () => {
    expect(parseListDocumentsInput({ collection: "a", page: 2, pageSize: 10 })).toMatchObject({
      collection: "a",
      page: 2,
      pageSize: 10,
    });
  });

  it("rejects explain without collection", () => {
    expect(() => parseExplainInput({})).toThrow();
  });

  it("parses create collection input", () => {
    expect(parseCreateCollectionInput({ name: "widgets", validator: '{ "type": "object" }' })).toMatchObject({
      name: "widgets",
    });
  });
});

describe("more inputs", () => {
  it("parses save input", () => {
    expect(parseSaveDocumentInput({ collection: "c", document: "{}" })).toMatchObject({ collection: "c" });
  });
  it("rejects delete without id", () => {
    expect(() => parseDeleteDocumentInput({ collection: "c" })).toThrow();
  });
  it("parses create index input", () => {
    expect(parseCreateIndexInput({ collection: "c", keys: '{ "a": 1 }', unique: true })).toMatchObject({ collection: "c", unique: true });
  });
  it("parses drop index input", () => {
    expect(parseDropIndexInput({ collection: "c", name: "idx" })).toMatchObject({ name: "idx" });
  });
  it("optional fields", () => {
    const input = parseCreateIndexInput({
      collection: "c",
      keys: '{ "a": 1 }',
      name: "idx",
      unique: true,
      sparse: false,
      expireAfterSeconds: 10,
      partialFilterExpression: '{ "a": 1 }',
      hidden: true,
    });
    expect(input).toMatchObject({ hidden: true, sparse: false, expireAfterSeconds: 10 });
  });
  it("passes strings through", () => {
    expect(asOptionalString("x")).toBe("x");
  });
});
