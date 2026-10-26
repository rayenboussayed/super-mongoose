import { describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MigrationContract, MigrationIndexContract, MigrationModelContract } from "../../src/schemas/contract";
import { MigrationError } from "../../src/errors";
import { compareVersions, contractChecksum, mergeModelContracts } from "../../src/internal/definition";
import { buildValidator, mergeIgnoredFields } from "../../src/internal/mongo/validator";
import { planModel } from "../../src/migrator/plan";
import { buildModelDefinition } from "../../src/internal/definition";
import { applyOperations } from "../../src/migrator/apply";
import { asMongoDb, createFakeDb, mongoError } from "../helpers/fake-db";

describe("the version of a contract", () => {
  it("refuses an empty version", () => {
    expect(() => MigrationContract.parse({ version: "", models: {} })).toThrow();
  });

  it("refuses a version with a space", () => {
    expect(() => MigrationContract.parse({ version: "001 two", models: {} })).toThrow();
  });

  it("refuses a version that is too long", () => {
    expect(() => MigrationContract.parse({ version: "v".repeat(129), models: {} })).toThrow();
  });

  it("refuses a version with a control character", () => {
    expect(() => MigrationContract.parse({ version: "ab", models: {} })).toThrow();
  });

  it("refuses a version that is a reserved key", () => {
    expect(() => MigrationContract.parse({ version: "__proto__", models: {} })).toThrow();
  });
});

describe("the order of the versions", () => {
  it("puts the number of a version in the right order", () => {
    expect(compareVersions("v2", "v10")).toBeLessThan(0);
    expect(compareVersions("v10", "v2")).toBeGreaterThan(0);
    expect(compareVersions("v2", "v2")).toBe(0);
  });

  it("puts a version with a timestamp after the older one", () => {
    expect(compareVersions("20240101090000", "20240201090000")).toBeLessThan(0);
  });

  it("orders the contracts by their version", () => {
    const merged = mergeModelContracts([
      MigrationContract.parse({
        version: "v10",
        models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
      }),
      MigrationContract.parse({
        version: "v2",
        models: { Driver: { name: "Driver", fields: { b: { type: "String", status: "up" } } } },
      }),
    ]);

    expect(Object.keys(merged.Driver.fields)).toEqual(["b", "a"]);
  });
});

describe("the names of a contract", () => {
  it("refuses a collection the layer reserves", () => {
    expect(() =>
      MigrationModelContract.parse({ name: "Driver", collection: "__migrations", fields: {} }),
    ).toThrow();
    expect(() =>
      MigrationModelContract.parse({ name: "Driver", collection: "__migrations_lock", fields: {} }),
    ).toThrow();
  });

  it("refuses a model name with a dollar", () => {
    expect(() => MigrationModelContract.parse({ name: "$driver", fields: {} })).toThrow();
  });

  it("refuses a field name with a dollar", () => {
    expect(() =>
      MigrationModelContract.parse({ name: "Driver", fields: { $a: { type: "String", status: "up" } } }),
    ).toThrow();
  });

  it("refuses a version key that is not a field name", () => {
    expect(() =>
      MigrationModelContract.parse({
        name: "Driver",
        fields: {},
        options: { timestamps: true, versionKey: "a.b" },
      }),
    ).toThrow();
  });

  it("refuses an unknown key on a contract", () => {
    expect(() =>
      MigrationContract.parse({ version: "001", models: {}, unknown: true }),
    ).toThrow();
  });

  it("refuses an unknown key on a model", () => {
    expect(() =>
      MigrationModelContract.parse({ name: "Driver", fields: {}, unknown: true }),
    ).toThrow();
  });

  it("refuses an unknown key on the options of a model", () => {
    expect(() =>
      MigrationModelContract.parse({
        name: "Driver",
        fields: {},
        options: { timestamps: true, unknown: true } as never,
      }),
    ).toThrow();
  });

  it("refuses an unknown key on an index", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, background: true } as never),
    ).toThrow();
  });
});

describe("the name of an index", () => {
  it("refuses the star that drops every index", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, name: "*" }),
    ).toThrow();
  });

  it("refuses the index of the identifier", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, name: "_id_" }),
    ).toThrow();
  });

  it("counts the bytes of a name and not its characters", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, name: "é".repeat(64) }),
    ).toThrow();
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, name: "é".repeat(63) }),
    ).not.toThrow();
  });
});

describe("the path of an index", () => {
  it("refuses a path with an empty segment", () => {
    expect(() => MigrationIndexContract.parse({ status: "up", fields: { "a..b": 1 } })).toThrow();
  });

  it("refuses a path that starts with a dollar", () => {
    expect(() => MigrationIndexContract.parse({ status: "up", fields: { $a: 1 } })).toThrow();
  });

  it("refuses a path that is a reserved key", () => {
    expect(() => MigrationIndexContract.parse({ status: "up", fields: { __proto__: 1 } })).toThrow();
  });

  it("accepts a path that goes into a subdocument", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { "vehicle.plate": 1 } }),
    ).not.toThrow();
  });

  it("refuses a path that is too long", () => {
    expect(() => MigrationIndexContract.parse({ status: "up", fields: { ["a".repeat(401)]: 1 } })).toThrow();
  });
});

describe("the lifetime of a ttl index", () => {
  it("refuses a negative lifetime", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, expireAfterSeconds: -1 }),
    ).toThrow();
  });

  it("refuses a lifetime that is not a whole number", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, expireAfterSeconds: 1.5 }),
    ).toThrow();
  });

  it("refuses a lifetime the server cannot store", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, expireAfterSeconds: 2147483648 }),
    ).toThrow();
  });

  it("accepts the boundaries the server accepts", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, expireAfterSeconds: 0 }),
    ).not.toThrow();
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: 1 }, expireAfterSeconds: 2147483647 }),
    ).not.toThrow();
  });
});

describe("the index of a text field", () => {
  it("refuses a unique text index", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: "text" }, unique: true }),
    ).toThrow();
  });

  it("refuses a unique geospatial index", () => {
    expect(() =>
      MigrationIndexContract.parse({ status: "up", fields: { a: "2dsphere" }, unique: true }),
    ).toThrow();
  });
});

describe("the filter of a partial index", () => {
  it("refuses a key that is a reserved key", () => {
    expect(() =>
      MigrationIndexContract.parse({
        status: "up",
        fields: { a: 1 },
        partialFilterExpression: { __proto__: { $gt: 1 } },
      }),
    ).toThrow();
  });

  it("refuses a partial index that is sparse at the same time", () => {
    expect(() =>
      MigrationIndexContract.parse({
        status: "up",
        fields: { a: 1 },
        sparse: true,
        partialFilterExpression: { a: { $gt: 1 } },
      }),
    ).toThrow();
  });
});

describe("the rules of an ignored field", () => {
  it("keeps the rule the database already has for it", () => {
    const live = {
      $jsonSchema: {
        bsonType: "object",
        properties: { legacy: { bsonType: "decimal" } },
        required: ["legacy"],
      },
    };
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    const merged = mergeIgnoredFields(live, desired, ["legacy"]);

    expect(
      (merged.$jsonSchema as { properties: Record<string, unknown> }).properties.legacy,
    ).toEqual({ bsonType: "decimal" });
    expect((merged.$jsonSchema as { required: string[] }).required).toEqual(["legacy"]);
  });

  it("keeps the rule of an ignored child of a subdocument", () => {
    const live = {
      $jsonSchema: {
        bsonType: "object",
        properties: { vehicle: { bsonType: "object", properties: { legacy: { bsonType: "decimal" } } } },
      },
    };
    const desired = {
      $jsonSchema: {
        bsonType: "object",
        properties: { vehicle: { bsonType: "object", properties: { plate: { bsonType: "string" } } } },
      },
    };

    const merged = mergeIgnoredFields(live, desired, ["vehicle.legacy"]);

    const vehicle = (merged.$jsonSchema as {
      properties: Record<string, { properties: Record<string, unknown> }>;
    }).properties.vehicle;

    expect(vehicle.properties.legacy).toEqual({ bsonType: "decimal" });
    expect(vehicle.properties.plate).toEqual({ bsonType: "string" });
  });

  it("names the ignored children of a subdocument", () => {
    const { ignoredPaths } = buildValidator(
      buildModelDefinition(
        MigrationModelContract.parse({
          name: "Driver",
          fields: {
            vehicle: {
              type: "Subdocument",
              status: "up",
              fields: {
                plate: { type: "String", status: "up" },
                legacy: { type: "Number", status: "ignore" },
              },
            },
          },
        }),
      ),
    );

    expect(ignoredPaths).toEqual(["vehicle.legacy"]);
  });
});

describe("the plan of a model", () => {
  const definition = buildModelDefinition(
    MigrationModelContract.parse({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: "text" }, name: "firstName_text" }],
    }),
  );

  it("compares a text index by the fields it covers", () => {
    const plan = planModel(definition, {
      exists: true,
      validation: { level: "moderate", action: "warn" },
      validator: { $jsonSchema: { bsonType: "object", properties: {} } },
      indexes: [
        {
          name: "firstName_text",
          key: { _fts: "text", _ftsx: 1 },
          weights: { firstName: 1 },
        },
      ],
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.operations).toEqual([]);
  });

  it("says that a hidden index is not used by the query planner", () => {
    const plan = planModel(definition, {
      exists: true,
      validation: { level: "moderate", action: "warn" },
      validator: { $jsonSchema: { bsonType: "object", properties: {} } },
      indexes: [
        {
          name: "firstName_text",
          key: { _fts: "text", _ftsx: 1 },
          weights: { firstName: 1 },
          hidden: true,
        },
      ],
    });

    expect(plan.advisories).toContain('index "firstName_text" is hidden from the query planner');
  });

  it("leaves an index the contract ignores alone", () => {
    const ignored = buildModelDefinition(
      MigrationModelContract.parse({
        name: "Driver",
        collection: "drivers",
        fields: {},
        indexes: [{ status: "ignore", fields: { firstName: 1 }, name: "firstName_1" }],
      }),
    );

    const plan = planModel(ignored, {
      exists: true,
      validation: { level: "moderate", action: "warn" },
      validator: { $jsonSchema: { bsonType: "object", properties: {} } },
      indexes: [{ name: "firstName_1", key: { firstName: 1 } }],
    });

    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("refuses to drop an index that has another key", () => {
    const retired = buildModelDefinition(
      MigrationModelContract.parse({
        name: "Driver",
        collection: "drivers",
        fields: {},
        indexes: [{ status: "down", fields: { firstName: 1 }, name: "firstName_1" }],
      }),
    );

    const plan = planModel(retired, {
      exists: true,
      validation: { level: "moderate", action: "warn" },
      validator: { $jsonSchema: { bsonType: "object", properties: {} } },
      indexes: [{ name: "firstName_1", key: { lastName: 1 } }],
    });

    expect(plan.operations).toEqual([]);
    expect(plan.conflicts[0]).toMatch(/does not drop it/);
  });

  it("sets the validator when the level of the validation changed", () => {
    const plan = planModel(definition, {
      exists: true,
      validation: { level: "strict", action: "warn" },
      validator: { $jsonSchema: { bsonType: "object", properties: {} } },
      indexes: [],
    });

    expect(plan.operations.map((operation) => operation.type)).toEqual(["setValidator"]);
  });
});

describe("the options the applier sends to the server", () => {
  it("sends the validator and the level of the validation", async () => {
    const db = createFakeDb();
    const calls: unknown[] = [];
    const original = db.createCollection.bind(db);

    db.createCollection = async (name: string, options?: Record<string, unknown>) => {
      calls.push(options);

      return original(name, options);
    };

    await applyOperations(asMongoDb(db), [
      { type: "createCollection", collection: "drivers", validator: { $jsonSchema: {} } },
    ], { validationLevel: "strict", validationAction: "error" });

    expect(calls[0]).toMatchObject({
      validator: { $jsonSchema: {} },
      validationLevel: "strict",
      validationAction: "error",
    });
  });

  it("sends the level of the validation with the collMod command", async () => {
    const db = createFakeDb();
    const calls: unknown[] = [];

    db.command = async (command: Record<string, unknown>) => {
      calls.push(command);

      return { ok: 1 };
    };

    await applyOperations(asMongoDb(db), [
      { type: "setValidator", collection: "drivers", validator: { $jsonSchema: {} } },
    ]);

    expect(calls[0]).toMatchObject({
      collMod: "drivers",
      validationLevel: "moderate",
      validationAction: "warn",
    });
  });

  it("stops at the operation that fails", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("conflict", 86);

    await expect(
      applyOperations(asMongoDb(db), [
        {
          type: "createIndex",
          collection: "drivers",
          name: "firstName_1",
          key: { firstName: 1 },
          options: { name: "firstName_1" },
        },
        {
          type: "createIndex",
          collection: "drivers",
          name: "lastName_1",
          key: { lastName: 1 },
          options: { name: "lastName_1" },
        },
      ]),
    ).rejects.toThrow(MigrationError);

    expect(db.collection("drivers").calls).toEqual(["createIndex firstName_1"]);
  });
});

describe("the checksum of a contract", () => {
  it("does not change when the fields move", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: {
        Driver: {
          name: "Driver",
          fields: {
            a: { type: "String", status: "up" },
            b: { type: "String", status: "up" },
          },
        },
      },
    });
    const second = MigrationContract.parse({
      version: "001",
      models: {
        Driver: {
          name: "Driver",
          fields: {
            b: { type: "String", status: "up" },
            a: { type: "String", status: "up" },
          },
        },
      },
    });

    expect(contractChecksum(first)).toBe(contractChecksum(second));
  });
});

describe("the model of an application", () => {
  it("refuses a model that is registered on another collection", async () => {
    const { defineModel } = await import("../../src/mongoose/model");
    const connection = mongoose.createConnection();
    const schema = new mongoose.Schema({ a: String });

    connection.model("Driver", schema, "legacy_drivers");

    expect(() =>
      defineModel({ name: "Driver", collection: "drivers", fields: {} }, connection),
    ).toThrow(MigrationError);

    await connection.close();
  });
});
                                                                         