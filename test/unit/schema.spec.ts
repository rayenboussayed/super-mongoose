import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { Schem, buildSchema } from "../../src/mongoose/schema";
import { buildModelDefinition } from "../../src/internal/definition";
import { MigrationModelContract } from "../../src/schemas/contract";

function schemaOf(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildSchema(buildModelDefinition(MigrationModelContract.parse(contract)));
}

let modelCount = 0;

function documentOf(schema: mongoose.Schema, values: Record<string, unknown>) {
  modelCount += 1;

  const Model = mongoose.model(`SchemaTest${modelCount}`, schema);

  return new Model(values);
}

describe("the schema of a contract", () => {
  it("declares the fields the contract owns", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        firstName: { type: "String", status: "up", required: true },
        age: { type: "Number", status: "up" },
      },
    });

    expect(schema.paths.firstName).toBeDefined();
    expect(schema.paths.age).toBeDefined();
  });

  it("leaves out the fields the contract retires", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { legacy: { type: "String", status: "down" } },
    });

    expect(schema.paths.legacy).toBeUndefined();
  });

  it("declares the fields the contract ignores so the application keeps working", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { legacy: { type: "String", status: "ignore" } },
    });

    expect(schema.paths.legacy).toBeDefined();
  });

  it("names the collection of the contract", () => {
    const schema = schemaOf({ name: "Driver", collection: "legacy_drivers", fields: {} });

    expect(schema.get("collection")).toBe("legacy_drivers");
  });

  it("does not let mongoose create the indexes, the runner owns them", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { email: { type: "String", status: "up", unique: true } },
    });

    expect(schema.options.autoIndex).toBe(false);
  });

  it("does not let mongoose create the collection, the runner owns it", () => {
    const schema = schemaOf({ name: "Driver", fields: {} });

    expect(schema.options.autoCreate).toBe(false);
  });

  it("declares the indexes with the name the runner uses", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    expect(schema.indexes()).toEqual([[{ firstName: 1 }, { name: "firstName_1" }]]);
  });

  it("does not declare an index the contract retires", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {},
      indexes: [{ status: "down", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    expect(schema.indexes()).toEqual([]);
  });

  it("builds an array of the type the contract declares", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { tags: { type: "Array", status: "up", of: { type: "String", status: "up" } } },
    });

    const document = documentOf(schema, { tags: ["a", "b"] });

    expect(document.get("tags")).toEqual(["a", "b"]);
  });

  it("keeps the rules of the elements of an array", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        tags: { type: "Array", status: "up", of: { type: "String", status: "up", enum: ["a"] } },
      },
    });

    const document = documentOf(schema, { tags: ["b"] });

    expect(document.validateSync()?.message).toMatch(/not a valid enum value/);
  });

  it("builds a map of the type the contract declares", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { labels: { type: "Map", status: "up", of: { type: "String", status: "up" } } },
    });

    const document = documentOf(schema, { labels: { a: "b" } });

    expect((document.get("labels") as Map<string, string>).get("a")).toBe("b");
  });

  it("builds a subdocument with the fields the contract declares", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        vehicle: {
          type: "Subdocument",
          status: "up",
          fields: { plate: { type: "String", status: "up", required: true } },
        },
      },
    });

    const document = documentOf(schema, { vehicle: {} });

    expect(document.validateSync()?.message).toMatch(/plate/);
  });

  it("keeps the string rules of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        code: { type: "String", status: "up", minLength: 2, maxLength: 4, trim: true, lowercase: true },
      },
    });

    const document = documentOf(schema, { code: "  ABCDE  " });

    expect(document.get("code")).toBe("abcde");
    expect(document.validateSync()?.message).toMatch(/longer than the maximum/);
  });

  it("keeps the numeric rules of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { age: { type: "Number", status: "up", min: 18, max: 99 } },
    });

    const document = documentOf(schema, { age: 10 });

    expect(document.validateSync()?.message).toMatch(/less than minimum/);
  });

  it("keeps the reference of an object id", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { manager: { type: "ObjectId", status: "up", ref: "Driver" } },
    });

    expect(schema.paths.manager.options.ref).toBe("Driver");
  });

  it("keeps the immutability and the selection of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        token: { type: "String", status: "up", immutable: true, select: false },
      },
    });

    expect(schema.paths.token.options.immutable).toBe(true);
    expect(schema.paths.token.options.select).toBe(false);
  });

  it("adds the timestamps the contract asks for", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {},
      options: { timestamps: true },
    });

    expect(schema.paths.createdAt).toBeDefined();
    expect(schema.paths.updatedAt).toBeDefined();
  });

  it("leaves the timestamps out when the contract asks for it", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {},
      options: { timestamps: false },
    });

    expect(schema.paths.createdAt).toBeUndefined();
  });

  it("builds a schema straight from a contract", () => {
    const schema = Schem.fromContract({
      name: "Driver",
      collection: "drivers",
      fields: { firstName: { type: "String", status: "up", required: true } },
    });

    expect(schema).toBeInstanceOf(mongoose.Schema);
    expect(schema.paths.firstName).toBeDefined();
  });

  it("refuses a contract that does not match the migration schema", () => {
    expect(() => Schem.fromContract({ name: "Driver" } as never)).toThrow();
  });
});
