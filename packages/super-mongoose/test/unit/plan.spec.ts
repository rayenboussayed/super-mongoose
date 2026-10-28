import { describe, expect, it } from "vitest";
import { buildModelDefinition } from "../../src/internal/definition";
import type { ModelDefinition } from "../../src/internal/definition";
import { planModel } from "../../src/migrator/plan";
import type { CollectionState } from "../../src/internal/mongo/state";
import { buildValidator } from "../../src/internal/mongo/validator";
import { MigrationModelContract } from "../../src/schemas/contract";

function definitionOf(contract: Parameters<typeof MigrationModelContract.parse>[0]) {
  return buildModelDefinition(MigrationModelContract.parse(contract));
}

const emptyState: CollectionState = { exists: false, indexes: [] };

/**
 * A live collection that already carries the validator of the contract, so a
 * test only sees the operations of the indexes.
 *
 * @param definition - The declared state of the model.
 * @param indexes - The indexes the collection holds.
 * @returns The live state of the collection.
 */
function liveState(
  definition: ModelDefinition,
  indexes: CollectionState["indexes"] = [],
): CollectionState {
  return {
    exists: true,
    indexes,
    validator: buildValidator(definition).validator,
    validation: { level: "moderate", action: "warn" },
  };
}

describe("the plan of a model", () => {
  it("creates the collection when it does not exist", () => {
    const plan = planModel(
      definitionOf({ name: "Driver", collection: "drivers", fields: {} }),
      emptyState,
    );

    expect(plan.operations).toEqual([
      {
        type: "createCollection",
        collection: "drivers",
        validator: expect.objectContaining({ $jsonSchema: expect.anything() }),
      },
    ]);
  });

  it("sets the validator when the collection has none", () => {
    const plan = planModel(
      definitionOf({ name: "Driver", collection: "drivers", fields: {} }),
      { exists: true, indexes: [] },
    );

    expect(plan.operations.map((operation) => operation.type)).toEqual(["setValidator"]);
  });

  it("does nothing when the collection already has the validator", () => {
    const definition = definitionOf({ name: "Driver", collection: "drivers", fields: {} });
    const state: CollectionState = {
      exists: true,
      indexes: [],
      validation: { level: "moderate", action: "warn" },
      validator: {
        $jsonSchema: {
          bsonType: "object",
          properties: {},
        },
      },
    };

    const plan = planModel(definition, state);

    expect(plan.operations).toEqual([]);
  });

  it("keeps the rule the database has for an ignored field", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: { legacy: { type: "Number", status: "ignore" } },
    });
    const state: CollectionState = {
      exists: true,
      indexes: [],
      validation: { level: "moderate", action: "warn" },
      validator: {
        $jsonSchema: {
          bsonType: "object",
          properties: { legacy: { bsonType: "decimal" } },
        },
      },
    };

    const plan = planModel(definition, state);

    expect(plan.operations).toEqual([]);
  });

  it("creates an index the database does not have", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    const plan = planModel(definition, liveState(definition));

    expect(plan.operations).toEqual([
      {
        type: "createIndex",
        collection: "drivers",
        name: "firstName_1",
        key: { firstName: 1 },
        options: { name: "firstName_1" },
      },
    ]);
  });

  it("does nothing when the index is already there", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "firstName_1", key: { firstName: 1 } }]),
    );

    expect(plan.operations).toEqual([]);
  });

  it("reports a conflict when an index has the same name and another key", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "theIndex" }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "theIndex", key: { lastName: 1 } }]),
    );

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatch(/drop it and run the migration again/);
  });

  it("reports a conflict when an index has the same name and another option", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "theIndex", unique: true }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "theIndex", key: { firstName: 1 } }]),
    );

    expect(plan.conflicts).toHaveLength(1);
  });

  it("leaves an index of another name alone and says so", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "legacy_firstName", key: { firstName: 1 } }]),
    );

    expect(plan.operations).toEqual([]);
    expect(plan.advisories[0]).toMatch(/already exists as "legacy_firstName"/);
  });

  it("reports a conflict when an index of another name has another option", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1", unique: true }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "legacy_firstName", key: { firstName: 1 } }]),
    );

    expect(plan.conflicts).toHaveLength(1);
  });

  it("drops an index the contract retires", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "down", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    const plan = planModel(
      definition,
      liveState(definition, [{ name: "firstName_1", key: { firstName: 1 } }]),
    );

    expect(plan.operations).toEqual([
      { type: "dropIndex", collection: "drivers", name: "firstName_1" },
    ]);
  });

  it("does not drop an index the contract retires when it is not there", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: {},
      indexes: [{ status: "down", fields: { firstName: 1 }, name: "firstName_1" }],
    });

    const plan = planModel(definition, liveState(definition));

    expect(plan.operations).toEqual([]);
  });

  it("reports the indexes the contract does not own", () => {
    const definition = definitionOf({ name: "Driver", collection: "drivers", fields: {} });

    const plan = planModel(
      definition,
      liveState(definition, [
        { name: "_id_", key: { _id: 1 } },
        { name: "legacy", key: { legacy: 1 } },
      ]),
    );

    expect(plan.advisories).toContain("index \"legacy\" of \"drivers\" is not owned by the contract");
  });

  it("says that a retired field keeps its value in the stored documents", () => {
    const definition = definitionOf({
      name: "Driver",
      collection: "drivers",
      fields: { legacy: { type: "String", status: "down" } },
    });

    const plan = planModel(definition, liveState(definition));

    expect(plan.advisories[0]).toMatch(/keep their value/);
  });
});
