import { Schema as MongooseSchema, mongo } from "mongoose";
import type { Connection, Model } from "mongoose";
import { MigrationError } from "../../errors";
import { isDuplicateKeyError } from "../mongo/state";

/** Collection that holds the history of the applied migrations. */
export const MIGRATION_COLLECTION = "__migrations";

/** Name of the unique index on the version of a ledger row. */
export const MIGRATION_VERSION_INDEX = "version_1";

/** One applied migration. */
export interface MigrationLedgerEntry {
  /** Version of the applied contract. */
  version: string;
  /** Checksum of the applied contract, used to detect a contract edited after it ran. */
  checksum: string;
  /** When the contract was applied. */
  appliedAt: Date;
  /** Snapshot of the models the contract declared. */
  schema: Record<string, unknown>;
}

/**
 * Reads and writes the history of the applied migrations.
 */
export class MigrationLedger {
  private readonly model: Model<MigrationLedgerEntry>;
  private readonly db: mongo.Db;

  constructor(model: Model<MigrationLedgerEntry>, db: mongo.Db) {
    this.model = model;
    this.db = db;
  }

  /**
   * Creates the unique index on the version of a ledger row, which makes an
   * applied version impossible to record twice. The index creates the
   * collection when it does not exist yet.
   *
   * @returns Nothing.
   * @throws {MigrationError} With code `OPERATION_FAILED` when the index cannot be created.
   */
  async ensureIndexes(): Promise<void> {
    try {
      await this.db
        .collection(MIGRATION_COLLECTION)
        .createIndex({ version: 1 }, { unique: true, name: MIGRATION_VERSION_INDEX });
    } catch (error) {
      throw new MigrationError(
        "OPERATION_FAILED",
        `could not create the index of the migration ledger: ${(error as Error).message}`,
        { cause: error, context: { collection: MIGRATION_COLLECTION } },
      );
    }
  }

  /**
   * Lists the applied migrations, oldest first.
   *
   * @returns The ledger rows.
   */
  async list(): Promise<MigrationLedgerEntry[]> {
    return this.model.find().sort({ appliedAt: 1 }).lean().exec();
  }

  /**
   * Records an applied migration.
   *
   * @param entry - The row to write.
   * @returns Nothing.
   * @throws {MigrationError} With code `ALREADY_APPLIED` when the version was already recorded.
   * @throws {MigrationError} With code `OPERATION_FAILED` when the write fails.
   */
  async record(entry: MigrationLedgerEntry): Promise<void> {
    try {
      await this.model.create(entry);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new MigrationError(
          "ALREADY_APPLIED",
          `the version "${entry.version}" was already applied`,
          { cause: error, context: { version: entry.version } },
        );
      }

      throw new MigrationError(
        "OPERATION_FAILED",
        `could not record the version "${entry.version}": ${(error as Error).message}`,
        { cause: error, context: { version: entry.version } },
      );
    }
  }
}

/**
 * Opens the ledger of a connection.
 *
 * The model is created with `autoCreate` and `autoIndex` disabled, so
 * registering it never touches the database. The runner creates the
 * collection and its index explicitly.
 *
 * @param connection - The connection to open the ledger on.
 * @returns The ledger of the connection.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when the connection already holds a model of the same name on another collection.
 */
export function createLedger(connection: Connection): MigrationLedger {
  const existing = connection.models[MIGRATION_COLLECTION];

  if (existing) {
    const collection = existing.collection?.name ?? existing.collection?.collectionName;

    if (collection !== undefined && collection !== MIGRATION_COLLECTION) {
      throw new MigrationError(
        "CONTRACT_INVALID",
        `the connection already holds a model named "${MIGRATION_COLLECTION}" on the collection "${collection}"`,
        { context: { collection } },
      );
    }

    return new MigrationLedger(existing as Model<MigrationLedgerEntry>, connection.db as mongo.Db);
  }

  const schema = new MongooseSchema<MigrationLedgerEntry>(
    {
      version: { type: String, required: true },
      checksum: { type: String, required: true },
      appliedAt: { type: Date, required: true },
      schema: { type: MongooseSchema.Types.Mixed, required: true },
    },
    { autoCreate: false, autoIndex: false, versionKey: false },
  );

  const model = connection.model<MigrationLedgerEntry>(
    MIGRATION_COLLECTION,
    schema,
    MIGRATION_COLLECTION,
  );

  return new MigrationLedger(model, connection.db as mongo.Db);
}
