#!/usr/bin/env node
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { MigrationError } from "./errors";
import { migrationStatus, planMigrations, runMigrations } from "./migrator";
import type { MigrationPlan, MigratorOptions, MigrationsStatus, RunMigrationsResult } from "./migrator";
import type { MigrationContractInput } from "./schemas/contract";

/** The commands the CLI understands. */
export const MIGRATION_COMMANDS = ["plan", "up", "status"] as const;

/** One command of the CLI. */
export type MigrationCommand = (typeof MIGRATION_COMMANDS)[number];

/** The usage text of the CLI. */
export const USAGE = `Usage: super-mongoose migrate <${MIGRATION_COMMANDS.join(" | ")}> --file <path>

  plan    prints the difference between the contract and the database
  up      applies the difference and records the applied versions
  status  prints the applied versions and the pending work

Options:
  --file <path>      the JavaScript module that exports the contracts
  --database <name>  the database to run on, the one of the connection string by default
  --help             prints this text

The connection string comes from the MONGO_URL environment variable.
The file of the contracts is JavaScript, the command runs it.`;

/**
 * Runs the migration CLI.
 *
 * The contracts are read from a JavaScript module given with `--file`, the
 * module exports an array of contracts. The connection string comes from the
 * `MONGO_URL` environment variable.
 *
 * @param argv - The arguments of the process, without the node binary.
 * @returns The exit code, 0 when the command succeeded.
 */
export async function main(argv: string[]): Promise<number> {
  let values: { file?: string; database?: string; help?: boolean };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        file: { type: "string" },
        database: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    }));
  } catch (error) {
    return usageError((error as Error).message);
  }

  if (values.help) {
    console.log(USAGE);

    return 0;
  }

  const command = readCommand(positionals);

  if (!command) {
    return usageError();
  }

  if (!values.file) {
    return usageError("Missing required flag: --file <path>");
  }

  const uri = process.env.MONGO_URL;

  if (!uri) {
    console.error("MONGO_URL is required for the migration commands");

    return 1;
  }

  let contracts: MigrationContractInput[];

  try {
    contracts = await loadContracts(values.file);
  } catch (error) {
    console.error(formatError(error));

    return 1;
  }

  try {
    await mongoose.connect(uri, values.database ? { dbName: values.database } : undefined);
  } catch (error) {
    console.error(`Could not connect to the database: ${formatError(error)}`);

    return 1;
  }

  try {
    const options: MigratorOptions = {
      connection: mongoose.connection,
      log: (message: string) => console.log(message),
    };

    if (command === "plan") {
      return printPlan(await planMigrations(contracts, options));
    }

    if (command === "status") {
      return printStatus(await migrationStatus(contracts, options));
    }

    return printRun(await runMigrations(contracts, options));
  } catch (error) {
    console.error(formatError(error));

    return 1;
  } finally {
    await disconnect();
  }
}

/**
 * Reads the command out of the positional arguments.
 *
 * @param positionals - The positional arguments of the process.
 * @returns The command, or undefined when the arguments hold no known one.
 */
export function readCommand(positionals: string[]): MigrationCommand | undefined {
  const [first, second] = positionals;

  if (first !== "migrate" || second === undefined) {
    return undefined;
  }

  return MIGRATION_COMMANDS.includes(second as MigrationCommand)
    ? (second as MigrationCommand)
    : undefined;
}

/**
 * Loads the contracts from a JavaScript module.
 *
 * The module exports an array of contracts.
 *
 * @param file - The path of the module.
 * @returns The contracts of the module.
 * @throws {MigrationError} With code `FILE_INVALID` when the module holds no contracts.
 */
export async function loadContracts(file: string): Promise<MigrationContractInput[]> {
  let loaded: unknown;

  try {
    loaded = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new MigrationError(
      "FILE_INVALID",
      `the file "${file}" could not be loaded: ${formatError(error)}`,
      { cause: error, context: { file } },
    );
  }

  const value = (loaded as { default?: unknown }).default ?? loaded;

  if (!Array.isArray(value)) {
    throw new MigrationError(
      "FILE_INVALID",
      `the file "${file}" does not export an array of contracts`,
      { context: { file } },
    );
  }

  return value as MigrationContractInput[];
}

/**
 * Runs the migration CLI as a process and sets the exit code of the process.
 *
 * @param argv - The arguments of the process, without the node binary.
 * @returns Nothing.
 */
export function runCliProcess(argv: string[] = process.argv.slice(2)): Promise<void> {
  return main(argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(formatError(error));
      process.exitCode = 1;
    });
}

function printPlan(plan: MigrationPlan): number {
  const operations = plan.models.flatMap((model) => model.operations);

  if (operations.length === 0) {
    console.log("the database matches the contract");
  } else {
    for (const operation of operations) {
      console.log(
        `${operation.type} ${operation.collection}${
          "name" in operation ? ` ${operation.name}` : ""
        }`,
      );
    }
  }

  printAdvisories(plan.models.flatMap((model) => model.advisories));

  return printConflicts(plan.models.flatMap((model) => model.conflicts));
}

function printStatus(status: MigrationsStatus): number {
  for (const row of status.applied) {
    console.log(`applied ${row.version} ${row.appliedAt.toISOString()}`);
  }

  for (const version of status.pending) {
    console.log(`pending ${version}`);
  }

  console.log(`${status.operations} operations to apply`);

  return printConflicts(status.conflicts);
}

function printRun(result: RunMigrationsResult): number {
  console.log(
    `applied ${result.applied.length} versions, ${result.skipped.length} were already applied`,
  );

  for (const version of result.applied) {
    console.log(`applied ${version}`);
  }

  for (const operation of result.operations) {
    if (operation.outcome === "skipped") {
      console.log(`skipped ${operation.type} ${operation.collection}: ${operation.reason}`);
    }
  }

  printAdvisories(result.advisories);

  return 0;
}

function printAdvisories(advisories: string[]): void {
  for (const advisory of advisories) {
    console.log(`advisory: ${advisory}`);
  }
}

function printConflicts(conflicts: string[]): number {
  for (const conflict of conflicts) {
    console.log(`conflict: ${conflict}`);
  }

  return conflicts.length > 0 ? 1 : 0;
}

function usageError(message?: string): number {
  if (message) {
    console.error(message);
  }

  console.error(USAGE);

  return 2;
}

/**
 * The text of an error, with the code and the context of the errors of the
 * layer.
 *
 * @param error - The error to read.
 * @returns The text of the error.
 */
export function formatError(error: unknown): string {
  if (error instanceof MigrationError) {
    const context = Object.keys(error.context).length > 0 ? ` ${JSON.stringify(error.context)}` : "";

    return `${error.code}: ${error.message}${context}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function disconnect(): Promise<void> {
  try {
    await mongoose.disconnect();
  } catch {
    // The exit code of the command matters more than the failure of the disconnect.
  }
}

if (require.main === module) void runCliProcess();
