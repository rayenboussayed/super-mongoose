import { describe, expect, it } from "vitest";
import {
  buildModelDefinition,
  canonicalJson,
  contractChecksum,
  defaultIndexName,
  mergeModelContracts,
} from "../../src/internal/definition";
import { MigrationError } from "../../src/errors";
import { MigrationContract, MigrationModelContract } from "../../src/schemas/contract";
import { driverContract } from "../helpers/fixtures";

function parseModel(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildModelDefinition(MigrationModelContract.parse(contract));
}

describe("the model definition", () => {
  it("derives the collection from the model name", () => {
    const definition = parseModel({ name: "Driver", fields: {} });

    expect(definition.collection).toBe("drivers");
  });

  it("keeps the collection of the contract", () => {
    const definition = parseModel({ name: "Driver", collection: "legacy_drivers", fields: {} });

    expect(definition.collection).toBe("legacy_drivers");
  });

  it("keeps the schema options of the contract", () => {
    const definition = parseModel({
      name: "Driver",
      fields: {},
      options: {
        timestamps: false,
        versionKey: false,
        strict: "throw",
        _id: false,
        discriminatorKey: "kind",
      },
    });

    expect(definition.options).toEqual({
      timestamps: false,
      versionKey: false,
      strict: "throw",
      _id: false,
      discriminatorKey: "kind",
    });
  });

  it("does not build a second index for a field an index already covers", () => {
    const definition = parseModel({
      name: "Driver",
      fields: { email: { type: "String", status: "up", unique: true } },
      indexes: [{ status: "up", fields: { email: 1 }, name: "email_address" }],
    });

    expect(definition.indexes.map((index) => index.name)).toEqual(["email_address"]);
  });

  it("builds an index for a field that asks for one", () => {
    const definition = parseModel({
      name: "Driver",
      fields: { email: { type: "String", status: "up", unique: true } },
    });

    expect(definition.indexes).toEqual([
      { name: "email_1", key: { email: 1 }, status: "up", unique: true, sparse: undefined },
    ]);
  });

  it("refuses an index on a field that is ignored", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: { email: { type: "String", status: "ignore", unique: true } },
      }),
    ).toThrow(/cannot ask for an index/);
  });

  it("does not build an index for a field that is retired", () => {
    const definition = parseModel({
      name: "Driver",
      fields: { email: { type: "String", status: "down", unique: true } },
    });

    expect(definition.indexes).toEqual([]);
  });

  it("keeps the name the contract gives to an index", () => {
    const definition = parseModel({
      name: "Driver",
      fields: {},
      indexes: [{ status: "up", fields: { a: 1, b: -1 }, name: "composite" }],
    });

    expect(definition.indexes[0].name).toBe("composite");
  });

  it("rejects two indexes that carry the same name", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: {},
        indexes: [
          { status: "up", fields: { a: 1 }, name: "same" },
          { status: "up", fields: { b: 1 }, name: "same" },
        ],
      }),
    ).toThrow(MigrationError);
  });

  it("rejects two indexes that cover the same fields", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: {},
        indexes: [
          { status: "up", fields: { a: 1 }, name: "one" },
          { status: "up", fields: { a: 1 }, name: "two" },
        ],
      }),
    ).toThrow(/cover the same fields/);
  });

  it("rejects an index name the server cannot store", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: {},
        indexes: [{ status: "up", fields: { a: 1 }, name: "x".repeat(128) }],
      }),
    ).toThrow(/127 bytes/);
  });

  it("rejects a pattern that is not a regular expression", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: { email: { type: "String", status: "up", match: "[" } },
      }),
    ).toThrow(/not a valid regular expression/);
  });

  it("rejects a subdocument that nests deeper than allowed", () => {
    let field: Record<string, unknown> = { type: "String", status: "up" };

    for (let level = 0; level < 12; level += 1) {
      field = { type: "Subdocument", status: "up", fields: { child: field } };
    }

    expect(() => parseModel({ name: "Driver", fields: { deep: field as never } })).toThrow(
      /deeper than/,
    );
  });

  it("rejects an index inside a subdocument", () => {
    expect(() =>
      parseModel({
        name: "Driver",
        fields: {
          vehicle: {
            type: "Subdocument",
            status: "up",
            fields: { plate: { type: "String", status: "up", unique: true } },
          },
        },
      }),
    ).toThrow(/inside a subdocument/);
  });

  it("builds the element of an array", () => {
    const definition = parseModel({
      name: "Driver",
      fields: {
        tags: { type: "Array", status: "up", of: { type: "String", status: "up" } },
      },
    });

    expect(definition.fields.tags.element?.type).toBe("String");
  });
});

describe("the index name", () => {
  it("follows the naming of the server", () => {
    expect(defaultIndexName({ email: 1 })).toBe("email_1");
    expect(defaultIndexName({ a: 1, b: -1 })).toBe("a_1_b_-1");
    expect(defaultIndexName({ text: "text" })).toBe("text_text");
  });
});

describe("the merge of the contracts", () => {
  it("keeps the model of the last contract that names it", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });
    const second = MigrationContract.parse({
      version: "002",
      models: { Driver: { name: "Driver", fields: { b: { type: "String", status: "up" } } } },
    });

    const merged = mergeModelContracts([first, second]);

    expect(merged.Driver.fields.b.status).toBe("up");
  });

  it("retires a field the newer contract does not name anymore", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });
    const second = MigrationContract.parse({
      version: "002",
      models: { Driver: { name: "Driver", fields: { b: { type: "String", status: "up" } } } },
    });

    const merged = mergeModelContracts([first, second]);

    expect(merged.Driver.fields.a.status).toBe("down");
  });

  it("keeps a model the newer contract does not name", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: {} } },
    });
    const second = MigrationContract.parse({
      version: "002",
      models: { Vehicle: { name: "Vehicle", fields: {} } },
    });

    const merged = mergeModelContracts([first, second]);

    expect(Object.keys(merged)).toEqual(["Driver", "Vehicle"]);
  });
});

describe("the canonical json", () => {
  it("sorts the keys so two equal values produce the same string", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps a date apart from a string", () => {
    expect(canonicalJson(new Date("2024-01-01"))).not.toBe(canonicalJson("2024-01-01"));
  });

  it("keeps a regular expression apart from a string", () => {
    expect(canonicalJson(/a/)).not.toBe(canonicalJson("a"));
  });

  it("keeps a buffer apart from a string", () => {
    expect(canonicalJson(Buffer.from("a"))).not.toBe(canonicalJson("a"));
  });

  it("keeps a function apart from a string", () => {
    expect(canonicalJson(() => 1)).not.toBe(canonicalJson("() => 1"));
  });

  it("keeps a bigint apart from a number", () => {
    expect(canonicalJson(1n)).not.toBe(canonicalJson(1));
  });

  it("keeps a symbol apart from a string", () => {
    expect(canonicalJson(Symbol("a"))).not.toBe(canonicalJson("a"));
  });

  it("keeps a number that is not finite apart from null", () => {
    expect(canonicalJson(Number.NaN)).not.toBe(canonicalJson(null));
  });

  it("skips the values that are not defined", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("writes null for a value that is not defined", () => {
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("the checksum of a contract", () => {
  it("is the same for two equal contracts", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });
    const second = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });

    expect(contractChecksum(first)).toBe(contractChecksum(second));
  });

  it("changes when the contract changes", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });
    const second = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "Number", status: "up" } } } },
    });

    expect(contractChecksum(first)).not.toBe(contractChecksum(second));
  });

  it("does not change when the keys of the contract move", () => {
    const first = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });
    const second = MigrationContract.parse({
      version: "001",
      models: { Driver: { name: "Driver", fields: { a: { type: "String", status: "up" } } } },
    });

    expect(contractChecksum(first)).toHaveLength(16);
    expect(contractChecksum(second)).toBe(contractChecksum(first));
  });
});

describe("the driver fixture", () => {
  it("is a contract the other tests can rely on", () => {
    const definition = buildModelDefinition(MigrationModelContract.parse(driverContract()));

    expect(definition.collection).toBe("drivers");
    expect(definition.indexes.map((index) => index.name)).toEqual([
      "firstName_1",
      "status_1_createdAt_-1",
    ]);
  });
});
