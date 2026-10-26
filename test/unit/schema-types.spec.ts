import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { Schem, buildSchema } from "../../src/mongoose/schema";
import { buildModelDefinition } from "../../src/internal/definition";
import { MigrationError } from "../../src/errors";
import { MigrationModelContract } from "../../src/schemas/contract";

function schemaOf(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildSchema(buildModelDefinition(MigrationModelContract.parse(contract)));
}

describe("the types of a contract", () => {
  it("maps every type onto the type of mongoose", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: {
        text: { type: "String", status: "up" },
        count: { type: "Number", status: "up" },
        flag: { type: "Boolean", status: "up" },
        moment: { type: "Date", status: "up" },
        owner: { type: "ObjectId", status: "up" },
        amount: { type: "Decimal128", status: "up" },
        photo: { type: "Buffer", status: "up" },
        external: { type: "UUID", status: "up" },
        counter: { type: "BigInt", status: "up" },
        payload: { type: "Mixed", status: "up" },
      },
    });

    expect(schema.paths.text.instance).toBe("String");
    expect(schema.paths.count.instance).toBe("Number");
    expect(schema.paths.flag.instance).toBe("Boolean");
    expect(schema.paths.moment.instance).toBe("Date");
    expect(schema.paths.owner.instance).toBe("ObjectId");
    expect(schema.paths.amount.instance).toBe("Decimal128");
    expect(schema.paths.photo.instance).toBe("Buffer");
    expect(schema.paths.external.instance).toBe("UUID");
    expect(schema.paths.counter.instance).toBe("BigInt");
    expect(schema.paths.payload.instance).toBe("Mixed");
  });

  it("refuses a type the installed mongoose does not have", () => {
    const bigInt = mongoose.Schema.Types.BigInt;

    delete (mongoose.Schema.Types as Record<string, unknown>).BigInt;

    try {
      expect(() =>
        Schem.fromContract({
          name: "Driver",
          fields: { counter: { type: "BigInt", status: "up" } },
        }),
      ).toThrow(MigrationError);
    } finally {
      (mongoose.Schema.Types as Record<string, unknown>).BigInt = bigInt;
    }
  });

  it("builds an array whose element type the contract does not declare", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { payload: { type: "Array", status: "up" } },
    });

    expect(schema.paths.payload.instance).toBe("Array");
  });
});

describe("the options of a field of a schema", () => {
  it("keeps the default of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { status: { type: "String", status: "up", default: "active" } },
    });

    expect(schema.paths.status.options.default).toBe("active");
  });

  it("keeps the allowed values of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { status: { type: "String", status: "up", enum: ["active", "suspended"] } },
    });

    expect(schema.paths.status.options.enum).toEqual(["active", "suspended"]);
  });

  it("keeps the pattern of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { code: { type: "String", status: "up", match: "^[A-Z]+$" } },
    });

    expect(schema.paths.code.options.match).toBeInstanceOf(RegExp);
  });

  it("keeps the uppercase of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { code: { type: "String", status: "up", uppercase: true } },
    });

    expect(schema.paths.code.options.uppercase).toBe(true);
  });

  it("keeps the length of a field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { code: { type: "String", status: "up", minLength: 2, maxLength: 4 } },
    });

    expect(schema.paths.code.options.minLength).toBe(2);
    expect(schema.paths.code.options.maxLength).toBe(4);
  });

  it("keeps the bound of a date field", () => {
    const schema = schemaOf({
      name: "Driver",
      fields: { bornAt: { type: "Date", status: "up", min: "2020-01-01", max: "2030-01-01" } },
    });

    expect(schema.paths.bornAt.options.min).toBe("2020-01-01");
    expect(schema.paths.bornAt.options.max).toBe("2030-01-01");
  });
});
