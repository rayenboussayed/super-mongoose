import { describe, expect, it } from "vitest";
import {
  isDuplicateKeyError,
  isIndexNotFound,
  isNamespaceNotFound,
  isSameIndexOptions,
  mongoErrorCode,
  readCollectionState,
  toIndexOptions,
} from "../../src/internal/mongo/state";
import { isSameIndexKey } from "../../src/internal/definition";
import { asMongoDb, createFakeDb, mongoError } from "../helpers/fake-db";

describe("the live state of a collection", () => {
  it("says that a collection does not exist", async () => {
    const state = await readCollectionState(asMongoDb(createFakeDb()), "drivers");

    expect(state).toEqual({ exists: false, indexes: [] });
  });

  it("reads the validator and the indexes of a collection", async () => {
    const db = createFakeDb();
    db.collection("drivers").indexes.firstName_1 = { key: { firstName: 1 } };

    const state = await readCollectionState(asMongoDb(db), "drivers");

    expect(state.exists).toBe(true);
    expect(state.indexes).toEqual([{ name: "firstName_1", key: { firstName: 1 } }]);
  });

  it("reads the indexes of a collection that cannot list them", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("not found", 26);

    const state = await readCollectionState(asMongoDb(db), "drivers");

    expect(state.indexes).toEqual([]);
  });

  it("reports a failure of the index list", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("not authorized", 13);

    await expect(readCollectionState(asMongoDb(db), "drivers")).rejects.toThrow();
  });
});

describe("the comparison of two indexes", () => {
  it("is true for the same fields in the same order", () => {
    expect(isSameIndexKey({ a: 1, b: -1 }, { a: 1, b: -1 })).toBe(true);
  });

  it("is false when the order of the fields differs", () => {
    expect(isSameIndexKey({ a: 1, b: -1 }, { b: -1, a: 1 })).toBe(false);
  });

  it("is false when the number of fields differs", () => {
    expect(isSameIndexKey({ a: 1 }, { a: 1, b: 1 })).toBe(false);
  });

  it("is true when the options are the same", () => {
    expect(
      isSameIndexOptions(
        { name: "a_1", key: { a: 1 }, unique: true },
        { name: "a_1", key: { a: 1 }, status: "up", unique: true },
      ),
    ).toBe(true);
  });

  it("is false when the uniqueness differs", () => {
    expect(
      isSameIndexOptions(
        { name: "a_1", key: { a: 1 } },
        { name: "a_1", key: { a: 1 }, status: "up", unique: true },
      ),
    ).toBe(false);
  });

  it("is false when the lifetime of a ttl index differs", () => {
    expect(
      isSameIndexOptions(
        { name: "a_1", key: { a: 1 }, expireAfterSeconds: 60 },
        { name: "a_1", key: { a: 1 }, status: "up", expireAfterSeconds: 120 },
      ),
    ).toBe(false);
  });

  it("is false when the filter of a partial index differs", () => {
    expect(
      isSameIndexOptions(
        { name: "a_1", key: { a: 1 }, partialFilterExpression: { a: { $gt: 1 } } },
        { name: "a_1", key: { a: 1 }, status: "up", partialFilterExpression: { a: { $gt: 2 } } },
      ),
    ).toBe(false);
  });

  it("ignores the sparse flag of an index the server builds sparse", () => {
    expect(
      isSameIndexOptions(
        { name: "a_2dsphere", key: { a: "2dsphere" }, sparse: true },
        { name: "a_2dsphere", key: { a: "2dsphere" }, status: "up" },
      ),
    ).toBe(true);
  });
});

describe("the options of an index", () => {
  it("leaves out the options the contract does not declare", () => {
    expect(toIndexOptions({ name: "a_1" })).toEqual({ name: "a_1" });
  });

  it("keeps the options the contract declares", () => {
    expect(
      toIndexOptions({
        name: "a_1",
        unique: true,
        sparse: true,
        expireAfterSeconds: 60,
        partialFilterExpression: { a: { $gt: 1 } },
      }),
    ).toEqual({
      name: "a_1",
      unique: true,
      sparse: true,
      expireAfterSeconds: 60,
      partialFilterExpression: { a: { $gt: 1 } },
    });
  });
});

describe("the errors of the driver", () => {
  it("reads the code of an error", () => {
    expect(mongoErrorCode(mongoError("boom", 42))).toBe(42);
  });

  it("has no code when the error carries none", () => {
    expect(mongoErrorCode(new Error("boom"))).toBeUndefined();
    expect(mongoErrorCode("boom")).toBeUndefined();
    expect(mongoErrorCode(undefined)).toBeUndefined();
  });

  it("reads the code when it is not a number", () => {
    expect(mongoErrorCode({ code: "42" })).toBeUndefined();
  });

  it("knows the errors of a missing namespace, a missing index and a duplicate", () => {
    expect(isNamespaceNotFound(mongoError("boom", 26))).toBe(true);
    expect(isIndexNotFound(mongoError("boom", 27))).toBe(true);
    expect(isIndexNotFound(mongoError("boom", 26))).toBe(true);
    expect(isDuplicateKeyError(mongoError("boom", 11000))).toBe(true);
    expect(isDuplicateKeyError(mongoError("boom", 26))).toBe(false);
  });
});
