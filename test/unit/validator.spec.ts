import { describe, expect, it } from "vitest";
import { buildModelDefinition } from "../../src/internal/definition";
import {
  buildValidator,
  isSameValidator,
  mergeIgnoredFields,
} from "../../src/internal/mongo/validator";
import { MigrationModelContract } from "../../src/schemas/contract";

function validate(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildValidator(buildModelDefinition(MigrationModelContract.parse(contract)));
}

describe("the database validator", () => {
  it("writes the type of every field the contract owns", () => {
    const { validator } = validate({
      name: "Driver",
      fields: {
        firstName: { type: "String", status: "up", required: true },
        age: { type: "Number", status: "up" },
        active: { type: "Boolean", status: "up" },
        bornAt: { type: "Date", status: "up" },
        manager: { type: "ObjectId", status: "up" },
        balance: { type: "Decimal128", status: "up" },
        photo: { type: "Buffer", status: "up" },
        externalId: { type: "UUID", status: "up" },
        counter: { type: "BigInt", status: "up" },
        payload: { type: "Mixed", status: "up" },
      },
    });

    const properties = (validator.$jsonSchema as { properties: Record<string, { bsonType: unknown }> })
      .properties;

    expect(properties.firstName.bsonType).toBe("string");
    expect(properties.age.bsonType).toEqual(["number", "null"]);
    expect(properties.active.bsonType).toEqual(["bool", "null"]);
    expect(properties.bornAt.bsonType).toEqual(["date", "null"]);
    expect(properties.manager.bsonType).toEqual(["objectId", "null"]);
    expect(properties.balance.bsonType).toEqual(["decimal", "null"]);
    expect(properties.photo.bsonType).toEqual(["binData", "null"]);
    expect(properties.externalId.bsonType).toEqual(["binData", "null"]);
    expect(properties.counter.bsonType).toEqual(["long", "null"]);
    expect(properties.payload.bsonType).toBeUndefined();
  });

  it("leaves a field that is not required open for null", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { firstName: { type: "String", status: "up" } },
    });

    const properties = (validator.$jsonSchema as { properties: Record<string, { bsonType: unknown }> })
      .properties;

    expect(properties.firstName.bsonType).toEqual(["string", "null"]);
  });

  it("requires a field that has no default", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { firstName: { type: "String", status: "up", required: true } },
    });

    expect((validator.$jsonSchema as { required: string[] }).required).toEqual(["firstName"]);
  });

  it("does not require a field that has a default and says so", () => {
    const { validator, advisories } = validate({
      name: "Driver",
      fields: { firstName: { type: "String", status: "up", required: true, default: "unknown" } },
    });

    expect((validator.$jsonSchema as { required?: string[] }).required).toBeUndefined();
    expect(advisories[0]).toMatch(/backfilled/);
  });

  it("leaves out a field the contract ignores and names it", () => {
    const { validator, ignoredPaths } = validate({
      name: "Driver",
      fields: {
        firstName: { type: "String", status: "up" },
        legacy: { type: "Number", status: "ignore" },
      },
    });

    const properties = (validator.$jsonSchema as { properties: Record<string, unknown> }).properties;

    expect(properties.legacy).toBeUndefined();
    expect(ignoredPaths).toEqual(["legacy"]);
  });

  it("leaves out a field the contract retires", () => {
    const { validator, ignoredPaths } = validate({
      name: "Driver",
      fields: { legacy: { type: "Number", status: "down" } },
    });

    const properties = (validator.$jsonSchema as { properties: Record<string, unknown> }).properties;

    expect(properties.legacy).toBeUndefined();
    expect(ignoredPaths).toEqual([]);
  });

  it("writes the allowed values of a field", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { status: { type: "String", status: "up", enum: ["active", "suspended"] } },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { enum: unknown[] }>;
    }).properties;

    expect(properties.status.enum).toEqual(["active", "suspended", null]);
  });

  it("writes the allowed values of an array on its elements", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { status: { type: "Array", status: "up", enum: ["active"] } },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { items: { enum: unknown[] } }>;
    }).properties;

    expect(properties.status.items.enum).toEqual(["active", null]);
  });

  it("writes the bounds of a string", () => {
    const { validator } = validate({
      name: "Driver",
      fields: {
        code: { type: "String", status: "up", minLength: 2, maxLength: 8, match: "^[A-Z]+$" },
      },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { minLength: number; maxLength: number; pattern: string }>;
    }).properties;

    expect(properties.code.minLength).toBe(2);
    expect(properties.code.maxLength).toBe(8);
    expect(properties.code.pattern).toBe("^[A-Z]+$");
  });

  it("writes the bounds of a number", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { age: { type: "Number", status: "up", min: 18, max: 99 } },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { minimum: number; maximum: number }>;
    }).properties;

    expect(properties.age.minimum).toBe(18);
    expect(properties.age.maximum).toBe(99);
  });

  it("says that the database cannot enforce a date bound", () => {
    const { advisories } = validate({
      name: "Driver",
      fields: { bornAt: { type: "Date", status: "up", min: "2020-01-01" } },
    });

    expect(advisories[0]).toMatch(/cannot enforce/);
  });

  it("writes the type of the elements of an array", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { tags: { type: "Array", status: "up", of: { type: "String", status: "up" } } },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { items: { bsonType: unknown } }>;
    }).properties;

    expect(properties.tags.items.bsonType).toEqual(["string", "null"]);
  });

  it("writes the type of the values of a map", () => {
    const { validator } = validate({
      name: "Driver",
      fields: { labels: { type: "Map", status: "up", of: { type: "String", status: "up" } } },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { additionalProperties: { bsonType: unknown } }>;
    }).properties;

    expect(properties.labels.additionalProperties.bsonType).toEqual(["string", "null"]);
  });

  it("leaves out a child of a subdocument the contract does not own", () => {
    const { validator } = validate({
      name: "Driver",
      fields: {
        vehicle: {
          type: "Subdocument",
          status: "up",
          fields: {
            plate: { type: "String", status: "up" },
            legacy: { type: "String", status: "down" },
          },
        },
      },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { properties: Record<string, unknown> }>;
    }).properties;

    expect(Object.keys(properties.vehicle.properties)).toEqual(["plate"]);
  });

  it("writes the fields of a subdocument", () => {
    const { validator } = validate({
      name: "Driver",
      fields: {
        vehicle: {
          type: "Subdocument",
          status: "up",
          fields: {
            plate: { type: "String", status: "up", required: true },
            seats: { type: "Number", status: "up" },
          },
        },
      },
    });

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { properties: Record<string, unknown>; required: string[] }>;
    }).properties;

    expect(Object.keys(properties.vehicle.properties)).toEqual(["plate", "seats"]);
    expect(properties.vehicle.required).toEqual(["plate"]);
  });
});

describe("the comparison of two validators", () => {
  it("is false when the live validator is missing", () => {
    expect(isSameValidator(undefined, { $jsonSchema: {} })).toBe(false);
  });

  it("ignores the order of the keys", () => {
    const live = { $jsonSchema: { bsonType: "object", properties: { a: { bsonType: "string" } } } };
    const desired = { $jsonSchema: { properties: { a: { bsonType: "string" } }, bsonType: "object" } };

    expect(isSameValidator(live, desired)).toBe(true);
  });

  it("is false when the rules differ", () => {
    const live = { $jsonSchema: { bsonType: "object", properties: { a: { bsonType: "string" } } } };
    const desired = { $jsonSchema: { bsonType: "object", properties: { a: { bsonType: "number" } } } };

    expect(isSameValidator(live, desired)).toBe(false);
  });
});

describe("the merge of the ignored fields", () => {
  it("keeps the rule the database already has for an ignored field", () => {
    const live = {
      $jsonSchema: {
        bsonType: "object",
        properties: { legacy: { bsonType: "decimal" } },
      },
    };
    const desired = { $jsonSchema: { bsonType: "object", properties: { firstName: { bsonType: "string" } } } };

    const merged = mergeIgnoredFields(live, desired, ["legacy"]);

    expect(
      (merged.$jsonSchema as { properties: Record<string, { bsonType: unknown }> }).properties,
    ).toEqual({ firstName: { bsonType: "string" }, legacy: { bsonType: "decimal" } });
  });

  it("keeps the desired validator when there is no live one", () => {
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    expect(mergeIgnoredFields(undefined, desired, ["legacy"])).toBe(desired);
  });

  it("keeps the desired validator when no field is ignored", () => {
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    expect(mergeIgnoredFields({ $jsonSchema: {} }, desired, [])).toBe(desired);
  });

  it("does not add an ignored field the database does not know", () => {
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    const merged = mergeIgnoredFields({ $jsonSchema: { properties: {} } }, desired, ["legacy"]);

    expect((merged.$jsonSchema as { properties: Record<string, unknown> }).properties).toEqual({});
  });
});
