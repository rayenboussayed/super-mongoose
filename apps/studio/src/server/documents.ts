import { mongo } from "mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import { collectionExists } from "./collections";
import { toDocumentView } from "./ejson";
import type { DocumentView } from "./ejson";
export type { DocumentView } from "./ejson";
import { parseEjson, parseId, parseObjectText } from "./ejson";
import {
  assertCollectionName,
  assertCollectionWrite,
  assertDocumentBody,
  assertFilter,
  assertSort,
} from "./guards";

/** The page of documents the browser receives. */
export interface DocumentPage {
  /** The documents of the page. */
  documents: DocumentView[];
  /** Total number of documents that match the filter. */
  total: number;
  /** The page number, 1 based. */
  page: number;
  /** The size of a page. */
  pageSize: number;
  /** Number of pages. */
  pages: number;
  /** Whether another page follows. */
  hasMore: boolean;
}

/** The filter, sort and page of a document list. */
export interface ListDocumentsInput {
  /** The collection to read. */
  collection: string;
  /** EJSON filter, an empty object by default. */
  filter?: string;
  /** EJSON sort, the identifier ascending by default. */
  sort?: string;
  /** Page number, 1 by default. */
  page?: number;
  /** Page size, 25 by default. */
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * Reads one page of documents.
 *
 * @param db - The database.
 * @param input - The collection, filter, sort and page.
 * @param config - The settings of the studio.
 * @returns The page of documents.
 */
export async function listDocuments(
  db: mongo.Db,
  input: ListDocumentsInput,
  config: StudioConfig,
): Promise<DocumentPage> {
  assertCollectionName(input.collection);

  if (!(await collectionExists(db, input.collection))) {
    throw new StudioError("NOT_FOUND", `the collection "${input.collection}" does not exist`);
  }

  const filter = readFilter(input.filter);
  const sort = readSort(input.sort);
  const pageSize = clampPageSize(input.pageSize, config);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const collection = db.collection(input.collection);
  const total = await collection.countDocuments(filter as never, { maxTimeMS: config.maxTimeMs });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (page > pages) {
    return { documents: [], total, page, pageSize, pages, hasMore: false };
  }

  const documents = await collection
    .find(filter as never)
    .sort(sort)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .maxTimeMS(config.maxTimeMs)
    .toArray();

  return {
    documents: documents.map((document) => toDocumentView(document)),
    total,
    page,
    pageSize,
    pages,
    hasMore: page < pages,
  };
}

/**
 * Reads one document.
 *
 * @param db - The database.
 * @param collectionName - The collection.
 * @param id - EJSON text of the identifier.
 * @returns The document.
 * @throws {StudioError} With code `NOT_FOUND` when the document does not exist.
 */
export async function getDocument(
  db: mongo.Db,
  collectionName: string,
  id: string,
): Promise<DocumentView> {
  assertCollectionName(collectionName);

  const document = await db.collection(collectionName).findOne({ _id: parseId(id) } as never);

  if (!document) {
    throw new StudioError("NOT_FOUND", "the document does not exist");
  }

  return toDocumentView(document);
}

/**
 * Inserts a document.
 *
 * @param db - The database.
 * @param collectionName - The collection.
 * @param text - EJSON text of the document.
 * @param config - The settings of the studio.
 * @returns The view of the inserted document.
 */
export async function createDocument(
  db: mongo.Db,
  collectionName: string,
  text: string,
  config: StudioConfig,
): Promise<DocumentView> {
  assertCollectionWrite(collectionName, config);

  if (!(await collectionExists(db, collectionName))) {
    throw new StudioError("NOT_FOUND", `the collection "${collectionName}" does not exist`);
  }

  const document = parseObjectText(text, "the document");

  assertDocumentBody(document);

  try {
    const result = await db.collection(collectionName).insertOne(document);

    return toDocumentView({ ...document, _id: result.insertedId });
  } catch (error) {
    throw writeError(error);
  }
}

/**
 * Replaces a document, keeping its identifier.
 *
 * @param db - The database.
 * @param collectionName - The collection.
 * @param id - EJSON text of the identifier.
 * @param text - EJSON text of the replacement.
 * @param config - The settings of the studio.
 * @returns The view of the replaced document.
 */
export async function replaceDocument(
  db: mongo.Db,
  collectionName: string,
  id: string,
  text: string,
  config: StudioConfig,
): Promise<DocumentView> {
  assertCollectionWrite(collectionName, config);

  const identifier = parseId(id);
  const document = parseObjectText(text, "the document");

  assertDocumentBody(document);

  if (document._id !== undefined && JSON.stringify(document._id) !== JSON.stringify(identifier)) {
    throw new StudioError("INVALID_INPUT", "the identifier of a document cannot change");
  }

  const replacement = { ...document };

  delete replacement._id;

  const result = await db
    .collection(collectionName)
    .replaceOne({ _id: identifier } as never, replacement, { maxTimeMS: config.maxTimeMs });

  if (result.matchedCount === 0) {
    throw new StudioError("NOT_FOUND", "the document does not exist");
  }

  const stored = await db.collection(collectionName).findOne({ _id: identifier } as never);

  if (!stored) {
    throw new StudioError("NOT_FOUND", "the document does not exist");
  }

  return toDocumentView(stored);
}

/**
 * Deletes a document.
 *
 * @param db - The database.
 * @param collectionName - The collection.
 * @param id - EJSON text of the identifier.
 * @param config - The settings of the studio.
 * @returns Nothing.
 */
export async function deleteDocument(
  db: mongo.Db,
  collectionName: string,
  id: string,
  config: StudioConfig,
): Promise<void> {
  assertCollectionWrite(collectionName, config);

  const result = await db
    .collection(collectionName)
    .deleteOne({ _id: parseId(id) } as never, { maxTimeMS: config.maxTimeMs });

  if (result.deletedCount === 0) {
    throw new StudioError("NOT_FOUND", "the document does not exist");
  }
}

function readFilter(text: string | undefined): Record<string, unknown> {
  if (text === undefined || text.trim() === "") {
    return {};
  }

  const filter = parseObjectText(text, "the filter");

  assertFilter(filter);

  return filter;
}

function readSort(text: string | undefined): Record<string, 1 | -1> {
  if (text === undefined || text.trim() === "") {
    return { _id: 1 };
  }

  const sort = parseObjectText(text, "the sort");

  assertSort(sort);

  return sort as Record<string, 1 | -1>;
}

function clampPageSize(pageSize: number | undefined, config: StudioConfig): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    return Math.min(DEFAULT_PAGE_SIZE, config.maxPageSize);
  }

  return Math.max(1, Math.min(Math.floor(pageSize), config.maxPageSize));
}

function writeError(error: unknown): StudioError {
  if (error instanceof StudioError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.name === "MongoServerError" && /E11000/.test(error.message)) {
      return new StudioError("CONFLICT", "a document with the same unique key already exists", {
        cause: error.message,
      });
    }

    return new StudioError("QUERY_FAILED", `the document could not be written: ${error.message}`);
  }

  return new StudioError("QUERY_FAILED", `the document could not be written: ${String(error)}`);
}

export { parseEjson };
