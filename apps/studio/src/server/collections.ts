import { mongo } from "mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import {
  assertCollectionName,
  assertCollectionWrite,
  assertNotReserved,
  RESERVED_COLLECTIONS,
} from "./guards";
import { stringifyEjson } from "./ejson";

/** One collection as the collection list shows it. */
export interface CollectionSummary {
  /** Name of the collection. */
  name: string;
  /** Whether the entry is a collection or a view. */
  type: "collection" | "view";
  /** Number of stored documents. */
  documents: number;
  /** Number of indexes. */
  indexes: number;
  /** Storage size in bytes. */
  sizeBytes: number;
  /** Whether the studio refuses writes to the collection. */
  readOnly: boolean;
  /** Whether the migration layer owns the collection. */
  reserved: boolean;
}

/** One collection with its options and indexes. */
export interface CollectionDetail extends CollectionSummary {
  /** The validator of the collection, as EJSON text. */
  validator: string;
  /** The options of the collection. */
  options: string;
  /** The indexes of the collection. */
  indexesDetail: IndexSummary[];
}

/** One index as the studio shows it. */
export interface IndexSummary {
  /** Name of the index. */
  name: string;
  /** Keys of the index in their declared order. */
  keys: [string, number | string][];
  /** Keys as EJSON text. */
  keyText: string;
  /** Whether the index is unique. */
  unique: boolean;
  /** Whether the index is sparse. */
  sparse: boolean;
  /** TTL of the index in seconds. */
  expireAfterSeconds?: number;
  /** Whether the index is hidden from the planner. */
  hidden: boolean;
  /** Size of the index in bytes. */
  sizeBytes: number;
  /** Partial filter expression as EJSON text. */
  partialFilterExpression?: string;
}

interface CollectionInfo {
  name: string;
  type?: string;
  options?: Record<string, unknown>;
  info?: { readOnly?: boolean };
}

interface CollStats {
  size?: number;
  storageSize?: number;
  indexSizes?: Record<string, number>;
}

const MAX_LISTED = 200;

/**
 * Reads the collections of a database, with their document counts and sizes.
 *
 * @param db - The database.
 * @param config - The settings of the studio.
 * @returns The collections, sorted by name.
 */
export async function listCollections(
  db: mongo.Db,
  config: StudioConfig,
): Promise<CollectionSummary[]> {
  const infos = (await db.listCollections().toArray()) as CollectionInfo[];
  const visible = infos
    .filter((info) => !info.name.startsWith("system."))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_LISTED);

  return Promise.all(visible.map((info) => summarise(db, info, config)));
}

/**
 * Reads one collection with its options and indexes.
 *
 * @param db - The database.
 * @param name - The collection name.
 * @param config - The settings of the studio.
 * @returns The collection.
 * @throws {StudioError} With code `NOT_FOUND` when the collection does not exist.
 */
export async function getCollection(
  db: mongo.Db,
  name: string,
  config: StudioConfig,
): Promise<CollectionDetail> {
  assertCollectionName(name);

  const info = (await db
    .listCollections({ name }, { nameOnly: false })
    .toArray()) as CollectionInfo[];
  const found = info[0];

  if (!found) {
    throw new StudioError("NOT_FOUND", `the collection "${name}" does not exist`);
  }

  const summary = await summarise(db, found, config);
  const indexes = summary.type === "view" ? [] : await listIndexes(db, name);

  return {
    ...summary,
    validator: stringifyEjson(found.options?.validator ?? {}),
    options: stringifyEjson({
      capped: found.options?.capped,
      size: found.options?.size,
      max: found.options?.max,
      collation: found.options?.collation,
      timeseries: found.options?.timeseries,
      changeStreamPreAndPostImages: found.options?.changeStreamPreAndPostImages,
    }),
    indexesDetail: indexes,
  };
}

/**
 * Creates a collection.
 *
 * @param db - The database.
 * @param name - The collection name.
 * @param validator - The validator to attach, or undefined for none.
 * @param config - The settings of the studio.
 * @returns The created collection.
 * @throws {StudioError} When the write is refused or the collection already exists.
 */
export async function createCollection(
  db: mongo.Db,
  name: string,
  validator: Record<string, unknown> | undefined,
  config: StudioConfig,
): Promise<CollectionSummary> {
  assertCollectionWrite(name, config);

  if (await collectionExists(db, name)) {
    throw new StudioError("CONFLICT", `the collection "${name}" already exists`);
  }

  try {
    await db.createCollection(name, validator ? { validator } : {});
  } catch (error) {
    throw wrapMongoError(error, `the collection "${name}" could not be created`);
  }

  return getCollection(db, name, config);
}

/**
 * Tells whether a collection exists.
 *
 * @param db - The database.
 * @param name - The collection name.
 * @returns True when the collection exists.
 */
export async function collectionExists(db: mongo.Db, name: string): Promise<boolean> {
  const found = await db.listCollections({ name }, { nameOnly: true }).toArray();

  return found.length > 0;
}

/**
 * Reads the indexes of a collection.
 *
 * @param db - The database.
 * @param name - The collection name.
 * @returns The indexes.
 */
export async function listIndexes(db: mongo.Db, name: string): Promise<IndexSummary[]> {
  assertCollectionName(name);

  const [raw, stats] = await Promise.all([
    db.collection(name).indexes(),
    readCollStats(db, name),
  ]);

  return raw.map((index) => {
    const keys = Object.entries(index.key as Record<string, number | string>).map(
      ([key, direction]) => [key, direction] as [string, number | string],
    );
    const options = index as Record<string, unknown>;

    return {
      name: index.name ?? "",
      keys,
      keyText: keys.map(([key, direction]) => `${key}: ${direction}`).join(", "),
      unique: options.unique === true,
      sparse: options.sparse === true,
      ...(typeof options.expireAfterSeconds === "number"
        ? { expireAfterSeconds: options.expireAfterSeconds }
        : {}),
      hidden: options.hidden === true,
      sizeBytes: stats.indexSizes?.[index.name ?? ""] ?? 0,
      ...(options.partialFilterExpression
        ? { partialFilterExpression: stringifyEjson(options.partialFilterExpression) }
        : {}),
    };
  });
}

/**
 * Returns the size of a collection.
 *
 * @param db - The database.
 * @param name - The collection name.
 * @returns The storage size in bytes.
 */
export async function collectionSize(db: mongo.Db, name: string): Promise<number> {
  const stats = await readCollStats(db, name);

  return stats.storageSize ?? stats.size ?? 0;
}

async function summarise(
  db: mongo.Db,
  info: CollectionInfo,
  config: StudioConfig,
): Promise<CollectionSummary> {
  const type = info.type === "view" ? "view" : "collection";
  const reserved = (RESERVED_COLLECTIONS as readonly string[]).includes(info.name);

  if (type === "view") {
    return {
      name: info.name,
      type,
      documents: 0,
      indexes: 0,
      sizeBytes: 0,
      readOnly: true,
      reserved,
    };
  }

  const [documents, indexes, stats] = await Promise.all([
    db.collection(info.name).estimatedDocumentCount().catch(() => 0),
    db.collection(info.name).indexes().then((rows) => rows.length).catch(() => 0),
    readCollStats(db, info.name),
  ]);

  return {
    name: info.name,
    type,
    documents,
    indexes,
    sizeBytes: stats.storageSize ?? stats.size ?? 0,
    readOnly: config.readOnly || reserved,
    reserved,
  };
}

async function readCollStats(db: mongo.Db, name: string): Promise<CollStats> {
  try {
    return (await db.command({ collStats: name })) as CollStats;
  } catch {
    return {};
  }
}

function wrapMongoError(error: unknown, message: string): StudioError {
  if (error instanceof StudioError) {
    return error;
  }

  if (error instanceof Error && /already exists|NamespaceExists/i.test(error.message)) {
    return new StudioError("CONFLICT", message, { cause: error.message });
  }

  return new StudioError("QUERY_FAILED", `${message}: ${String(error)}`);
}

export { assertNotReserved };
