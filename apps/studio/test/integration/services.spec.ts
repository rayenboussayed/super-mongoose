import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "mongoose";
import { randomUUID } from "node:crypto";
import { configFromEnv } from "../../src/server/config";
import type { StudioConfig } from "../../src/server/config";
import { listCollections, createCollection, getCollection } from "../../src/server/collections";
import { listDocuments, createDocument, replaceDocument, deleteDocument } from "../../src/server/documents";
import { createIndex, dropIndex } from "../../src/server/indexes";
import { explainQuery } from "../../src/server/plans";
import { getMigrationOverview, applyMigrations } from "../../src/server/migrations";
import { getOverview, getConnectionManager } from "../../src/server/overview";
import path from "node:path";

const URI = "mongodb://127.0.0.1:27018";
const DB = `super_mongoose_studio_${randomUUID().slice(0, 8)}`;

let connection: ReturnType<typeof createConnection>;
let db: NonNullable<ReturnType<typeof createConnection>["db"]>;
let config: StudioConfig;

beforeAll(async () => {
  connection = createConnection(URI, { dbName: DB });
  await connection.asPromise();
  db = connection.db as (typeof connection)["db"] & {};
  config = configFromEnv({
    MONGO_URL: URI,
    MONGO_DB: DB,
    SUPER_MONGOOSE_CONTRACTS: path.resolve(process.cwd(), "test/helpers/contracts.mjs"),
  } as never);
});

afterAll(async () => {
  await db.dropDatabase();
  await connection.close();
});

describe("studio services", () => {
  it("creates a collection and lists it", async () => {
    await createCollection(db, "items", undefined, config);
    const list = await listCollections(db, config);
    expect(list.some((entry) => entry.name === "items")).toBe(true);
    const detail = await getCollection(db, "items", config);
    expect(detail.name).toBe("items");
  });

  it("creates, reads, updates and deletes a document", async () => {
    const created = await createDocument(db, "items", '{ "name": "one", "count": 1 }', config);
    await createDocument(db, "items", '{ "name": "two", "count": 2 }', config);

    const page = await listDocuments(db, { collection: "items" }, config);
    expect(page.total).toBe(2);

    const updated = await replaceDocument(db, "items", created.id, '{ "name": "ONE", "count": 9 }', config);
    expect(updated.json).toContain('"ONE"');

    await deleteDocument(db, "items", created.id, config);
    const after = await listDocuments(db, { collection: "items" }, config);
    expect(after.total).toBe(1);
  });

  it("creates and drops an index", async () => {
    const indexes = await createIndex(
      db,
      { collection: "items", keys: '{ "name": 1 }', name: "name_1", unique: false },
      config,
    );
    expect(indexes.some((index) => index.name === "name_1")).toBe(true);
    const dropped = await dropIndex(db, "items", "name_1", config);
    expect(dropped.some((index) => index.name === "name_1")).toBe(false);
  });

  it("explains a query", async () => {
    const result = await explainQuery(db, { collection: "items", filter: '{ "name": "two" }', limit: 5 }, config);
    expect(result.summary.stage).toBeTruthy();
  });

  it("applies migrations from contracts", async () => {
    const before = await getMigrationOverview(connection as never, config);
    expect(before.configured).toBe(true);
    const run = await applyMigrations(connection as never, config);
    expect(run.applied.length + run.skipped.length).toBeGreaterThanOrEqual(1);
    const after = await getMigrationOverview(connection as never, config);
    expect((after.pending ?? []).length).toBe(0);

    const overview = await getOverview(connection as never, config);
    expect(overview.collectionsCount).toBeGreaterThanOrEqual(1);

    const manager = getConnectionManager(config);
    const first = await manager.get();
    const second = await manager.get();
    expect(first).toBe(second);
    await manager.close();
    const third = await manager.get();
    expect(third).toBeDefined();
  });
});
