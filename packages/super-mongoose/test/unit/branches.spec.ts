import { describe, expect, it } from "vitest";
import { buildModelDefinition, canonicalJson } from "../../src/internal/definition";
import { buildValidator, mergeIgnoredFields } from "../../src/internal/mongo/validator";
import { MigrationModelContract } from "../../src/schemas/contract";

function definitionOf(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildModelDefinition(MigrationModelContract.parse(contract));
}

describe("the branches the layer does not take in the usual case", () => {
  it("names an index the contract does not name after its fields", () => {
    const definition = definitionOf({
      name: "Driver",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 } }],
    });

    expect(definition.indexes[0].name).toBe("firstName_1");
  });

  it("sorts the keys of a value whatever their order is", () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
    expect(canonicalJson({ c: 3, b: 1, a: 2 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it("writes the allowed values of a field that is required", () => {
    const { validator } = buildValidator(
      definitionOf({
        name: "Driver",
        fields: { status: { type: "String", status: "up", required: true, enum: ["active"] } },
      }),
    );

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { enum: unknown[] }>;
    }).properties;

    expect(properties.status.enum).toEqual(["active"]);
  });

  it("writes the allowed values of the elements of an array that are required", () => {
    const { validator } = buildValidator(
      definitionOf({
        name: "Driver",
        fields: {
          tags: {
            type: "Array",
            status: "up",
            enum: ["active"],
            of: { type: "String", status: "up", required: true },
          },
        },
      }),
    );

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { items: { enum: unknown[] } }>;
    }).properties;

    expect(properties.tags.items.enum).toEqual(["active"]);
  });

  it("writes the allowed values of an array without an element type", () => {
    const { validator } = buildValidator(
      definitionOf({
        name: "Driver",
        fields: { tags: { type: "Array", status: "up", enum: ["active"] } },
      }),
    );

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { items: { enum: unknown[] } }>;
    }).properties;

    expect(properties.tags.items.enum).toEqual(["active", null]);
  });

  it("writes the values of a map without an element type", () => {
    const { validator } = buildValidator(
      definitionOf({
        name: "Driver",
        fields: { labels: { type: "Map", status: "up" } },
      }),
    );

    const properties = (validator.$jsonSchema as {
      properties: Record<string, { additionalProperties: unknown }>;
    }).properties;

    expect(properties.labels.additionalProperties).toEqual({});
  });

  it("keeps the rules of an ignored field when the live validator has no properties", () => {
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    const merged = mergeIgnoredFields({ $jsonSchema: {} }, desired, ["legacy"]);

    expect(merged.$jsonSchema).toEqual({
      bsonType: "object",
      properties: {},
    });
  });

  it("keeps the rules of an ignored field when the live validator has no schema", () => {
    const desired = { $jsonSchema: { bsonType: "object", properties: {} } };

    const merged = mergeIgnoredFields({}, desired, ["legacy"]);

    expect((merged.$jsonSchema as { properties: Record<string, unknown> }).properties).toEqual({});
  });

  it("keeps the rules of an ignored field when the desired validator has no properties", () => {
    const live = { $jsonSchema: { properties: { legacy: { bsonType: "decimal" } } } };
    const desired = { $jsonSchema: { bsonType: "object" } };

    const merged = mergeIgnoredFields(live, desired, ["legacy"]);

    expect((merged.$jsonSchema as { properties: Record<string, unknown> }).properties).toEqual({
      legacy: { bsonType: "decimal" },
    });
  });
});
