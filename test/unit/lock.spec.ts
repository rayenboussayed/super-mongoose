import { describe, expect, it } from "vitest";
import { MigrationLock } from "../../src/internal/migration/lock";
import { MigrationError } from "../../src/errors";
import { asMongoDb, createFakeDb, mongoError } from "../helpers/fake-db";

describe("the lock of the migrations", () => {
  it("takes the lock when it is free", async () => {
    const db = createFakeDb();
    const lock = new MigrationLock(asMongoDb(db));

    await lock.acquire();

    expect(db.collections.get("__migrations_lock")?.calls).toEqual(["insertOne"]);
  });

  it("refuses the lock when another runner holds it", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    collection.failure = mongoError("duplicate", 11000);
    collection.updateOne = async () => ({ matchedCount: 0 });

    const lock = new MigrationLock(asMongoDb(db));

    await expect(lock.acquire()).rejects.toThrow(MigrationError);
  });

  it("takes over a lock that expired", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    collection.failure = mongoError("duplicate", 11000);
    collection.updateOne = async () => ({ matchedCount: 1 });

    const lock = new MigrationLock(asMongoDb(db));

    await expect(lock.acquire()).resolves.toBeUndefined();
  });

  it("refuses the lock when another runner holds it and it did not expire", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    collection.failure = mongoError("duplicate", 11000);
    collection.updateOne = async () => ({ matchedCount: 0 });

    const lock = new MigrationLock(asMongoDb(db));

    await expect(lock.acquire()).rejects.toThrow(/another migration runner holds the lock/);
  });

  it("reports a failure of the insert", async () => {
    const db = createFakeDb();
    db.collection("__migrations_lock").failure = mongoError("not authorized", 13);

    const lock = new MigrationLock(asMongoDb(db));

    await expect(lock.acquire()).rejects.toThrow(/not authorized/);
  });

  it("does nothing when the lock was not taken", async () => {
    const db = createFakeDb();
    const lock = new MigrationLock(asMongoDb(db));

    await expect(lock.renew()).resolves.toBeUndefined();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it("extends the lock it holds", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    collection.updateOne = async () => ({ matchedCount: 1 });

    const lock = new MigrationLock(asMongoDb(db));
    await lock.acquire();

    await expect(lock.renew()).resolves.toBeUndefined();
  });

  it("reports that the lock was taken over", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    collection.updateOne = async () => ({ matchedCount: 0 });

    const lock = new MigrationLock(asMongoDb(db));
    await lock.acquire();

    await expect(lock.renew()).rejects.toThrow(/taken over by another runner/);
  });

  it("releases the lock it holds", async () => {
    const db = createFakeDb();
    const collection = db.collection("__migrations_lock");
    let deleted = 0;
    collection.deleteOne = async () => {
      deleted += 1;

      return { deletedCount: 1 };
    };

    const lock = new MigrationLock(asMongoDb(db));
    await lock.acquire();
    await lock.release();

    expect(deleted).toBe(1);
  });
});
