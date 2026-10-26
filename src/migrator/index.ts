import { mongo } from "mongoose";
import type { Connection } from "mongoose";
import { MigrationError } from "../errors";
import {
  buildModelDefinition,
  compareVersions,
  contractChecksum,
  mergeModelContract,
  mergeModelContracts,
} from "../internal/definition";
import { MigrationLock } from "../internal/migration/lock";
import { MigrationLedger, createLedger } from "../internal/migration/ledger";
import { readCollectionState } from "../internal/mongo/state";
import { MigrationContract } from "../schemas/contract";
import type {
  MigrationContractInput,
  MigrationContractOutput,
  MigrationModelContractOutput,
} from "../schemas/contract";
import { applyOperations, BENIGN_SKIP_REASON } from "./apply";
import type { AppliedOperation, ApplyOptions } from "./apply";
import { planModel } from "./plan";
import type { MigrationOperation, ModelPlan } from "./plan";

/** Options of the migration runner. */
export interface MigratorOptions extends ApplyOptions {
  /** The connection the migrations run on. */
  connection: Connection;
  /** The lock that serialises the runners of a database, false turns it off. */
  lock?: false | { ttlSeconds?: number; owner?: string };
}

/** The difference between the declared state and the live state. */
export interface MigrationPlan {
  /** The plan of every declared model. */
  models: ModelPlan[];
}

/** What a run of the migrator did. */
export interface RunMigrationsResult {
  /** The versions the run applied. */
  applied: string[];
  /** The versions that were applied before. */
  skipped: string[];
  /** The result of every operation. */
  operations: AppliedOperation[];
  /** Differences that need no operation but deserve a mention. */
  advisories: string[];
}

/** The state of the migrations of a database. */
export interface MigrationsStatus {
  /** The versions that were applied. */
  applied: { version: string; checksum: string; appliedAt: Date }[];
  /** The versions that were not applied yet. */
  pending: string[];
  /** The number of operations a run would apply. */
  operations: number;
  /** The differences the runner refuses to resolve on its own. */
  conflicts: string[];
}

/**
 * Compares the declared state with the live state of the database, without
 * writing anything.
 *
 * @param contracts - The migration contracts, the version decides the order.
 * @param options - The connection and the options of the runner.
 * @returns The difference between the declared state and the live state.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when a contract does not match the migration schema.
 * @throws {MigrationError} With code `CONTRACT_CHANGED` when an applied contract changed.
 */
export async function planMigrations(
  contracts: MigrationContractInput[],
  options: MigratorOptions,
): Promise<MigrationPlan> {
  const { parsed, db, ledger } = prepare(contracts, options);

  assertContractsUnchanged(parsed, await ledger.list());

  return { models: await buildPlans(db, parsed, options) };
}

/**
 * Brings the live state of the database to the declared state of the
 * contracts, and records every version it applied.
 *
 * The runner writes the ledger row of a version only after all the
 * operations of that version succeeded, and every operation is safe to run
 * again, so an interrupted run converges on the next one.
 *
 * @param contracts - The migration contracts, the version decides the order.
 * @param options - The connection and the options of the runner.
 * @returns What the run did.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when a contract does not match the migration schema.
 * @throws {MigrationError} With code `CONTRACT_CHANGED` when an applied contract changed.
 * @throws {MigrationError} With code `CONFLICT` when the database holds an index the contract declares differently.
 * @throws {MigrationError} With code `LOCK_HELD` when another runner holds the lock.
 * @throws {MigrationError} With code `OPERATION_FAILED` when an operation did not succeed.
 */
export async function runMigrations(
  contracts: MigrationContractInput[],
  options: MigratorOptions,
): Promise<RunMigrationsResult> {
  const { parsed, db, ledger } = prepare(contracts, options);
  const lock = options.lock === false ? undefined : new MigrationLock(db, options.lock ?? {});

  await lock?.acquire();

  let failure: unknown;

  try {
    await ledger.ensureIndexes();

    const recorded = await ledger.list();

    assertContractsUnchanged(parsed, recorded);

    const recordedVersions = new Set(recorded.map((row) => row.version));
    const models = await buildPlans(db, parsed, options);
    const conflicts = models.flatMap((model) => model.conflicts);

    if (conflicts.length > 0) {
      throw new MigrationError(
        "CONFLICT",
        `the database does not match the contract:\n${conflicts.join("\n")}`,
        { context: { conflicts } },
      );
    }

    const operations = models.flatMap((model) => model.operations);
    const appliedOperations = await applyOperations(db, operations, {
      ...options,
      beforeOperation: async () => {
        await lock?.renew();
      },
    });

    assertEveryOperationSucceeded(appliedOperations);

    const applied: string[] = [];
    const skipped = [...recordedVersions];
    const snapshots = snapshotsOf(parsed);

    for (const [position, contract] of parsed.entries()) {
      if (recordedVersions.has(contract.version)) {
        continue;
      }

      try {
        await ledger.record({
          version: contract.version,
          checksum: contractChecksum(contract),
          appliedAt: new Date(),
          schema: snapshots[position],
        });
      } catch (error) {
        if (error instanceof MigrationError && error.code === "ALREADY_APPLIED") {
          skipped.push(contract.version);

          continue;
        }

        throw error;
      }

      applied.push(contract.version);
    }

    return {
      applied,
      skipped,
      operations: appliedOperations,
      advisories: models.flatMap((model) => model.advisories),
    };
  } catch (error) {
    failure = error;

    throw error;
  } finally {
    await releaseLock(lock, options, failure);
  }
}

/**
 * Reads the state of the migrations of a database, the versions that were
 * applied and the operations a run would apply.
 *
 * @param contracts - The migration contracts, the version decides the order.
 * @param options - The connection and the options of the runner.
 * @returns The state of the migrations.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when a contract does not match the migration schema.
 * @throws {MigrationError} With code `CONTRACT_CHANGED` when an applied contract changed.
 */
export async function migrationStatus(
  contracts: MigrationContractInput[],
  options: MigratorOptions,
): Promise<MigrationsStatus> {
  const { parsed, db, ledger } = prepare(contracts, options);
  const recorded = await ledger.list();

  assertContractsUnchanged(parsed, recorded);

  const recordedVersions = new Set(recorded.map((row) => row.version));
  const models = await buildPlans(db, parsed, options);

  return {
    applied: recorded.map((row) => ({
      version: row.version,
      checksum: row.checksum,
      appliedAt: row.appliedAt,
    })),
    pending: parsed
      .filter((contract) => !recordedVersions.has(contract.version))
      .map((contract) => contract.version),
    operations: models.flatMap((model) => model.operations).length,
    conflicts: models.flatMap((model) => model.conflicts),
  };
}

/**
 * Validates the contracts and opens what the runner needs.
 *
 * @param contracts - The migration contracts.
 * @param options - The connection and the options of the runner.
 * @returns The validated contracts, the database and the ledger.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when a contract does not match the migration schema.
 */
function prepare(
  contracts: MigrationContractInput[],
  options: MigratorOptions,
): { parsed: MigrationContractOutput[]; db: mongo.Db; ledger: MigrationLedger } {
  const parsed = parseContracts(contracts);
  const db = requireDb(options.connection);

  return { parsed, db, ledger: createLedger(options.connection) };
}

/**
 * Validates the contracts and sorts them by version.
 *
 * @param contracts - The migration contracts.
 * @returns The validated contracts, oldest first.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when a contract does not match the migration schema.
 */
function parseContracts(contracts: MigrationContractInput[]): MigrationContractOutput[] {
  const parsed: MigrationContractOutput[] = [];
  const versions = new Set<string>();

  for (const [position, contract] of contracts.entries()) {
    const result = MigrationContract.safeParse(contract);

    if (!result.success) {
      const issue = result.error.issues[0];

      throw new MigrationError(
        "CONTRACT_INVALID",
        `the contract at position ${position} is invalid: ${issue?.message ?? "unknown problem"}`,
        { cause: result.error, context: { position, issues: result.error.issues } },
      );
    }

    if (versions.has(result.data.version)) {
      throw new MigrationError(
        "CONTRACT_INVALID",
        `the version "${result.data.version}" is declared twice`,
        { context: { version: result.data.version } },
      );
    }

    versions.add(result.data.version);
    parsed.push(result.data);
  }

  return parsed.sort((left, right) => compareVersions(left.version, right.version));
}

/**
 * The state each version of the contracts declared, so the ledger holds the
 * state of every version and not only the last one.
 *
 * @param parsed - The contracts, oldest first.
 * @returns The state of every version.
 */
function snapshotsOf(parsed: MigrationContractOutput[]): Record<string, unknown>[] {
  const snapshots: Record<string, unknown>[] = [];
  const merged: Record<string, MigrationModelContractOutput> = {};

  for (const contract of parsed) {
    for (const [name, model] of Object.entries(contract.models)) {
      const previous = merged[name];

      merged[name] = previous ? mergeModelContract(previous, model) : model;
    }

    snapshots.push({ ...merged });
  }

  return snapshots;
}

/**
 * Refuses to work when a contract changed after it was applied.
 *
 * @param parsed - The contracts, oldest first.
 * @param recorded - The rows of the ledger.
 * @returns Nothing.
 * @throws {MigrationError} With code `CONTRACT_CHANGED` when an applied contract changed.
 */
function assertContractsUnchanged(
  parsed: MigrationContractOutput[],
  recorded: { version: string; checksum: string }[],
): void {
  const contracts = new Map(parsed.map((contract) => [contract.version, contract]));

  for (const row of recorded) {
    const contract = contracts.get(row.version);

    if (!contract) {
      continue;
    }

    const checksum = contractChecksum(contract);

    if (checksum !== row.checksum) {
      throw new MigrationError(
        "CONTRACT_CHANGED",
        `the contract of the version "${row.version}" changed after it was applied`,
        {
          context: { version: row.version, applied: row.checksum, current: checksum },
        },
      );
    }
  }
}

/**
 * Refuses to work when an operation did not succeed, so the runner never
 * records a version it did not apply.
 *
 * @param operations - The result of every operation.
 * @returns Nothing.
 * @throws {MigrationError} With code `OPERATION_FAILED` when an operation was skipped.
 */
function assertEveryOperationSucceeded(operations: AppliedOperation[]): void {
  const skipped = operations.filter(
    (operation) => operation.outcome === "skipped" && operation.reason !== BENIGN_SKIP_REASON,
  );

  if (skipped.length > 0) {
    const reasons = skipped.map((operation) => `${operation.type} ${operation.collection}: ${operation.reason}`);

    throw new MigrationError(
      "OPERATION_FAILED",
      `the runner could not apply every operation:\n${reasons.join("\n")}`,
      { context: { skipped } },
    );
  }
}

/**
 * Releases the lock without hiding the failure of the run.
 *
 * @param lock - The lock of the run, when the caller turned it on.
 * @param options - The options of the runner.
 * @param failure - The error of the run, when it failed.
 * @returns Nothing.
 */
async function releaseLock(
  lock: MigrationLock | undefined,
  options: MigratorOptions,
  failure: unknown,
): Promise<void> {
  if (!lock) {
    return;
  }

  try {
    await lock.release();
  } catch (error) {
    if (failure === undefined) {
      throw error;
    }

    options.log?.(`the lock could not be released: ${(error as Error).message}`);
  }
}

async function buildPlans(
  db: mongo.Db,
  parsed: MigrationContractOutput[],
  options: MigratorOptions,
): Promise<ModelPlan[]> {
  const plans: ModelPlan[] = [];

  for (const modelContract of Object.values(mergeModelContracts(parsed))) {
    const definition = buildModelDefinition(modelContract);
    const state = await readCollectionState(db, definition.collection);

    plans.push(
      planModel(definition, state, {
        level: options.validationLevel ?? "moderate",
        action: options.validationAction ?? "warn",
      }),
    );
  }

  return plans;
}

function requireDb(connection: Connection): mongo.Db {
  if (!connection.db || connection.readyState !== 1) {
    throw new MigrationError("CONNECTION_MISSING", "the connection is not open");
  }

  return connection.db;
}
