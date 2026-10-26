import { describe, expect, it } from "vitest";
import { applyOperations } from "../../src/migrator/apply";
import { MigrationError } from "../../src/errors";
import { asMongoDb, createFakeDb, mongoError } from "../helpers/fake-db";

describe("the applier", () => {
  it("creates a collection with the validator", async () => {
    const db = createFakeDb();

    const results = await applyOperations(
      asMongoDb(db),
      [{ type: "createCollection", collection: "drivers", validator: { $jsonSchema: {} } }],
    );

    expect(db.calls).toEqual(["createCollection drivers"]);
    expect(results[0]).toMatchObject({ type: "createCollection", outcome: "applied" });
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sets the validator when the collection appeared in the meantime", async () => {
    const db = createFakeDb();
    db.failure = mongoError("already exists", 48);

    const results = await applyOperations(
      asMongoDb(db),
      [{ type: "createCollection", collection: "drivers", validator: { $jsonSchema: {} } }],
    );

    expect(db.calls).toEqual(["createCollection drivers", "command drivers"]);
    expect(results[0]).toMatchObject({ type: "createCollection", outcome: "applied" });
    expect(results[0].reason).toMatch(/the collection already existed/);
  });

  it("skips the validator when the database user has no privilege", async () => {
    const db = createFakeDb();
    db.failure = mongoError("not authorized", 13);

    const results = await applyOperations(
      asMongoDb(db),
      [{ type: "setValidator", collection: "drivers", validator: { $jsonSchema: {} } }],
    );

    expect(results[0].outcome).toBe("skipped");
    expect(results[0].reason).toMatch(/collMod/);
  });

  it("reports a failure of the validator", async () => {
    const db = createFakeDb();
    db.failure = mongoError("not authorized", 18);

    await expect(
      applyOperations(asMongoDb(db), [
        { type: "setValidator", collection: "drivers", validator: { $jsonSchema: {} } },
      ]),
    ).rejects.toThrow(MigrationError);
  });

  it("creates an index", async () => {
    const db = createFakeDb();

    const results = await applyOperations(asMongoDb(db), [
      {
        type: "createIndex",
        collection: "drivers",
        name: "firstName_1",
        key: { firstName: 1 },
        options: { name: "firstName_1" },
      },
    ]);

    expect(db.collections.get("drivers")?.calls).toEqual(["createIndex firstName_1"]);
    expect(results[0]).toMatchObject({ name: "firstName_1", outcome: "applied" });
  });

  it("reports a failure of an index", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("conflict", 86);

    await expect(
      applyOperations(asMongoDb(db), [
        {
          type: "createIndex",
          collection: "drivers",
          name: "firstName_1",
          key: { firstName: 1 },
          options: { name: "firstName_1" },
        },
      ]),
    ).rejects.toThrow(/could not createIndex/);
  });

  it("skips an index that already exists under another name", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("conflict", 85);

    const results = await applyOperations(asMongoDb(db), [
      {
        type: "createIndex",
        collection: "drivers",
        name: "firstName_1",
        key: { firstName: 1 },
        options: { name: "firstName_1" },
      },
    ]);

    expect(results[0].outcome).toBe("skipped");
    expect(results[0].reason).toMatch(/under another name/);
  });

  it("drops an index", async () => {
    const db = createFakeDb();
    db.collection("drivers").indexes.firstName_1 = { key: { firstName: 1 } };

    const results = await applyOperations(asMongoDb(db), [
      { type: "dropIndex", collection: "drivers", name: "firstName_1" },
    ]);

    expect(results[0]).toMatchObject({ name: "firstName_1", outcome: "applied" });
    expect(db.collections.get("drivers")?.indexes).toEqual({});
  });

  it("skips an index that is not there", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("index not found", 27);

    const results = await applyOperations(asMongoDb(db), [
      { type: "dropIndex", collection: "drivers", name: "firstName_1" },
    ]);

    expect(results[0].outcome).toBe("skipped");
    expect(results[0].reason).toMatch(/does not exist/);
  });

  it("reports a failure of a dropped index", async () => {
    const db = createFakeDb();
    db.collection("drivers").failure = mongoError("not authorized", 13);

    await expect(
      applyOperations(asMongoDb(db), [
        { type: "dropIndex", collection: "drivers", name: "firstName_1" },
      ]),
    ).rejects.toThrow(/could not dropIndex/);
  });

  it("reports a failure of the creation of a collection", async () => {
    const db = createFakeDb();
    db.failure = mongoError("not authorized", 13);

    await expect(
      applyOperations(asMongoDb(db), [
        { type: "createCollection", collection: "drivers", validator: { $jsonSchema: {} } },
      ]),
    ).rejects.toThrow(/could not createCollection/);
  });

  it("writes what it does", async () => {
    const db = createFakeDb();
    const messages: string[] = [];

    await applyOperations(
      asMongoDb(db),
      [{ type: "dropIndex", collection: "drivers", name: "firstName_1" }],
      { log: (message) => messages.push(message) },
    );

    expect(messages[0]).toMatch(/\[applied\] dropIndex drivers firstName_1/);
  });

  it("writes what it does for an operation without a name", async () => {
    const db = createFakeDb();
    const messages: string[] = [];

    await applyOperations(
      asMongoDb(db),
      [{ type: "createCollection", collection: "drivers", validator: { $jsonSchema: {} } }],
      { log: (message) => messages.push(message) },
    );

    expect(messages[0]).toMatch(/\[applied\] createCollection drivers/);
  });

  it("writes why it skipped an operation", async () => {
    const db = createFakeDb();
    const messages: string[] = [];
    db.collection("drivers").failure = mongoError("index not found", 27);

    await applyOperations(
      asMongoDb(db),
      [{ type: "dropIndex", collection: "drivers", name: "firstName_1" }],
      { log: (message) => messages.push(message) },
    );

    expect(messages[0]).toMatch(/\[skipped\] dropIndex drivers firstName_1 \(the index does not exist\)/);
  });
});
