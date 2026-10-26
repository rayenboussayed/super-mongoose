import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { MigrationError } from "../errors";
import { MigrationModelContract } from "../schemas/contract";
import type {
  IndexDirectionValue,
  MigrationContractOutput,
  MigrationModelContractInput,
  MigrationModelContractOutput,
  MigrationModelFieldContractOutput,
  MigrationStatus,
  MongooseTypeName,
} from "../schemas/contract";

/** Maximum nesting depth allowed for subdocuments, to stop a recursive contract. */
const MAX_SUB_DOCUMENT_DEPTH = 10;

/** A single field of a model, resolved from its contract. */
export interface FieldDefinition {
  /** Field name inside the document. */
  name: string;
  /** Contract type name, for example "String". */
  type: MongooseTypeName;
  /** "up" creates the field, "down" retires it, "ignore" leaves it to the application. */
  status: MigrationStatus;
  /** Whether the field must be present. */
  required: boolean;
  /** Default value applied by Mongoose when the field is missing. */
  default?: unknown;
  /** Allowed values. */
  enum?: (string | number)[];
  /** Compiled regular expression the value must match. */
  match?: RegExp;
  /** Trims the value before saving. */
  trim?: boolean;
  /** Lowercases the value before saving. */
  lowercase?: boolean;
  /** Uppercases the value before saving. */
  uppercase?: boolean;
  /** Minimum string length. */
  minLength?: number;
  /** Maximum string length. */
  maxLength?: number;
  /** Minimum value, a number for numeric fields and a date string for date fields. */
  min?: number | string;
  /** Maximum value, a number for numeric fields and a date string for date fields. */
  max?: number | string;
  /** Model name referenced by an ObjectId field. */
  ref?: string;
  /** Whether the value can change after the document is created. */
  immutable?: boolean;
  /** Whether the field is selected by default. */
  select?: boolean;
  /** Element type of an array, or value type of a map. */
  element?: FieldDefinition;
  /** Fields of a subdocument. */
  children?: Record<string, FieldDefinition>;
}

/** A single index of a model, resolved from its contract. */
export interface IndexDefinition {
  /** Index name, unique inside the collection. */
  name: string;
  /** Indexed fields and their direction, the order of a compound key matters. */
  key: Record<string, IndexDirectionValue>;
  /** "up" creates the index, "down" drops it. */
  status: MigrationStatus;
  /** Whether the index rejects duplicates. */
  unique?: boolean;
  /** Whether the index skips documents that miss the indexed field. */
  sparse?: boolean;
  /** Seconds after which the indexed document expires. */
  expireAfterSeconds?: number;
  /** Filter that restricts the documents the index covers. */
  partialFilterExpression?: Record<string, unknown>;
}

/** A model, resolved from its contract. */
export interface ModelDefinition {
  /** Model name, used as the Mongoose model name. */
  name: string;
  /** Collection the model is stored in. */
  collection: string;
  /** Schema options declared by the contract. */
  options: {
    timestamps: boolean;
    versionKey?: string | false;
    strict?: boolean | "throw";
    _id?: boolean;
    discriminatorKey?: string;
  };
  /** Fields of the model, keyed by field name. */
  fields: Record<string, FieldDefinition>;
  /** Indexes of the model. */
  indexes: IndexDefinition[];
}

/**
 * Builds the index name the MongoDB driver gives to a key, for example
 * "email_1" for `{ email: 1 }` or "status_-1_createdAt_1" for a compound key.
 *
 * @param key - Indexed fields and their direction.
 * @returns The index name.
 */
export function defaultIndexName(key: Record<string, IndexDirectionValue>): string {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join("_");
}

/**
 * Tells whether two index keys cover the same fields in the same order. The
 * order of a compound key decides which queries the index serves, so two keys
 * with the same fields in a different order are different indexes.
 *
 * @param left - The first key.
 * @param right - The second key.
 * @returns True when both keys are equivalent.
 */
export function isSameIndexKey(
  left: Record<string, IndexDirectionValue>,
  right: Record<string, IndexDirectionValue>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(
    ([field, direction], position) =>
      rightEntries[position][0] === field && rightEntries[position][1] === direction,
  );
}

/**
 * The schema options of a model that carry a value.
 *
 * @param options - The options of the model.
 * @returns The options that are set.
 */
export function definedModelOptions(
  options: ModelDefinition["options"],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  );
}

/**
 * Resolves a model contract into the internal definition the Mongoose schema
 * builder, the validator builder and the index builder all read.
 *
 * @param contract - A model contract that already passed the schema validation.
 * @returns The resolved model definition.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when the contract nests deeper than allowed.
 */
export function buildModelDefinition(contract: MigrationModelContractOutput): ModelDefinition {
  return {
    name: contract.name,
    collection: contract.collection ?? collectionNameOf(contract.name),
    options: {
      timestamps: contract.options.timestamps,
      versionKey: contract.options.versionKey,
      strict: contract.options.strict,
      _id: contract.options._id,
      discriminatorKey: contract.options.discriminatorKey,
    },
    fields: buildFields(contract.fields),
    indexes: buildIndexes(contract),
  };
}

/**
 * Validates a model contract and resolves it into the definition the schema
 * builder and the runner read.
 *
 * @param contract - The model contract to compile.
 * @returns The resolved model definition.
 * @throws {import("zod").ZodError} When the contract does not match the migration schema.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when the contract nests deeper than allowed.
 */
export function compileModelContract(contract: MigrationModelContractInput): ModelDefinition {
  return buildModelDefinition(MigrationModelContract.parse(contract));
}

/**
 * Resolves the collection of a model the way Mongoose does, so a model built
 * from a contract and a hand written model with the same name live in the
 * same collection.
 *
 * @param name - The model name.
 * @returns The collection name.
 */
function collectionNameOf(name: string): string {
  const pluralize = mongoose.pluralize();

  return pluralize ? pluralize(name) : name;
}

function buildFields(
  fields: Record<string, MigrationModelFieldContractOutput>,
  depth = 0,
): Record<string, FieldDefinition> {
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, buildField(name, field, depth)]),
  );
}

function buildField(
  name: string,
  field: MigrationModelFieldContractOutput,
  depth: number,
): FieldDefinition {
  if (depth > MAX_SUB_DOCUMENT_DEPTH) {
    throw new MigrationError(
      "CONTRACT_INVALID",
      `subdocument nesting is deeper than ${MAX_SUB_DOCUMENT_DEPTH} levels at field "${name}"`,
      { context: { field: name } },
    );
  }

  if (depth > 0 && (field.unique === true || field.index === true || field.sparse === true)) {
    throw new MigrationError(
      "CONTRACT_INVALID",
      `field "${name}" declares an index inside a subdocument or an element, declare it in the top level indexes instead`,
      { context: { field: name } },
    );
  }

  return {
    name,
    type: field.type,
    status: field.status,
    required: field.required,
    default: field.default,
    enum: field.enum,
    match: compilePattern(name, field.match),
    trim: field.trim,
    lowercase: field.lowercase,
    uppercase: field.uppercase,
    minLength: field.minLength,
    maxLength: field.maxLength,
    min: field.min,
    max: field.max,
    ref: field.ref,
    immutable: field.immutable,
    select: field.select,
    element: field.of ? buildField(name, field.of, depth + 1) : undefined,
    children: field.fields ? buildFields(field.fields, depth + 1) : undefined,
  };
}

function compilePattern(name: string, source: string | undefined): RegExp | undefined {
  if (source === undefined) {
    return undefined;
  }

  try {
    return new RegExp(source);
  } catch (error) {
    throw new MigrationError(
      "CONTRACT_INVALID",
      `the pattern of field "${name}" is not a valid regular expression`,
      { cause: error, context: { field: name, pattern: source } },
    );
  }
}

function buildIndexes(contract: MigrationModelContractOutput): IndexDefinition[] {
  const indexes: IndexDefinition[] = contract.indexes.map((index) => ({
    name: index.name ?? defaultIndexName(index.fields),
    key: { ...index.fields },
    status: index.status,
    unique: index.unique,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
  }));

  for (const [name, field] of Object.entries(contract.fields)) {
    if (field.status !== "up" || (!field.unique && !field.index)) {
      continue;
    }

    const key = { [name]: 1 } as Record<string, IndexDirectionValue>;

    if (indexes.some((index) => index.status === "up" && isSameIndexKey(index.key, key))) {
      continue;
    }

    indexes.push({
      name: defaultIndexName(key),
      key,
      status: "up",
      unique: field.unique,
      sparse: field.sparse,
    });
  }

  assertUniqueIndexNames(indexes);
  assertUniqueIndexKeys(indexes);

  return indexes;
}

function assertUniqueIndexNames(indexes: IndexDefinition[]): void {
  const names = new Set<string>();

  for (const index of indexes) {
    if (names.has(index.name)) {
      throw new MigrationError(
        "CONTRACT_INVALID",
        `the index name "${index.name}" is used twice in the model`,
        { context: { name: index.name } },
      );
    }

    names.add(index.name);
  }
}

/**
 * Two indexes that cover the same fields are the same index, unless one of
 * them is retired. A contract that drops an index and creates another one
 * over the same fields renames the index.
 */
function assertUniqueIndexKeys(indexes: IndexDefinition[]): void {
  for (const [position, index] of indexes.entries()) {
    const duplicate = indexes
      .slice(position + 1)
      .find(
        (candidate) =>
          candidate.status === index.status && isSameIndexKey(candidate.key, index.key),
      );

    if (duplicate) {
      throw new MigrationError(
        "CONTRACT_INVALID",
        `the indexes "${index.name}" and "${duplicate.name}" cover the same fields`,
        { context: { name: index.name, other: duplicate.name } },
      );
    }
  }
}

/**
 * Merges the models of several contracts into one desired state, the last
 * contract that names a model wins. A contract declares the complete state
 * of the models it names, the models it does not name stay untouched.
 *
 * A field the newer contract does not mention anymore is carried over with
 * status "down", so the field leaves the schema and the validator while the
 * stored documents keep their value.
 *
 * @param contracts - The contracts, oldest first.
 * @returns The merged models, keyed by model name.
 */
export function mergeModelContracts(
  contracts: MigrationContractOutput[],
): Record<string, MigrationModelContractOutput> {
  const merged: Record<string, MigrationModelContractOutput> = {};

  for (const contract of contracts) {
    for (const [name, model] of Object.entries(contract.models)) {
      const previous = merged[name];

      merged[name] = previous ? mergeModelContract(previous, model) : model;
    }
  }

  return merged;
}

/**
 * Merges the model of a newer contract into the model of an older one.
 *
 * A field the newer contract does not name anymore is carried over with
 * status "down", so the field leaves the schema and the validator while the
 * stored documents keep their value.
 *
 * @param previous - The model of the older contract.
 * @param current - The model of the newer contract.
 * @returns The merged model.
 */
export function mergeModelContract(
  previous: MigrationModelContractOutput,
  current: MigrationModelContractOutput,
): MigrationModelContractOutput {
  const removed: Record<string, MigrationModelFieldContractOutput> = {};

  for (const [name, field] of Object.entries(previous.fields)) {
    if (current.fields[name] === undefined) {
      removed[name] = { ...field, status: "down" };
    }
  }

  if (Object.keys(removed).length === 0) {
    return current;
  }

  return {
    ...current,
    fields: { ...removed, ...current.fields },
  };
}

/**
 * Serialises a value with sorted object keys, so two equal values always
 * produce the same string.
 *
 * Values that JSON does not cover, a date, a regular expression, a buffer or
 * a function, get a tagged form, so a contract that holds one still has a
 * stable checksum.
 *
 * @param value - The value to serialise.
 * @returns The canonical JSON string.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return canonicalScalar(value);
  }

  if (value instanceof Date) {
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }

  if (value instanceof RegExp) {
    return `{"$regex":${JSON.stringify(value.source)},"$flags":${JSON.stringify(value.flags)}}`;
  }

  if (Buffer.isBuffer(value)) {
    return `{"$buffer":${JSON.stringify(value.toString("base64"))}}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);

  return `{${entries.join(",")}}`;
}

function canonicalScalar(value: unknown): string {
  switch (typeof value) {
    case "undefined":
    case "object":
      return "null";
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value)
        ? JSON.stringify(value)
        : `{"$number":${JSON.stringify(String(value))}}`;
    case "bigint":
      return `{"$bigint":${JSON.stringify(value.toString())}}`;
    case "function":
      return `{"$function":${JSON.stringify(value.toString())}}`;
    case "symbol":
      return `{"$symbol":${JSON.stringify(String(value))}}`;
  }
}

/**
 * Compares two contract versions, so the order of the versions does not
 * depend on how the numbers inside them are written.
 *
 * The parts of a version that are numbers are compared as numbers, so "10"
 * comes after "2" and not before it.
 *
 * @param left - The first version.
 * @param right - The second version.
 * @returns A negative number when the first version is older, a positive
 * number when it is newer and zero when both are the same.
 */
export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/(\d+)/);
  const rightParts = right.split(/(\d+)/);

  for (const [position, leftPart] of leftParts.entries()) {
    const rightPart = rightParts[position];

    if (rightPart === undefined) {
      return 1;
    }

    if (leftPart === rightPart) {
      continue;
    }

    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return leftPart < rightPart ? -1 : 1;
  }

  return rightParts.length > leftParts.length ? -1 : 0;
}

/**
 * Computes the checksum of a migration contract, so a contract that changed
 * after it was applied can be detected.
 *
 * @param contract - The contract to hash.
 * @returns A 16 character hexadecimal checksum.
 */
export function contractChecksum(contract: MigrationContractOutput): string {
  return createHash("sha256").update(canonicalJson(contract)).digest("hex").slice(0, 16);
}
