import { mongo } from "mongoose";
import { MigrationError } from "../errors";
import { isIndexNotFound, isNamespaceExists, isUnauthorized, mongoErrorCode } from "../internal/mongo/state";
import type { MigrationOperation } from "./plan";

/** The reason of an operation the runner skipped because it was already done. */
export const BENIGN_SKIP_REASON = "the index does not exist";

/** The outcome of one operation, without the time it took. */
export interface OperationOutcome {
  /** Kind of the operation. */
  type: MigrationOperation["type"];
  /** Collection the operation ran on. */
  collection: string;
  /** Name of the index the operation ran on, when it had one. */
  name?: string;
  /** Whether the operation ran or was skipped. */
  outcome: "applied" | "skipped";
  /** Why the operation was skipped. */
  reason?: string;
}

/** The result of one applied operation. */
export interface AppliedOperation extends OperationOutcome {
  /** How long the operation took, in milliseconds. */
  durationMs: number;
}

/** Options of the applier. */
export interface ApplyOptions {
  /** Where the runner writes what it does. */
  log?: (message: string) => void;
  /** Validation level of the validator, "moderate" by default. */
  validationLevel?: "strict" | "moderate";
  /** Validation action of the validator, "warn" by default. */
  validationAction?: "error" | "warn";
  /** Runs before every operation, the runner uses it to renew its lock. */
  beforeOperation?: () => Promise<void>;
}

/**
 * Applies the operations of a plan, one by one.
 *
 * Every operation is safe to run again: creating an index that already
 * exists does nothing, dropping an index that does not exist is skipped, and
 * a collection that appeared in the meantime gets its validator set instead
 * of being created.
 *
 * @param db - The database to apply the operations on.
 * @param operations - The operations to apply.
 * @param options - Where the runner writes what it does and how it validates.
 * @returns The result of every operation.
 * @throws {MigrationError} With code `OPERATION_FAILED` when an operation fails.
 */
export async function applyOperations(
  db: mongo.Db,
  operations: MigrationOperation[],
  options: ApplyOptions = {},
): Promise<AppliedOperation[]> {
  const results: AppliedOperation[] = [];

  for (const operation of operations) {
    await options.beforeOperation?.();

    const startedAt = Date.now();
    const result = await applyOperation(db, operation, options);
    const durationMs = Date.now() - startedAt;

    results.push({ ...result, durationMs });
    options.log?.(
      `[${result.outcome}] ${operation.type} ${operation.collection}${
        operation.type === "createIndex" || operation.type === "dropIndex"
          ? ` ${operation.name}`
          : ""
      }${result.reason ? ` (${result.reason})` : ""} ${durationMs}ms`,
    );
  }

  return results;
}

async function applyOperation(
  db: mongo.Db,
  operation: MigrationOperation,
  options: ApplyOptions,
): Promise<OperationOutcome> {
  switch (operation.type) {
    case "createCollection":
      return createCollection(db, operation, options);
    case "setValidator":
      return setValidator(db, operation, options);
    case "createIndex":
      return createIndex(db, operation);
    case "dropIndex":
      return dropIndex(db, operation);
  }
}

async function createCollection(
  db: mongo.Db,
  operation: Extract<MigrationOperation, { type: "createCollection" }>,
  options: ApplyOptions,
): Promise<OperationOutcome> {
  try {
    await db.createCollection(operation.collection, {
      validator: operation.validator,
      ...validationOptions(options),
    });

    return { type: operation.type, collection: operation.collection, outcome: "applied" };
  } catch (error) {
    if (!isNamespaceExists(error)) {
      throw operationError(operation, error);
    }
  }

  const outcome = await setValidator(
    db,
    { type: "setValidator", collection: operation.collection, validator: operation.validator },
    options,
  );

  return {
    ...outcome,
    type: operation.type,
    reason: "the collection already existed, the validator was set instead",
  };
}

async function setValidator(
  db: mongo.Db,
  operation: Extract<MigrationOperation, { type: "setValidator" }>,
  options: ApplyOptions,
): Promise<OperationOutcome> {
  try {
    await db.command({
      collMod: operation.collection,
      validator: operation.validator,
      ...validationOptions(options),
    });

    return { type: operation.type, collection: operation.collection, outcome: "applied" };
  } catch (error) {
    if (isUnauthorized(error)) {
      return {
        type: operation.type,
        collection: operation.collection,
        outcome: "skipped",
        reason: "the database user has no collMod privilege, it needs dbAdmin or dbOwner on the database",
      };
    }

    throw operationError(operation, error);
  }
}

async function createIndex(
  db: mongo.Db,
  operation: Extract<MigrationOperation, { type: "createIndex" }>,
): Promise<OperationOutcome> {
  try {
    await db.collection(operation.collection).createIndex(operation.key, operation.options);

    return {
      type: operation.type,
      collection: operation.collection,
      name: operation.name,
      outcome: "applied",
    };
  } catch (error) {
    if (mongoErrorCode(error) === 85) {
      return {
        type: operation.type,
        collection: operation.collection,
        name: operation.name,
        outcome: "skipped",
        reason: "an equivalent index already exists under another name",
      };
    }

    throw operationError(operation, error);
  }
}

async function dropIndex(
  db: mongo.Db,
  operation: Extract<MigrationOperation, { type: "dropIndex" }>,
): Promise<OperationOutcome> {
  try {
    await db.collection(operation.collection).dropIndex(operation.name);

    return {
      type: operation.type,
      collection: operation.collection,
      name: operation.name,
      outcome: "applied",
    };
  } catch (error) {
    if (isIndexNotFound(error)) {
      return {
        type: operation.type,
        collection: operation.collection,
        name: operation.name,
        outcome: "skipped",
        reason: BENIGN_SKIP_REASON,
      };
    }

    throw operationError(operation, error);
  }
}

/**
 * The level and the action the server applies the validator with.
 *
 * @param options - The options of the applier.
 * @returns The options of the command.
 */
function validationOptions(options: ApplyOptions): {
  validationLevel: "strict" | "moderate";
  validationAction: "error" | "warn";
} {
  return {
    validationLevel: options.validationLevel ?? "moderate",
    validationAction: options.validationAction ?? "warn",
  };
}

function operationError(operation: MigrationOperation, error: unknown): MigrationError {
  const target = "name" in operation ? ` ${operation.name}` : "";
  const reason = error instanceof Error ? error.message : String(error);

  return new MigrationError(
    "OPERATION_FAILED",
    `could not ${operation.type} on "${operation.collection}"${target}: ${reason}`,
    {
      cause: error,
      context: {
        collection: operation.collection,
        type: operation.type,
        ...("name" in operation ? { name: operation.name } : {}),
      },
    },
  );
}
