import { StudioError } from "./result";
import type { StudioConfig } from "./config";

/** Collections the migration layer owns. The studio reads them, writes never touch them. */
export const RESERVED_COLLECTIONS = ["__migrations", "__migrations_lock"] as const;

/** Operators that run arbitrary code on the server, or skip the query planner. */
export const FORBIDDEN_OPERATORS = ["$where", "$function", "$accumulator"] as const;

/** Keys that could change the prototype of an object. */
export const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"] as const;

const FORBIDDEN_OPERATOR_SET = new Set<string>(FORBIDDEN_OPERATORS);
const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_KEYS);
const COLLECTION_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/**
 * Refuses every write when the studio runs read only.
 *
 * @param config - The settings of the studio.
 * @throws {StudioError} With code `READ_ONLY` when writes are off.
 */
export function assertWritable(config: StudioConfig): void {
  if (config.readOnly) {
    throw new StudioError(
      "READ_ONLY",
      "the studio runs read only, set STUDIO_READ_ONLY=0 to allow writes",
    );
  }
}

/**
 * Validates a collection name and refuses the collections of the layer.
 *
 * @param name - The collection name.
 * @throws {StudioError} With code `INVALID_INPUT` when the name is unsafe.
 */
export function assertCollectionName(name: string): void {
  if (
    name.length === 0 ||
    name.length > 200 ||
    !COLLECTION_NAME.test(name) ||
    name.includes("$") ||
    name.startsWith("system.") ||
    name.startsWith(".") ||
    name.includes("..")
  ) {
    throw new StudioError(
      "INVALID_INPUT",
      "a collection name needs letters, digits, dots, dashes or underscores and cannot start with system. or a dot",
    );
  }
}

/**
 * Refuses the collections the migration layer owns.
 *
 * @param name - The collection name.
 * @throws {StudioError} With code `FORBIDDEN` when the collection belongs to the layer.
 */
export function assertNotReserved(name: string): void {
  if ((RESERVED_COLLECTIONS as readonly string[]).includes(name)) {
    throw new StudioError("FORBIDDEN", `the collection "${name}" belongs to the migration layer`);
  }
}

/**
 * Runs the collection checks a write needs.
 *
 * @param name - The collection name.
 * @param config - The settings of the studio.
 * @throws {StudioError} When the write is not allowed.
 */
export function assertCollectionWrite(name: string, config: StudioConfig): void {
  assertWritable(config);
  assertCollectionName(name);
  assertNotReserved(name);
}

function assertSafeValue(value: unknown, path: string, seen: Set<object>, depth: number): void {
  if (depth > 40) {
    throw new StudioError("INVALID_INPUT", `${path} is nested too deeply`);
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertSafeValue(item, `${path}[${index}]`, seen, depth + 1);
    }

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    throw new StudioError("INVALID_INPUT", `${path} contains a cycle`);
  }

  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      throw new StudioError("INVALID_INPUT", `${path}.${key} is not allowed`);
    }

    if (FORBIDDEN_OPERATOR_SET.has(key)) {
      throw new StudioError(
        "FORBIDDEN",
        `${key} is not allowed, the studio does not run server side JavaScript`,
      );
    }

    assertSafeValue(child, `${path}.${key}`, seen, depth + 1);
  }

  seen.delete(value);
}

/**
 * Refuses a filter or any other value that carries an operator the studio
 * will not run.
 *
 * @param value - The value to inspect.
 * @param label - The name of the value, used in messages.
 * @throws {StudioError} With code `FORBIDDEN` when a dangerous operator is present.
 */
export function assertSafeQueryValue(value: unknown, label: string): void {
  assertSafeValue(value, label, new Set<object>(), 0);
}

/**
 * Refuses a document whose top level would confuse an update.
 *
 * @param document - The document to write.
 * @throws {StudioError} With code `INVALID_INPUT` when the document is not a plain object.
 */
export function assertDocumentBody(document: Record<string, unknown>): void {
  assertSafeValue(document, "the document", new Set<object>(), 0);

  for (const key of Object.keys(document)) {
    if (key.startsWith("$")) {
      throw new StudioError(
        "INVALID_INPUT",
        "a stored document cannot hold a top level key that starts with $, it would read as an update operator",
      );
    }
  }
}

/**
 * Refuses a filter whose keys would escape the collection.
 *
 * @param filter - The filter to write.
 * @throws {StudioError} With code `INVALID_INPUT` when a key is unsafe.
 */
export function assertFilter(filter: Record<string, unknown>): void {
  assertSafeQueryValue(filter, "the filter");

  for (const key of Object.keys(filter)) {
    if (key === "" || key.includes("\0")) {
      throw new StudioError("INVALID_INPUT", "a filter key cannot be empty or hold a null byte");
    }
  }
}

/**
 * Validates the sort document of a query.
 *
 * @param sort - The sort to write.
 * @throws {StudioError} With code `INVALID_INPUT` when a direction is unsupported.
 */
export function assertSort(sort: Record<string, unknown>): void {
  assertSafeQueryValue(sort, "the sort");

  for (const [key, direction] of Object.entries(sort)) {
    if (
      key.length === 0 ||
      key.startsWith("$") ||
      (direction !== 1 && direction !== -1)
    ) {
      throw new StudioError(
        "INVALID_INPUT",
        "a sort needs field names and the direction 1 or -1",
      );
    }
  }
}

/**
 * Validates the keys of an index and returns them in their declared order.
 *
 * @param keys - The index keys.
 * @returns The key entries.
 * @throws {StudioError} With code `INVALID_INPUT` when a key or direction is unsupported.
 */
export function assertIndexKeys(keys: Record<string, unknown>): [string, 1 | -1][] {
  const entries = Object.entries(keys);

  if (entries.length === 0) {
    throw new StudioError("INVALID_INPUT", "an index needs at least one field");
  }

  return entries.map(([key, direction]) => {
    if (key.length === 0 || key.startsWith("$") || key.includes("\0")) {
      throw new StudioError("INVALID_INPUT", "an index key needs a field name");
    }

    if (direction !== 1 && direction !== -1) {
      throw new StudioError("INVALID_INPUT", "the studio creates indexes with the direction 1 or -1");
    }

    return [key, direction] as [string, 1 | -1];
  });
}

/**
 * Validates an index name.
 *
 * @param name - The index name.
 * @throws {StudioError} With code `INVALID_INPUT` when the name is reserved or unsupported.
 */
export function assertIndexName(name: string): void {
  if (
    name.length === 0 ||
    name.length > 127 ||
    name === "_id_" ||
    name === "*" ||
    name.includes("\0")
  ) {
    throw new StudioError(
      "INVALID_INPUT",
      "an index name needs 1 to 127 characters and cannot be _id_ or *",
    );
  }
}
