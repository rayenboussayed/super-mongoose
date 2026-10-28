import { mongo } from "mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import { collectionExists, listIndexes } from "./collections";
import type { IndexSummary } from "./collections";
import { parseObjectText } from "./ejson";
import {
  assertCollectionWrite,
  assertIndexKeys,
  assertIndexName,
  assertSafeQueryValue,
} from "./guards";

/** The description of an index the user wants to create. */
export interface CreateIndexInput {
  /** The collection that holds the index. */
  collection: string;
  /** The keys as EJSON, for example `{"status": 1}`. */
  keys: string;
  /** Optional name, the server derives one from the keys when omitted. */
  name?: string;
  /** Whether the index is unique. */
  unique?: boolean;
  /** Whether the index is sparse. */
  sparse?: boolean;
  /** TTL of the index in seconds. */
  expireAfterSeconds?: number;
  /** Partial filter expression as EJSON. */
  partialFilterExpression?: string;
  /** Whether the index is hidden from the planner. */
  hidden?: boolean;
}

/**
 * Creates an index.
 *
 * @param db - The database.
 * @param input - The index description.
 * @param config - The settings of the studio.
 * @returns The indexes of the collection after the write.
 */
export async function createIndex(
  db: mongo.Db,
  input: CreateIndexInput,
  config: StudioConfig,
): Promise<IndexSummary[]> {
  assertCollectionWrite(input.collection, config);

  if (!(await collectionExists(db, input.collection))) {
    throw new StudioError("NOT_FOUND", `the collection "${input.collection}" does not exist`);
  }

  const keys = assertIndexKeys(parseObjectText(input.keys, "the index keys"));
  const name = input.name?.trim();

  if (name) {
    assertIndexName(name);
  }

  if (input.expireAfterSeconds !== undefined) {
    if (
      !Number.isInteger(input.expireAfterSeconds) ||
      input.expireAfterSeconds < 0 ||
      keys.length !== 1
    ) {
      throw new StudioError(
        "INVALID_INPUT",
        "a TTL needs a whole number of seconds and a single key index",
      );
    }
  }

  if (input.unique && input.sparse === false) {
    throw new StudioError("INVALID_INPUT", "a unique index cannot declare sparse: false");
  }

  const options: Record<string, unknown> = {};

  if (name) {
    options.name = name;
  }

  if (input.unique !== undefined) {
    options.unique = input.unique;
  }

  if (input.sparse !== undefined) {
    options.sparse = input.sparse;
  }

  if (input.hidden !== undefined) {
    options.hidden = input.hidden;
  }

  if (input.expireAfterSeconds !== undefined) {
    options.expireAfterSeconds = input.expireAfterSeconds;
  }

  if (input.partialFilterExpression?.trim()) {
    const partial = parseObjectText(input.partialFilterExpression, "the partial filter");

    assertSafeQueryValue(partial, "the partial filter");
    options.partialFilterExpression = partial;
  }

  if (options.unique && options.partialFilterExpression && options.sparse) {
    throw new StudioError("INVALID_INPUT", "a partial index cannot be sparse at the same time");
  }

  try {
    await db
      .collection(input.collection)
      .createIndex(Object.fromEntries(keys) as mongo.IndexSpecification, options as never);
  } catch (error) {
    throw indexError(error);
  }

  return listIndexes(db, input.collection);
}

/**
 * Drops an index.
 *
 * @param db - The database.
 * @param collectionName - The collection that holds the index.
 * @param name - The index name.
 * @param config - The settings of the studio.
 * @returns The indexes of the collection after the write.
 */
export async function dropIndex(
  db: mongo.Db,
  collectionName: string,
  name: string,
  config: StudioConfig,
): Promise<IndexSummary[]> {
  assertCollectionWrite(collectionName, config);

  if (name === "_id_" || name === "*") {
    throw new StudioError("FORBIDDEN", `the index "${name}" cannot be dropped`);
  }

  assertIndexName(name);

  try {
    await db.collection(collectionName).dropIndex(name);
  } catch (error) {
    throw indexError(error);
  }

  return listIndexes(db, collectionName);
}

function indexError(error: unknown): StudioError {
  if (error instanceof StudioError) {
    return error;
  }

  if (error instanceof Error) {
    if (/IndexOptionsConflict|IndexKeySpecsConflict/i.test(error.message)) {
      return new StudioError("CONFLICT", "an index with these keys already exists", {
        cause: error.message,
      });
    }

    if (/IndexNotFound/i.test(error.message)) {
      return new StudioError("NOT_FOUND", "the index does not exist", { cause: error.message });
    }

    return new StudioError("QUERY_FAILED", `the index could not be written: ${error.message}`);
  }

  return new StudioError("QUERY_FAILED", `the index could not be written: ${String(error)}`);
}
