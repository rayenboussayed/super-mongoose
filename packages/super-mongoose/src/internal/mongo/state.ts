import { mongo } from "mongoose";
import { canonicalJson } from "../definition";
import type { IndexDefinition } from "../definition";
import type { IndexDirectionValue } from "../../schemas/contract";
import type { MongoDocument } from "./validator";

/** Options the driver needs to create an index. */
export type IndexOptions = Omit<IndexDefinition, "key" | "status">;

/** An index that exists in the database. */
export interface LiveIndex extends IndexOptions {
  /** Indexed fields and their direction, the order of a compound key matters. */
  key: Record<string, IndexDirectionValue>;
  /** The fields of a text index with the weight of each one. */
  weights?: Record<string, number>;
  /** Whether the index is hidden from the query planner. */
  hidden?: boolean;
}

/** What the database currently holds for a collection. */
export interface CollectionState {
  /** Whether the collection exists. */
  exists: boolean;
  /** The validator the collection was created with. */
  validator?: MongoDocument;
  /** The level and the action the server applies the validator with. */
  validation?: { level?: string; action?: string };
  /** The indexes the collection currently has. */
  indexes: LiveIndex[];
}

/** Index types the server always builds sparse, whatever the contract says. */
const IMPLICITLY_SPARSE_TYPES: ReadonlySet<string> = new Set(["text", "2d", "2dsphere"]);

/**
 * Turns the options of an index into the options the driver and Mongoose
 * both use, without the ones nobody declared.
 *
 * @param record - The index, declared by the contract or read from the server.
 * @returns The options of the index, without the key.
 */
export function toIndexOptions(record: IndexOptions): IndexOptions {
  return {
    name: record.name,
    ...(record.unique === undefined ? {} : { unique: record.unique }),
    ...(record.sparse === undefined ? {} : { sparse: record.sparse }),
    ...(record.expireAfterSeconds === undefined
      ? {}
      : { expireAfterSeconds: record.expireAfterSeconds }),
    ...(record.partialFilterExpression === undefined
      ? {}
      : { partialFilterExpression: record.partialFilterExpression }),
  };
}

/**
 * Tells whether a live index and a declared index carry the same options.
 * The server keeps the options of an index when it is created again, so a
 * difference needs the index to be dropped and created again.
 *
 * @param live - The index that exists in the database.
 * @param declared - The declared index.
 * @returns True when both indexes carry the same options.
 */
export function isSameIndexOptions(live: LiveIndex, declared: IndexDefinition): boolean {
  const liveSparse = isImplicitlySparse(live.key) ? false : Boolean(live.sparse);
  const declaredSparse = isImplicitlySparse(declared.key) ? false : Boolean(declared.sparse);

  return (
    Boolean(live.unique) === Boolean(declared.unique) &&
    liveSparse === declaredSparse &&
    live.expireAfterSeconds === declared.expireAfterSeconds &&
    canonicalJson(live.partialFilterExpression) === canonicalJson(declared.partialFilterExpression)
  );
}

function isImplicitlySparse(key: Record<string, IndexDirectionValue>): boolean {
  return Object.values(key).some((direction) =>
    IMPLICITLY_SPARSE_TYPES.has(String(direction)),
  );
}

/**
 * Reads the current state of a collection: whether it exists, which
 * validator it carries and which indexes it has.
 *
 * @param db - The database to read from.
 * @param collection - The collection name.
 * @returns The live state of the collection.
 */
export async function readCollectionState(
  db: mongo.Db,
  collection: string,
): Promise<CollectionState> {
  const [info] = (await db
    .listCollections({ name: collection, type: "collection" })
    .toArray()) as mongo.CollectionInfo[];

  if (!info) {
    return { exists: false, indexes: [] };
  }

  const validator = info.options?.validator as MongoDocument | undefined;

  return {
    exists: true,
    validator,
    validation: {
      level: info.options?.validationLevel,
      action: info.options?.validationAction,
    },
    indexes: await readIndexes(db, collection),
  };
}

async function readIndexes(db: mongo.Db, collection: string): Promise<LiveIndex[]> {
  try {
    const documents = await db.collection(collection).listIndexes().toArray();

    return documents.map((document) => ({
      ...toIndexOptions({
        name: document.name,
        unique: document.unique,
        sparse: document.sparse,
        expireAfterSeconds: document.expireAfterSeconds ?? undefined,
        partialFilterExpression: document.partialFilterExpression as
          | Record<string, unknown>
          | undefined,
      }),
      key: document.key as LiveIndex["key"],
      weights: document.weights as Record<string, number> | undefined,
      hidden: document.hidden,
    }));
  } catch (error) {
    if (isNamespaceNotFound(error)) {
      return [];
    }

    throw error;
  }
}

/**
 * Tells whether an error means the collection does not exist.
 *
 * @param error - The error raised by the driver.
 * @returns True when the namespace was not found.
 */
export function isNamespaceNotFound(error: unknown): boolean {
  return mongoErrorCode(error) === 26;
}

/**
 * Tells whether an error means the collection already exists.
 *
 * @param error - The error raised by the driver.
 * @returns True when the namespace was already taken.
 */
export function isNamespaceExists(error: unknown): boolean {
  return mongoErrorCode(error) === 48;
}

/**
 * Tells whether an error means the index does not exist.
 *
 * @param error - The error raised by the driver.
 * @returns True when the index was not found.
 */
export function isIndexNotFound(error: unknown): boolean {
  const code = mongoErrorCode(error);

  return code === 27 || code === 26;
}

/**
 * Tells whether an error means the user has no privilege for the operation.
 *
 * @param error - The error raised by the driver.
 * @returns True when the user is not authorized.
 */
export function isUnauthorized(error: unknown): boolean {
  return mongoErrorCode(error) === 13;
}

/**
 * Tells whether an error means a document with the same key already exists.
 *
 * @param error - The error raised by the driver.
 * @returns True when the write hit a duplicate key.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return mongoErrorCode(error) === 11000;
}

/**
 * Reads the MongoDB error code of an error, whatever its concrete type.
 *
 * @param error - The error raised by the driver.
 * @returns The numeric error code, or undefined when there is none.
 */
export function mongoErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code?: unknown };

    return typeof code === "number" ? code : undefined;
  }

  return undefined;
}
