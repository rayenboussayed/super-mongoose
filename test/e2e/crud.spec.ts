import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Connection } from "mongoose";
import { defineModel } from "../../src/mongoose/model";
import { runMigrations } from "../../src/migrator";
import { connectTo, databaseName, dropDatabase, markerOf } from "../helpers/database";
import type { MigrationContractInput, MigrationModelContractInput } from "../../src/schemas/contract";

const contract: MigrationModelContractInput = {
  name: "CrudDriver",
  collection: "crud_drivers",
  fields: {
    marker: { type: "String", status: "up", required: true },
    firstName: { type: "String", status: "up", required: true },
    age: { type: "Number", status: "up", min: 18 },
    status: { type: "String", status: "up", enum: ["active", "suspended"] },
  },
  indexes: [{ status: "up", fields: { marker: 1 }, name: "marker_1" }],
};

const contracts: MigrationContractInput[] = [{ version: "001", models: { CrudDriver: contract } }];

/** The shape of a document of the contract above. */
interface CrudDriver {
  marker: string;
  firstName: string;
  age?: number;
  status?: string;
}

describe("the documents of a model built from a contract", () => {
  let connection: Connection;
  let marker: string;

  beforeEach(async () => {
    connection = await connectTo(databaseName("crud"));
    marker = markerOf("crud");
    await runMigrations(contracts, { connection });
  });

  afterEach(async () => {
    await dropDatabase(connection);
  });

  it("creates a document the contract accepts", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);

    const driver = await Driver.create({ marker, firstName: "Amine", age: 30, status: "active" });

    expect(driver._id).toBeDefined();

    const stored = await connection.db!.collection("crud_drivers").findOne({ marker });

    expect(stored).toMatchObject({ marker, firstName: "Amine", age: 30, status: "active" });
  });

  it("reads a document back", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);
    await Driver.create({ marker, firstName: "Amine" });

    const found = await Driver.findOne({ marker });

    expect(found?.firstName).toBe("Amine");
  });

  it("updates a document", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);
    const driver = await Driver.create({ marker, firstName: "Amine" });

    await Driver.updateOne({ _id: driver._id }, { $set: { firstName: "Sofia" } });

    const stored = await connection.db!.collection("crud_drivers").findOne({ _id: driver._id });

    expect(stored?.firstName).toBe("Sofia");
  });

  it("deletes a document", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);
    const driver = await Driver.create({ marker, firstName: "Amine" });

    const deleted = await Driver.deleteOne({ _id: driver._id });

    expect(deleted.deletedCount).toBe(1);

    const stored = await connection.db!.collection("crud_drivers").findOne({ _id: driver._id });

    expect(stored).toBeNull();
  });

  it("refuses a document that misses a required field", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);

    await expect(Driver.create({ marker })).rejects.toThrow(/firstName/);
  });

  it("refuses a document whose value is not allowed", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);

    await expect(
      Driver.create({ marker, firstName: "Amine", status: "unknown" }),
    ).rejects.toThrow(/status/);
  });

  it("refuses a document whose number is out of range", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);

    await expect(Driver.create({ marker, firstName: "Amine", age: 10 })).rejects.toThrow(/age/);
  });

  it("reports that a document does not exist", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);

    const found = await Driver.findOne({ marker: "no-such-marker" });

    expect(found).toBeNull();
  });

  it("leaves no document behind when the test tears the database down", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);
    await Driver.create({ marker, firstName: "Amine" });

    expect(await connection.db!.collection("crud_drivers").countDocuments({ marker })).toBe(1);
  });

  it("reads a document with the index of the contract", async () => {
    const Driver = defineModel<CrudDriver>(contract, connection);
    await Driver.create({ marker, firstName: "Amine" });

    const explanation = await connection
      .db!.collection("crud_drivers")
      .find({ marker })
      .explain("executionStats");
    const stage = explanation.queryPlanner.winningPlan as {
      inputStage?: { indexName?: string };
    };
    const stats = explanation.executionStats as {
      totalKeysExamined: number;
      totalDocsExamined: number;
      nReturned: number;
      executionTimeMillis: number;
    };

    expect(stage.inputStage?.indexName).toBe("marker_1");
    expect(stats.totalKeysExamined).toBe(1);
    expect(stats.totalDocsExamined).toBe(1);
    expect(stats.nReturned).toBe(1);
    expect(stats.executionTimeMillis).toBeGreaterThanOrEqual(0);
  });

  it("keeps the model the application already registered", async () => {
    const first = defineModel<CrudDriver>(contract, connection);
    const second = defineModel<CrudDriver>(contract, connection);

    expect(second).toBe(first);
  });
});
