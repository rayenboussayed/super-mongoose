import type { mongo } from "mongoose";

/** A collection that records the calls the runner makes on it. */
export interface FakeCollection {
  /** The name of the collection. */
  name: string;
  /** The indexes the collection holds. */
  indexes: Record<string, { key: Record<string, unknown> }>;
  /** The validator the collection carries. */
  validator?: unknown;
  /** The error the collection raises on the next call, when it is set. */
  failure?: Error & { code?: number };
  /** The calls the runner made on the collection. */
  calls: string[];
  /** Creates an index, the way the driver does. */
  createIndex(key: Record<string, unknown>, options: { name: string }): Promise<string>;
  /** Drops an index, the way the driver does. */
  dropIndex(name: string): Promise<void>;
  /** Lists the indexes of the collection, the way the driver does. */
  listIndexes(): { toArray(): Promise<Record<string, unknown>[]> };
  /** Inserts a document, the way the driver does. */
  insertOne(document: Record<string, unknown>): Promise<unknown>;
  /** Updates a document, the way the driver does. */
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount: number }>;
  /** Deletes a document, the way the driver does. */
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
}

/**
 * A database that records the calls the runner makes on it.
 */
export interface FakeDb {
  /** The collections of the database, keyed by name. */
  collections: Map<string, FakeCollection>;
  /** The calls the runner made on the database. */
  calls: string[];
  /** The error the database raises on the next call, when it is set. */
  failure?: Error & { code?: number };
  /** Creates a collection, the way the driver does. */
  createCollection(name: string, options?: Record<string, unknown>): Promise<unknown>;
  /** Runs a command against the database, the way the driver does. */
  command(command: Record<string, unknown>): Promise<unknown>;
  /** Lists the collections of the database, the way the driver does. */
  listCollections(filter: { name: string }): { toArray(): Promise<Record<string, unknown>[]> };
  /** Returns a collection of the database. */
  collection(name: string): FakeCollection;
}

/**
 * Builds a database that answers like the driver does, without a server.
 *
 * @returns The fake database.
 */
export function createFakeDb(): FakeDb {
  const collections = new Map<string, FakeCollection>();
  const calls: string[] = [];

  const db: FakeDb = {
    collections,
    calls,
    async createCollection(name: string) {
      calls.push(`createCollection ${name}`);

      if (db.failure) {
        const failure = db.failure;
        db.failure = undefined;

        throw failure;
      }

      if (!collections.has(name)) {
        collections.set(name, createFakeCollection(name));
      }

      return collections.get(name);
    },
    async command(command: Record<string, unknown>) {
      calls.push(`command ${String(command.collMod)}`);

      if (db.failure) {
        const failure = db.failure;
        db.failure = undefined;

        throw failure;
      }

      return { ok: 1 };
    },
    listCollections(filter: { name: string }) {
      calls.push(`listCollections ${filter.name}`);

      const info = collections.has(filter.name)
        ? [{ name: filter.name, options: { validator: collections.get(filter.name)?.validator } }]
        : [];

      return { toArray: async () => info };
    },
    collection(name: string) {
      if (!collections.has(name)) {
        collections.set(name, createFakeCollection(name));
      }

      return collections.get(name) as FakeCollection;
    },
  };

  return db;
}

function createFakeCollection(name: string): FakeCollection {
  const documents: Record<string, unknown>[] = [];

  const collection: FakeCollection = {
    name,
    indexes: {},
    calls: [],
    async createIndex(key, options) {
      collection.calls.push(`createIndex ${options.name}`);

      if (collection.failure) {
        const failure = collection.failure;
        collection.failure = undefined;

        throw failure;
      }

      collection.indexes[options.name] = { key };

      return options.name;
    },
    async dropIndex(indexName) {
      collection.calls.push(`dropIndex ${indexName}`);

      if (collection.failure) {
        const failure = collection.failure;
        collection.failure = undefined;

        throw failure;
      }

      delete collection.indexes[indexName];
    },
    listIndexes() {
      return {
        toArray: async () => {
          if (collection.failure) {
            const failure = collection.failure;
            collection.failure = undefined;

            throw failure;
          }

          return Object.entries(collection.indexes).map(([indexName, index]) => ({
            name: indexName,
            key: index.key,
          }));
        },
      };
    },
    async insertOne(document) {
      collection.calls.push("insertOne");

      if (collection.failure) {
        const failure = collection.failure;
        collection.failure = undefined;

        throw failure;
      }

      documents.push(document);

      return { insertedId: documents.length };
    },
    async updateOne() {
      collection.calls.push("updateOne");

      if (collection.failure) {
        const failure = collection.failure;
        collection.failure = undefined;

        throw failure;
      }

      return { matchedCount: 1 };
    },
    async deleteOne() {
      collection.calls.push("deleteOne");

      if (collection.failure) {
        const failure = collection.failure;
        collection.failure = undefined;

        throw failure;
      }

      return { deletedCount: 1 };
    },
  };

  return collection;
}

/**
 * Builds an error that looks like the one the driver raises.
 *
 * @param message - The message of the error.
 * @param code - The code of the error.
 * @returns The error.
 */
export function mongoError(message: string, code: number): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/**
 * A connection that answers like Mongoose does, without a server.
 *
 * @param db - The database of the connection.
 * @param readyState - The state of the connection, 1 means open.
 * @returns The connection.
 */
export function createFakeConnection(db: FakeDb, readyState = 1) {
  const models: Record<string, unknown> = {};

  const connection = {
    db,
    models,
    readyState,
    model(name: string) {
      models[name] = models[name] ?? {
        name,
        find: () => ({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
      };

      return models[name];
    },
    setModel(name: string, model: unknown) {
      models[name] = model;
    },
  };

  return connection as unknown as import("mongoose").Connection & {
    setModel(name: string, model: unknown): void;
  };
}

/**
 * The type of the fake database, as the driver sees it.
 *
 * @param db - The fake database.
 * @returns The database, typed as the driver types it.
 */
export function asMongoDb(db: FakeDb): mongo.Db {
  return db as unknown as mongo.Db;
}
