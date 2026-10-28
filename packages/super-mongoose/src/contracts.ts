import { pathToFileURL } from "node:url";
import { MigrationError } from "./errors";
import type { MigrationContractInput } from "./schemas/contract";

/**
 * The shapes a contract module may export.
 *
 * A module exports an array of contracts, or an object with that array under
 * the `contracts` key. Both are accepted so a project can add metadata to the
 * module without breaking the loader.
 */
export interface ContractModule {
  /** The contracts of the module. */
  contracts: MigrationContractInput[];
}

/**
 * Loads the contracts from a JavaScript module.
 *
 * The module exports an array of contracts, or an object whose `contracts`
 * property holds that array.
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
      `the file "${file}" could not be loaded: ${formatCause(error)}`,
      { cause: error, context: { file } },
    );
  }

  const exported = (loaded as { default?: unknown }).default ?? loaded;
  const value = isContractModule(exported) ? exported.contracts : exported;

  if (!Array.isArray(value)) {
    throw new MigrationError(
      "FILE_INVALID",
      `the file "${file}" does not export an array of contracts`,
      { context: { file } },
    );
  }

  return value as MigrationContractInput[];
}

function isContractModule(value: unknown): value is ContractModule {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { contracts?: unknown }).contracts)
  );
}

function formatCause(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
