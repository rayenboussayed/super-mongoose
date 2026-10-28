import { StudioError } from "./result";

/** Inputs parsed at the wire. */
export interface ListCollectionsInput {
  /** Expected to be undefined for GET. */
  void: void;
}

/** Parses a collection name input. */
export function asCollectionName(value: unknown): string {
  if (typeof value !== "string") {
    throw new StudioError("INVALID_INPUT", "a collection name is required");
  }

  return value;
}

/** Parses a nullable page input. */
export function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioError("INVALID_INPUT", "a string is required");
  }

  return value;
}

/** Parses a positive number input. */
export function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioError("INVALID_INPUT", "a number is required");
  }

  return value;
}

/** Parses a pagination input from the wire. */
export interface ListDocumentsInputWire {
  collection: string;
  filter?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function parseListDocumentsInput(value: unknown): ListDocumentsInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "a document list input is required");
  }

  const collection = asCollectionName(value.collection);
  const filter = asOptionalString(value.filter);
  const sort = asOptionalString(value.sort);
  const page = asOptionalNumber(value.page);
  const pageSize = asOptionalNumber(value.pageSize);

  return { collection, filter, sort, page, pageSize };
}

/** Parses a document write input from the wire. */
export interface SaveDocumentInputWire {
  collection: string;
  id?: string;
  document: string;
}

export function parseSaveDocumentInput(value: unknown): SaveDocumentInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "a document save input is required");
  }

  const collection = asCollectionName(value.collection);
  const id = asOptionalString(value.id);
  const document = asOptionalString(value.document);

  if (document === undefined) {
    throw new StudioError("INVALID_INPUT", "the document JSON is required");
  }

  return { collection, id, document };
}

/** Parses a delete input from the wire. */
export interface DeleteDocumentInputWire {
  collection: string;
  id: string;
}

export function parseDeleteDocumentInput(value: unknown): DeleteDocumentInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "a document delete input is required");
  }

  const collection = asCollectionName(value.collection);
  const id = asOptionalString(value.id);

  if (id === undefined) {
    throw new StudioError("INVALID_INPUT", "an identifier is required");
  }

  return { collection, id };
}

/** Parses a create collection input. */
export interface CreateCollectionInputWire {
  name: string;
  validator?: string;
}

export function parseCreateCollectionInput(value: unknown): CreateCollectionInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "a collection create input is required");
  }

  const name = asCollectionName(value.name);
  const validator = asOptionalString(value.validator);

  return { name, validator };
}

/** Parses an index create input. */
export interface CreateIndexInputWire {
  collection: string;
  keys: string;
  name?: string;
  unique?: boolean;
  sparse?: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: string;
  hidden?: boolean;
}

export function parseCreateIndexInput(value: unknown): CreateIndexInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "an index create input is required");
  }

  const collection = asCollectionName(value.collection);
  const keys = asOptionalString(value.keys);

  if (keys === undefined) {
    throw new StudioError("INVALID_INPUT", "the index keys are required");
  }

  const name = asOptionalString(value.name);
  const unique = asOptionalBoolean(value.unique);
  const sparse = asOptionalBoolean(value.sparse);
  const expireAfterSeconds = asOptionalNumber(value.expireAfterSeconds);
  const partialFilterExpression = asOptionalString(value.partialFilterExpression);
  const hidden = asOptionalBoolean(value.hidden);

  return {
    collection,
    keys,
    ...(name === undefined ? {} : { name }),
    ...(unique === undefined ? {} : { unique }),
    ...(sparse === undefined ? {} : { sparse }),
    ...(expireAfterSeconds === undefined ? {} : { expireAfterSeconds }),
    ...(partialFilterExpression === undefined ? {} : { partialFilterExpression }),
    ...(hidden === undefined ? {} : { hidden }),
  };
}

/** Parses an index drop input. */
export interface DropIndexInputWire {
  collection: string;
  name: string;
}

export function parseDropIndexInput(value: unknown): DropIndexInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "an index drop input is required");
  }

  const collection = asCollectionName(value.collection);
  const name = asOptionalString(value.name);

  if (name === undefined) {
    throw new StudioError("INVALID_INPUT", "an index name is required");
  }

  return { collection, name };
}

/** Parses an explain input. */
export interface ExplainInputWire {
  collection: string;
  filter?: string;
  sort?: string;
  limit?: number;
}

export function parseExplainInput(value: unknown): ExplainInputWire {
  if (!isRecord(value)) {
    throw new StudioError("INVALID_INPUT", "a query plan input is required");
  }

  const collection = asCollectionName(value.collection);
  const filter = asOptionalString(value.filter);
  const sort = asOptionalString(value.sort);
  const limit = asOptionalNumber(value.limit);

  return { collection, filter, sort, limit };
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new StudioError("INVALID_INPUT", "a boolean is required");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
