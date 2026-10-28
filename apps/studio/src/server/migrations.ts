import { Connection } from "mongoose";
import { MigrationError } from "super-mongoose";
import { loadContracts, migrationStatus, planMigrations, runMigrations } from "super-mongoose";
import type {
  MigrationPlan,
  MigrationsStatus,
  RunMigrationsResult,
} from "super-mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import { assertWritable } from "./guards";

/** One contract the studio found. */
export interface ContractSummary {
  /** The file the contract came from. */
  file?: string;
  /** The version of the contract. */
  version: string;
  /** The models the contract declares. */
  models: ContractModelSummary[];
}

/** One model of a contract. */
export interface ContractModelSummary {
  /** Name of the model. */
  name: string;
  /** Collection the model maps to. */
  collection: string;
  /** Number of fields. */
  fields: number;
  /** Number of indexes. */
  indexes: number;
}

/** One row of the migration ledger. */
export interface MigrationApplied {
  /** The version of the contract. */
  version: string;
  /** The checksum the runner recorded. */
  checksum: string;
  /** When the version was applied. */
  appliedAt: string;
}

/** The state of a database against the declared contracts. */
export interface MigrationOverview {
  /** Whether a contracts path points at something loadable. */
  configured: boolean;
  /** The files the studio loaded. */
  files: string[];
  /** The contracts the studio loaded. */
  contracts: ContractSummary[];
  /** Hint shown when no contracts are configured. */
  hint?: string;
  /** The ledger rows as applied by the database. */
  applied?: MigrationApplied[];
  /** Versions that have not been applied yet. */
  pending?: string[];
  /** Operations a run would apply. */
  operations?: number;
  /** Operations a run would apply, in their declared order. */
  operationList?: { type: string; collection: string; name?: string }[];
  /** Conflicts the runner refuses to resolve on its own. */
  conflicts?: string[];
  /** Advisories the runner reports. */
  advisories?: string[];
  /** Why the migration overview failed to load. */
  error?: string;
}

/** The result of a migration run. */
export interface MigrationRunResult {
  /** Versions the run applied. */
  applied: string[];
  /** Versions that were applied before. */
  skipped: string[];
  /** Operations the run applied. */
  operations: { type: string; collection: string; outcome: string; reason?: string }[];
  /** Advisories the runner reports. */
  advisories: string[];
}

/**
 * Loads the contracts of the studio, set by `SUPER_MONGOOSE_CONTRACTS` or by
 * the default `contracts` directory of the studio.
 *
 * @param config - The settings of the studio.
 * @returns The files and contracts.
 */
export async function loadContractFiles(config: StudioConfig): Promise<{
  files: string[];
  contracts: unknown[];
}> {
  const { promises: fs } = await import("node:fs");
  const pathModule = await import("node:path");

  let path = config.contractsPath;

  if (!path) {
    const candidate = pathModule.resolve(process.cwd(), "contracts");

    try {
      const stats = await fs.stat(candidate);

      if (stats.isDirectory()) {
        path = candidate;
      }
    } catch {
      path = undefined;
    }
  }

  if (!path) {
    return { files: [], contracts: [] };
  }

  const stat = await fs.stat(path);

  if (stat.isDirectory()) {
    const names = await fs.readdir(path);
    const files = names
      .filter((name) => /\.(js|mjs)$/.test(name))
      .sort();
    const contracts: unknown[] = [];

    for (const name of files) {
      contracts.push(...(await loadContracts(pathModule.join(path, name))));
    }

    return {
      files,
      contracts,
    };
  }

  return {
    files: [pathModule.basename(path)],
    contracts: await loadContracts(path),
  };
}

/**
 * Reads the migration state of a database against its declared contracts.
 *
 * @param connection - An open mongoose connection.
 * @param config - The settings of the studio.
 * @returns The state of the migrations.
 */
export async function getMigrationOverview(
  connection: Connection,
  config: StudioConfig,
): Promise<MigrationOverview> {
  try {
    const { files, contracts } = await loadContractFiles(config);

    if (contracts.length === 0) {
      return {
        configured: Boolean(config.contractsPath) || files.length > 0,
        files,
        contracts: [],
        hint:
          "Set SUPER_MONGOOSE_CONTRACTS to a contract file or a directory of JavaScript modules, or place JavaScript modules under contracts/ in the studio working directory.",
      };
    }

    const status: MigrationsStatus = await migrationStatus(contracts as never, {
      connection,
    } as never);
    const plan: MigrationPlan = await planMigrations(contracts as never, {
      connection,
    } as never);

    return {
      configured: true,
      files,
      contracts: (contracts as Record<string, unknown>[]).map((contract) => summariseContract(contract)),
      applied: status.applied.map((row: { version: string; checksum: string; appliedAt: Date }) => ({
        version: row.version,
        checksum: row.checksum,
        appliedAt: row.appliedAt.toISOString(),
      })),
      pending: status.pending,
      operations: status.operations,
      operationList: (plan.models as { operations: { type: string; collection: string; name?: string }[] }[])
        .flatMap((model) => model.operations)
        .map((operation: { type: string; collection: string; name?: string }) => ({
          type: operation.type,
          collection: operation.collection,
          ...(operation.type === "createIndex" || operation.type === "dropIndex"
            ? { name: operation.name }
            : {}),
        })),
      conflicts: status.conflicts,
      advisories: plan.models.flatMap((model) => model.advisories),
    };
  } catch (error: unknown) {
    if (error instanceof MigrationError) {
      return {
        configured: true,
        files: await loadContractFiles(config).then((entry) => entry.files).catch(() => []),
        contracts: [],
        error: `${(error as MigrationError).code}: ${(error as Error).message}`,
      };
    }

    throw new StudioError("MIGRATION_FAILED", `the migrations could not be read: ${errorMessage(error)}`, {
      cause: errorMessage(error),
    });
  }
}

/**
 * Applies the pending migrations.
 *
 * @param connection - An open mongoose connection.
 * @param config - The settings of the studio.
 * @returns The result of the run.
 * @throws {StudioError} When the studio runs read only or the run fails.
 */
export async function applyMigrations(
  connection: Connection,
  config: StudioConfig,
): Promise<MigrationRunResult> {
  assertWritable(config);

  const { contracts } = await loadContractFiles(config);

  if (contracts.length === 0) {
    throw new StudioError("NOT_FOUND", "no contracts are configured");
  }

  let result: RunMigrationsResult;

  try {
    result = await runMigrations(contracts as never, {
      connection,
      lock: { ttlSeconds: 30 },
    } as never);
  } catch (error) {
    if (error instanceof MigrationError) {
      throw new StudioError("MIGRATION_FAILED", `${(error as MigrationError).code}: ${(error as Error).message}`, {
        code: (error as MigrationError).code,
        context: (error as MigrationError).context,
      });
    }

    throw new StudioError("MIGRATION_FAILED", `the migrations could not be applied: ${errorMessage(error)}`);
  }

  return {
    applied: result.applied,
    skipped: result.skipped,
    operations: result.operations.map((operation) => ({
      type: operation.type,
      collection: operation.collection,
      outcome: operation.outcome,
      ...(operation.outcome === "skipped" ? { reason: operation.reason } : {}),
    })),
    advisories: result.advisories,
  };
}

function summariseContract(contract: Record<string, unknown>): ContractSummary {
  const models = contract.models;

  return {
    version: String(contract.version ?? ""),
    models:
      typeof models === "object" && models !== null
        ? Object.entries(models as Record<string, unknown>).map(([name, model]: [string, unknown]) => {
            const modelRecord = model as Record<string, unknown>;
            const fields = modelRecord.fields;
            const indexes = modelRecord.indexes;

            return {
              name,
              collection: String(modelRecord.collection ?? name),
              fields: fields && typeof fields === "object" ? Object.keys(fields).length : 0,
              indexes: Array.isArray(indexes) ? indexes.length : 0,
            };
          })
        : [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error as Error).message : String(error);
}
