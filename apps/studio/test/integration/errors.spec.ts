import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConnection } from "mongoose";
import { randomUUID } from "node:crypto";
import { configFromEnv } from "../../src/server/config";
import { createCollection } from "../../src/server/collections";
import { createDocument, deleteDocument, replaceDocument, listDocuments } from "../../src/server/documents";
import { createIndex, dropIndex } from "../../src/server/indexes";
import { explainQuery } from "../../src/server/plans";
import { assertCollectionName, assertWritable } from "../../src/server/guards";

const URI = "mongodb://127.0.0.1:27018";
const DB = `super_mongoose_studio_err_${randomUUID().slice(0, 8)}`;

let connection: ReturnType<typeof createConnection>;
let db: any;
let config: any;

beforeAll(async () => {
  connection = createConnection(URI, { dbName: DB });
  await connection.asPromise();
  db = connection.db;
  config = configFromEnv({ MONGO_URL: URI, MONGO_DB: DB } as never);
});

afterAll(async () => {
  await db.dropDatabase();
  await connection.close();
});

describe("studio error paths", () => {
  it("refuses reserved collection writes", async () => {
    await expect(createCollection(db, "__migrations", undefined, config)).rejects.toThrow();
  });

  it("rejects a duplicate collection", async () => {
    await createCollection(db, "items", undefined, config);
    await expect(createCollection(db, "items", undefined, config)).rejects.toThrow();
  });

  it("rejects bad filter", async () => {
    await expect(listDocuments(db, { collection: "items", filter: '{ "$where": "1" }' }, config)).rejects.toThrow();
  });

  it("deletes and reports missing", async () => {
    const view = await createDocument(db, "items", '{ "name": "x" }', config);
    await deleteDocument(db, "items", view.id, config);
    await expect(deleteDocument(db, "items", view.id, config)).rejects.toThrow();
  });

  it("replaces missing document", async () => {
    await expect(replaceDocument(db, "items", '"missing"', '{ "name": "y" }', config)).rejects.toThrow();
  });

  it("drops missing index", async () => {
    await expect(dropIndex(db, "items", "nope_idx", config)).rejects.toThrow();
  });

  it("creates duplicate index", async () => {
    await createIndex(db, { collection: "items", keys: '{ "name": 1 }', name: "dup_idx", unique: false }, config);
    await expect(
      createIndex(db, { collection: "items", keys: '{ "name": 1 }', name: "dup_idx2", unique: false }, config),
    ).rejects.toThrow();
  });

  it("explains missing collection", async () => {
    await expect(explainQuery(db, { collection: "nope", filter: "{}" }, config)).rejects.toThrow();
  });
});
