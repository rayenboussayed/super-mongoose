/**
 * The reasons a migration run failed.
 */
export const MIGRATION_ERROR_CODES = [
  "CONTRACT_INVALID",
  "CONTRACT_CHANGED",
  "ALREADY_APPLIED",
  "CONFLICT",
  "LOCK_HELD",
  "OPERATION_FAILED",
  "CONNECTION_MISSING",
  "FILE_INVALID",
] as const;

/**
 * Reason a migration run failed.
 *
 * - `CONTRACT_INVALID`: a contract does not match the migration schema.
 * - `CONTRACT_CHANGED`: a version was already applied with a different contract.
 * - `ALREADY_APPLIED`: a version was already applied.
 * - `CONFLICT`: the database holds an index the contract declares differently.
 * - `LOCK_HELD`: another runner holds the migration lock.
 * - `OPERATION_FAILED`: a database operation failed.
 * - `CONNECTION_MISSING`: no database connection was given.
 * - `FILE_INVALID`: a migration file could not be loaded.
 */
export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[number];

/**
 * Error raised by the migration layer. It always carries a machine readable
 * code and the underlying failure as its cause.
 *
 * @example
 * ```ts
 * try {
 *   await runMigrations(contracts, { connection });
 * } catch (error) {
 *   if (error instanceof MigrationError && error.code === "LOCK_HELD") {
 *     console.log("another runner is migrating");
 *   }
 * }
 * ```
 */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: MigrationErrorCode,
    message: string,
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MigrationError";
    this.code = code;
    this.context = options.context ?? {};
  }
}
