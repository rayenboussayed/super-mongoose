import { describe, expect, it } from "vitest";
import { MigrationLedger } from "../../src/internal/migration/ledger";
import { MigrationError } from "../../src/errors";
import { asMongoDb, createFakeDb, mongoError } from "../helpers/fake-db";

describe("the ledger of the migrations", () => {
  it("creates the unique index on the version", async () => {
    const db = createFakeDb();
    const ledger = new MigrationLedger({} as never, asMongoDb(db));

    await ledger.ensureIndexes();

    expect(db.collections.get("__migrations")?.calls).toEqual(["createIndex version_1"]);
  });

  it("reports a version that was already applied", async () => {
    const db = createFakeDb();
    const model = {
      create: async () => {
        throw mongoError("duplicate", 11000);
      },
    };
    const ledger = new MigrationLedger(model as never, asMongoDb(db));

    await expect(
      ledger.record({
        version: "001",
        checksum: "abc",
        appliedAt: new Date(),
        schema: {},
      }),
    ).rejects.toThrow(MigrationError);
  });

  it("reports another failure of the write", async () => {
    const db = createFakeDb();
    const model = {
      create: async () => {
        throw mongoError("not authorized", 13);
      },
    };
    const ledger = new MigrationLedger(model as never, asMongoDb(db));

    await expect(
      ledger.record({
        version: "001",
        checksum: "abc",
        appliedAt: new Date(),
        schema: {},
      }),
    ).rejects.toThrow(/not authorized/);
  });

  it("reads the applied migrations oldest first", async () => {
    const rows = [{ version: "001" }];
    const model = {
      find: () => ({
        sort: () => ({
          lean: () => ({ exec: async () => rows }),
        }),
      }),
    };
    const ledger = new MigrationLedger(model as never, asMongoDb(createFakeDb()));

    await expect(ledger.list()).resolves.toBe(rows);
  });
});
