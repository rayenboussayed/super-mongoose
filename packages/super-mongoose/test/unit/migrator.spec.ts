import { describe, expect, it } from "vitest";
import { migrationStatus, planMigrations, runMigrations } from "../../src/migrator";
import { MigrationError } from "../../src/errors";
import { createFakeConnection, createFakeDb } from "../helpers/fake-db";
import { driverContract } from "../helpers/fixtures";

const contracts = [
  {
    version: "001",
    models: { Driver: driverContract() },
  },
];

describe("the migrator", () => {
  it("refuses to work without an open connection", async () => {
    const connection = createFakeConnection(createFakeDb(), 0);

    await expect(planMigrations(contracts, { connection })).rejects.toThrow(
      /connection is not open/,
    );
  });

  it("refuses a contract that does not match the migration schema", async () => {
    const connection = createFakeConnection(createFakeDb());

    await expect(
      planMigrations([{ models: {} } as never], { connection }),
    ).rejects.toThrow();
  });

  it("refuses two contracts with the same version", async () => {
    const connection = createFakeConnection(createFakeDb());

    await expect(
      planMigrations([contracts[0], contracts[0]], { connection }),
    ).rejects.toThrow(/declared twice/);
  });

  it("plans the difference without writing anything", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);

    const plan = await planMigrations(contracts, { connection });

    expect(plan.models.flatMap((model) => model.operations).map((operation) => operation.type)).toEqual([
      "createCollection",
      "createIndex",
      "createIndex",
    ]);
    expect(db.calls).toEqual(["listCollections drivers"]);
  });

  it("reports the versions that were applied and the ones that are pending", async () => {
    const connection = createFakeConnection(createFakeDb());

    const status = await migrationStatus(contracts, { connection });

    expect(status.applied).toEqual([]);
    expect(status.pending).toEqual(["001"]);
    expect(status.operations).toBe(3);
  });

  it("records the version it applied", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);
    const recorded: Record<string, unknown>[] = [];
    const model = {
      find: () => ({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      create: async (entry: Record<string, unknown>) => {
        recorded.push(entry);

        return entry;
      },
    };
    connection.setModel("__migrations", model);

    const result = await runMigrations(contracts, { connection });

    expect(result.applied).toEqual(["001"]);
    expect(result.skipped).toEqual([]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].version).toBe("001");
  });

  it("skips a version that was applied before", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);
    const model = {
      find: () => ({
        sort: () => ({
          lean: () => ({
            exec: async () => [
              { version: "001", checksum: "wrong", appliedAt: new Date(), schema: {} },
            ],
          }),
        }),
      }),
      create: async () => undefined,
    };
    connection.setModel("__migrations", model);

    await expect(runMigrations(contracts, { connection })).rejects.toThrow(
      /changed after it was applied/,
    );
  });

  it("reports the indexes the contract does not own", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);
    const model = {
      find: () => ({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      create: async () => undefined,
    };
    connection.setModel("__migrations", model);
    db.collections.set("drivers", {
      name: "drivers",
      indexes: { legacy: { key: { legacy: 1 } } },
      calls: [],
      createIndex: async () => "",
      dropIndex: async () => undefined,
      listIndexes: () => ({
        toArray: async () => [{ name: "legacy", key: { legacy: 1 } }],
      }),
      insertOne: async () => undefined,
      updateOne: async () => ({ matchedCount: 1 }),
      deleteOne: async () => ({ deletedCount: 1 }),
    });

    const result = await runMigrations(contracts, { connection });

    expect(result.advisories).toContain(
      'index "legacy" of "drivers" is not owned by the contract',
    );
  });

  it("skips an applied version the contracts do not name anymore", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);
    const model = {
      find: () => ({
        sort: () => ({
          lean: () => ({
            exec: async () => [
              { version: "000", checksum: "abc", appliedAt: new Date(), schema: {} },
            ],
          }),
        }),
      }),
      create: async () => undefined,
    };
    connection.setModel("__migrations", model);

    const result = await runMigrations(contracts, { connection });

    expect(result.applied).toEqual(["001"]);
    expect(result.skipped).toEqual(["000"]);
  });

  it("runs without the lock when the caller asks for it", async () => {
    const db = createFakeDb();
    const connection = createFakeConnection(db);
    const model = {
      find: () => ({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      create: async () => undefined,
    };
    connection.setModel("__migrations", model);

    const result = await runMigrations(contracts, { connection, lock: false });

    expect(result.applied).toEqual(["001"]);
  });

  it("refuses to work when the database holds an index the contract declares differently", async () => {
    const db = createFakeDb();
    db.collections.set("drivers", {
      name: "drivers",
      indexes: { firstName_1: { key: { lastName: 1 } } },
      calls: [],
      createIndex: async () => "",
      dropIndex: async () => undefined,
      listIndexes: () => ({
        toArray: async () => [{ name: "firstName_1", key: { lastName: 1 } }],
      }),
      insertOne: async () => undefined,
      updateOne: async () => ({ matchedCount: 1 }),
      deleteOne: async () => ({ deletedCount: 1 }),
    });
    const connection = createFakeConnection(db);
    const model = {
      find: () => ({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      create: async () => undefined,
    };
    connection.setModel("__migrations", model);

    await expect(runMigrations(contracts, { connection })).rejects.toThrow(MigrationError);
  });
});
