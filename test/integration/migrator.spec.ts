import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Connection, mongo } from "mongoose";
import { migrationStatus, planMigrations, runMigrations } from "../../src/migrator";
import { MigrationError } from "../../src/errors";
import { MIGRATION_COLLECTION } from "../../src/internal/migration/ledger";
import { MIGRATION_LOCK_COLLECTION } from "../../src/internal/migration/lock";
import type { MigrationLockDocument } from "../../src/internal/migration/lock";
import { connectTo, databaseName, dropDatabase } from "../helpers/database";
import { driverContract } from "../helpers/fixtures";
import type { MigrationContractInput } from "../../src/schemas/contract";

const contracts: MigrationContractInput[] = [
  { version: "001", models: { Driver: driverContract() } },
];

describe("the migrator against a real MongoDB", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = await connectTo(databaseName("migrator"));
  });

  afterEach(async () => {
    await dropDatabase(connection);
  });

  it("creates the collection, the indexes and the validator", async () => {
    const result = await runMigrations(contracts, { connection });

    expect(result.applied).toEqual(["001"]);

    const [info] = (await connection.db!.listCollections({ name: "drivers" }).toArray()) as mongo.CollectionInfo[];
    const indexes = await connection.db!.collection("drivers").listIndexes().toArray();
    const validator = info.options?.validator as { $jsonSchema: { properties: Record<string, unknown> } };

    expect(info.name).toBe("drivers");
    expect(indexes.map((index) => index.name).sort()).toEqual([
      "_id_",
      "firstName_1",
      "status_1_createdAt_-1",
    ]);
    expect(validator.$jsonSchema.properties).toHaveProperty("firstName");
  });

  it("records the applied version in the ledger", async () => {
    await runMigrations(contracts, { connection });

    const rows = await connection.db!.collection(MIGRATION_COLLECTION).find({}).toArray();

    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("001");
    expect(typeof rows[0].checksum).toBe("string");
    expect(rows[0].schema).toHaveProperty("Driver");
  });

  it("does nothing on a second run", async () => {
    await runMigrations(contracts, { connection });

    const result = await runMigrations(contracts, { connection });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["001"]);
    expect(result.operations).toEqual([]);
  });

  it("plans the difference without writing anything", async () => {
    const plan = await planMigrations(contracts, { connection });

    expect(plan.models.flatMap((model) => model.operations).map((operation) => operation.type)).toEqual([
      "createCollection",
      "createIndex",
      "createIndex",
    ]);

    const collections = await connection.db!.listCollections().toArray();

    expect(collections.map((collection) => collection.name)).not.toContain("drivers");
  });

  it("plans nothing when the database already matches the contract", async () => {
    await runMigrations(contracts, { connection });

    const plan = await planMigrations(contracts, { connection });

    expect(plan.models.flatMap((model) => model.operations)).toEqual([]);
    expect(plan.models.flatMap((model) => model.conflicts)).toEqual([]);
  });

  it("reports the versions that were applied and the ones that are pending", async () => {
    const before = await migrationStatus(contracts, { connection });

    expect(before.applied).toEqual([]);
    expect(before.pending).toEqual(["001"]);

    await runMigrations(contracts, { connection });

    const after = await migrationStatus(contracts, { connection });

    expect(after.applied.map((row) => row.version)).toEqual(["001"]);
    expect(after.pending).toEqual([]);
    expect(after.operations).toBe(0);
  });

  it("refuses a contract that changed after it was applied", async () => {
    await runMigrations(contracts, { connection });

    const changed = [
      {
        version: "001",
        models: {
          Driver: { ...driverContract(), fields: { ...driverContract().fields, age: { type: "Number" as const, status: "up" as const } } },
        },
      },
    ];

    await expect(runMigrations(changed, { connection })).rejects.toThrow(MigrationError);
    await expect(runMigrations(changed, { connection })).rejects.toThrow(
      /changed after it was applied/,
    );
  });

  it("refuses to run when another runner holds the lock", async () => {
    await connection
      .db!.collection<MigrationLockDocument>(MIGRATION_LOCK_COLLECTION)
      .insertOne({
        _id: "super-mongoose",
        owner: "another-runner",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

    await expect(runMigrations(contracts, { connection })).rejects.toThrow(/holds the lock/);
  });

  it("takes over a lock that expired", async () => {
    await connection
      .db!.collection<MigrationLockDocument>(MIGRATION_LOCK_COLLECTION)
      .insertOne({
        _id: "super-mongoose",
        owner: "another-runner",
        createdAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
      });

    const result = await runMigrations(contracts, { connection });

    expect(result.applied).toEqual(["001"]);
  });

  it("leaves the lock collection empty after a run", async () => {
    await runMigrations(contracts, { connection });

    const locks = await connection.db!.collection(MIGRATION_LOCK_COLLECTION).find({}).toArray();

    expect(locks).toEqual([]);
  });

  it("refuses to work when the database holds an index the contract declares differently", async () => {
    await connection.db!.createCollection("drivers");
    await connection.db!.collection("drivers").createIndex({ lastName: 1 }, { name: "firstName_1" });

    await expect(runMigrations(contracts, { connection })).rejects.toThrow(
      /drop it and run the migration again/,
    );
  });

  it("drops an index a later contract retires", async () => {
    await runMigrations(contracts, { connection });

    const retired: MigrationContractInput[] = [
      { version: "001", models: { Driver: driverContract() } },
      {
        version: "002",
        models: {
          Driver: {
            ...driverContract(),
            indexes: [
              { status: "down", fields: { firstName: 1 }, name: "firstName_1" },
              { status: "up", fields: { status: 1, createdAt: -1 }, name: "status_1_createdAt_-1" },
            ],
          },
        },
      },
    ];

    const result = await runMigrations(retired, { connection });

    expect(result.applied).toEqual(["002"]);

    const indexes = await connection.db!.collection("drivers").listIndexes().toArray();

    expect(indexes.map((index) => index.name)).not.toContain("firstName_1");
    expect(indexes.map((index) => index.name)).toContain("status_1_createdAt_-1");
  });

  it("sets the validator of a collection that already exists", async () => {
    await connection.db!.createCollection("drivers");

    const result = await runMigrations(contracts, { connection });

    expect(result.operations.map((operation) => operation.type)).toContain("setValidator");

    const [info] = (await connection.db!.listCollections({ name: "drivers" }).toArray()) as mongo.CollectionInfo[];
    const validator = info.options?.validator as { $jsonSchema: { properties: Record<string, unknown> } };

    expect(validator.$jsonSchema.properties).toHaveProperty("firstName");
  });

  it("rejects a document the validator does not accept when the action is error", async () => {
    await runMigrations(contracts, { connection, validationAction: "error" });

    await expect(
      connection.db!.collection("drivers").insertOne({ firstName: 42 }),
    ).rejects.toThrow(/failed validation/i);
  });

  it("keeps a document the validator does not accept when the action is warn", async () => {
    await runMigrations(contracts, { connection });

    const result = await connection.db!.collection("drivers").insertOne({ firstName: 42 });

    expect(result.acknowledged).toBe(true);
  });

  it("reads the ledger with the index on the version", async () => {
    await runMigrations(contracts, { connection });

    const explanation = await connection
      .db!.collection(MIGRATION_COLLECTION)
      .find({ version: "001" })
      .explain("executionStats");
    const stage = explanation.queryPlanner.winningPlan as {
      inputStage?: { indexName?: string; stage?: string };
    };
    const stats = explanation.executionStats as {
      totalKeysExamined: number;
      totalDocsExamined: number;
      nReturned: number;
      executionTimeMillis: number;
    };

    expect(stage.inputStage?.indexName).toBe("version_1");
    expect(stats.totalKeysExamined).toBe(1);
    expect(stats.totalDocsExamined).toBe(1);
    expect(stats.nReturned).toBe(1);
    expect(stats.executionTimeMillis).toBeGreaterThanOrEqual(0);
  });
});
