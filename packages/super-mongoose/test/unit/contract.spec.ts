import { describe, expect, it } from "vitest";
import {
  IndexDirection,
  MigrationContract,
  MigrationIndexContract,
  MigrationModelContract,
  MigrationModelFieldContract,
  MigrationStatusContract,
  MongooseType,
} from "../../src/schemas/contract";

describe("the contract schemas", () => {
  it("accepts a model with the supported types", () => {
    const parsed = MigrationModelContract.parse({
      name: "Driver",
      collection: "drivers",
      fields: {
        firstName: { type: "String", status: "up", required: true },
        age: { type: "Number", status: "up" },
        active: { type: "Boolean", status: "up" },
        bornAt: { type: "Date", status: "up" },
        manager: { type: "ObjectId", status: "up", ref: "Driver" },
        balance: { type: "Decimal128", status: "up" },
        photo: { type: "Buffer", status: "up" },
        externalId: { type: "UUID", status: "up" },
        counter: { type: "BigInt", status: "up" },
        payload: { type: "Mixed", status: "up" },
        labels: { type: "Map", status: "up", of: { type: "String", status: "up" } },
        notes: { type: "Array", status: "up", of: { type: "String", status: "up" } },
        vehicle: {
          type: "Subdocument",
          status: "up",
          fields: { plate: { type: "String", status: "up" } },
        },
      },
    });

    expect(Object.keys(parsed.fields)).toHaveLength(13);
    expect(parsed.options.timestamps).toBe(true);
    expect(parsed.indexes).toEqual([]);
  });

  it("rejects an unknown type", () => {
    expect(() => MongooseType.parse("Timestamp")).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => MigrationStatusContract.parse("maybe")).toThrow();
  });

  it("rejects an unknown index direction", () => {
    expect(() => IndexDirection.parse(2)).toThrow();
    expect(IndexDirection.parse("text")).toBe("text");
  });

  it("rejects an unknown option", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "String", status: "up", notAnOption: true }),
    ).toThrow();
  });

  it("rejects a string option on a field that is not a string", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Number", status: "up", trim: true }),
    ).toThrow(/only applies to a String field/);
  });

  it("rejects an enum on a field that has no enum", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Date", status: "up", enum: ["a"] }),
    ).toThrow(/does not apply to a Date field/);
  });

  it("rejects an enum that repeats a value", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "String", status: "up", enum: ["a", "a"] }),
    ).toThrow(/cannot repeat a value/);
  });

  it("rejects an enum on an array and on its element at the same time", () => {
    expect(() =>
      MigrationModelFieldContract.parse({
        type: "Array",
        status: "up",
        enum: ["a"],
        of: { type: "String", status: "up", enum: ["a"] },
      }),
    ).toThrow(/not on both/);
  });

  it("rejects a numeric bound on a string field", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "String", status: "up", min: 1 }),
    ).toThrow(/only applies to a Number or a Date field/);
  });

  it("rejects a string bound on a number field", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Number", status: "up", min: "1" }),
    ).toThrow(/needs a number/);
  });

  it("accepts a date bound that is a number", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Date", status: "up", min: 0, max: 100 }),
    ).not.toThrow();
  });

  it("rejects a bound that is not a date", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Date", status: "up", min: "not-a-date" }),
    ).toThrow(/needs a date/);
  });

  it("rejects a minimum that is greater than the maximum", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "Number", status: "up", min: 10, max: 1 }),
    ).toThrow(/cannot be greater than/);
  });

  it("rejects a minimum length that is greater than the maximum length", () => {
    expect(() =>
      MigrationModelFieldContract.parse({
        type: "String",
        status: "up",
        minLength: 10,
        maxLength: 1,
      }),
    ).toThrow(/cannot be greater than/);
  });

  it("rejects a unique field that has no index", () => {
    expect(() =>
      MigrationModelFieldContract.parse({
        type: "String",
        status: "up",
        unique: true,
        index: false,
      }),
    ).toThrow(/cannot be unique and without an index/);
  });

  it("rejects a sparse field that has no index", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "String", status: "up", sparse: true }),
    ).toThrow(/sparse/);
  });

  it("rejects an element type on a field that is not an array or a map", () => {
    expect(() =>
      MigrationModelFieldContract.parse({
        type: "String",
        status: "up",
        of: { type: "String", status: "up" },
      }),
    ).toThrow(/only applies to an Array or a Map field/);
  });

  it("rejects subdocument fields on a field that is not a subdocument", () => {
    expect(() =>
      MigrationModelFieldContract.parse({
        type: "String",
        status: "up",
        fields: { a: { type: "String", status: "up" } },
      }),
    ).toThrow(/only applies to a Subdocument field/);
  });

  it("rejects a reference on a field that is not an object id", () => {
    expect(() =>
      MigrationModelFieldContract.parse({ type: "String", status: "up", ref: "Driver" }),
    ).toThrow(/only applies to an ObjectId field/);
  });

  it("rejects an index without fields", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: {} }),
    ).toThrow(/at least one field/);
  });

  it("rejects a ttl index on more than one field", () => {
    expect(() =>
      MigrationIndexContract.parse({
        status: "up",
        fields: { a: 1, b: 1 },
        expireAfterSeconds: 60,
      }),
    ).toThrow(/single field only/);
  });

  it("rejects a unique hashed index", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: "hashed" }, unique: true }),
    ).toThrow(/hashed index cannot be unique/);
  });

  it("rejects a model name that is not safe", () => {
    expect(() => MigrationModelContract.parse({ name: "", fields: {} })).toThrow();
    expect(() => MigrationModelContract.parse({ name: "__proto__", fields: {} })).toThrow();
  });

  it("rejects a collection name that starts with system.", () => {
    expect(() =>
      MigrationModelContract.parse({ name: "Driver", collection: "system.drivers", fields: {} }),
    ).toThrow();
  });

  it("rejects a field name that contains a dot", () => {
    expect(() =>
      MigrationModelContract.parse({
        name: "Driver",
        fields: { "first.name": { type: "String", status: "up" } },
      }),
    ).toThrow();
  });

  it("rejects a model stored under a name it does not declare", () => {
    expect(() =>
      MigrationContract.parse({
        version: "001",
        models: { Driver: { name: "Pilot", fields: {} } },
      }),
    ).toThrow(/declares the name/);
  });

  it("accepts a contract whose models match their keys", () => {
    const parsed = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: {} } },
    });

    expect(parsed.version).toBe("001");
  });
});
