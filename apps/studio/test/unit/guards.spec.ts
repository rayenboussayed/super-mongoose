import { describe, expect, it } from "vitest";
import {
  assertWritable,
  assertCollectionName,
  assertNotReserved,
  assertFilter,
  assertSort,
  assertDocumentBody,
  assertIndexKeys,
  assertIndexName,
} from "../../src/server/guards";
import type { StudioConfig } from "../../src/server/config";

const writable: StudioConfig = {
  uri: "mongodb://127.0.0.1",
  database: "test",
  readOnly: false,
  maxPageSize: 25,
  maxTimeMs: 1000,
};

describe("studio guards", () => {
  it("refuses writes when read only", () => {
    expect(() => assertWritable({ ...writable, readOnly: true })).toThrow();
  });

  it("accepts safe collection names", () => {
    expect(() => assertCollectionName("drivers")).not.toThrow();
  });

  it("rejects reserved collections", () => {
    expect(() => assertNotReserved("__migrations")).toThrow();
  });

  it("rejects dangerous filter operators", () => {
    expect(() => assertFilter({ $where: "true" } as never)).toThrow();
  });

  it("accepts a normal filter", () => {
    expect(() => assertFilter({ status: "active", count: { $gt: 3 } })).not.toThrow();
  });

  it("rejects unsupported sort directions", () => {
    expect(() => assertSort({ status: 2 } as never)).toThrow();
  });

  it("accepts 1 and -1 sorts", () => {
    expect(() => assertSort({ status: 1, createdAt: -1 })).not.toThrow();
  });

  it("rejects top level update operators in documents", () => {
    expect(() => assertDocumentBody({ $set: { a: 1 } } as never)).toThrow();
  });

  it("validates index keys", () => {
    expect(assertIndexKeys({ status: 1, createdAt: -1 })).toEqual([
      ["status", 1],
      ["createdAt", -1],
    ]);
    expect(() => assertIndexKeys({})).toThrow();
  });

  it("validates index names", () => {
    expect(() => assertIndexName("_id_")).toThrow();
    expect(() => assertIndexName("index_1")).not.toThrow();
  });
});
