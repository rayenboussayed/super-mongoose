import { Connection, mongo, createConnection } from "mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import { getMigrationOverview } from "./migrations";
import type { MigrationOverview } from "./migrations";
import { listCollections } from "./collections";
import type { CollectionSummary } from "./collections";
import { configFromEnv } from "./config";

/** The overview screen reads. */
export interface StudioOverview {
  /** Name of the database. */
  database: string;
  /** Whether writes are disabled. */
  readOnly: boolean;
  /** Masked connection string. */
  uriDisplay: string;
  /** Version of the MongoDB server. */
  serverVersion: string;
  /** Number of collections. */
  collectionsCount: number;
  /** Number of views. */
  viewsCount: number;
  /** Total documents. */
  documentsCount: number;
  /** Total indexes. */
  indexesCount: number;
  /** Total storage in bytes. */
  storageBytes: number;
  /** The collections, sorted by name. */
  collections: CollectionSummary[];
  /** The migration state, when contracts are configured. */
  migrations: MigrationOverview;
}

/**
 * Opens and caches a connection to the database.
 */
export class ConnectionManager {
  private connectionPromise: Promise<Connection> | undefined;
  private connection: Connection | undefined;

  constructor(private readonly config: StudioConfig) {}

  /**
   * Returns the open connection, opening it when necessary.
   *
   * @returns The open connection.
   * @throws {StudioError} With code `CONNECTION_FAILED` when the server cannot be reached.
   */
  async get(): Promise<Connection> {
    if (this.connection && this.connection.readyState === 1) {
      return this.connection;
    }

    if (!this.connectionPromise) {
      const uri = this.config.uri;

      this.connectionPromise = (async () => {
        const connection = createConnection(uri, {
          dbName: this.config.database,
          serverSelectionTimeoutMS: 5_000,
          connectTimeoutMS: 5_000,
          maxPoolSize: 10,
        });

        try {
          await connection.asPromise();
        } catch (error) {
          connection.close().catch(() => undefined);
          this.connectionPromise = undefined;

          throw new StudioError(
            "CONNECTION_FAILED",
            `could not reach the database: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        this.connection = connection;

        return connection;
      })();
    }

    return this.connectionPromise;
  }

  /**
   * Closes the cached connection.
   *
   * @returns Nothing.
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
    }

    this.connection = undefined;
    this.connectionPromise = undefined;
  }
}

let defaultManager: ConnectionManager | undefined;

/**
 * Returns a cached connection manager for the current environment.
 *
 * @returns A connection manager.
 */
export function getConnectionManager(config: StudioConfig = configFromEnv()): ConnectionManager {
  if (!defaultManager) {
    defaultManager = new ConnectionManager(config);
  }

  return defaultManager;
}

/**
 * Returns the cached connection.
 *
 * @param config - The settings of the studio.
 * @returns The open connection.
 */
export async function getConnection(config: StudioConfig = configFromEnv()): Promise<Connection> {
  return getConnectionManager(config).get();
}

/**
 * Reads the overview data the dashboard shows.
 *
 * @param connection - The open connection.
 * @param config - The settings of the studio.
 * @returns The overview data.
 */
export async function getOverview(
  connection: Connection,
  config: StudioConfig,
): Promise<StudioOverview> {
  const db = requireDatabase(connection);

  let version = "unknown";

  try {
    const info = (await db.command({ buildInfo: 1 })) as { version?: string };

    version = info.version ?? version;
  } catch {
    version = "unknown";
  }

  const collections = await listCollections(db, config);
  const collectionsCount = collections.filter((item) => item.type === "collection").length;
  const viewsCount = collections.filter((item) => item.type === "view").length;
  const documentsCount = collections.reduce((sum, item) => item.documents + sum, 0);
  const indexesCount = collections.reduce((sum, item) => item.indexes + sum, 0);
  const storageBytes = collections.reduce((sum, item) => item.sizeBytes + sum, 0);

  const migrations = await getMigrationOverview(connection, config).catch((error) => ({
    configured: false,
    files: [],
    contracts: [],
    error: error instanceof Error ? error.message : String(error),
  }));

  return {
    database: config.database,
    readOnly: config.readOnly,
    uriDisplay: maskSafeUri(config.uri),
    serverVersion: version,
    collectionsCount,
    viewsCount,
    documentsCount,
    indexesCount,
    storageBytes,
    collections: collections.slice(0, 8),
    migrations,
  };
}

function requireDatabase(connection: Connection): mongo.Db {
  if (!connection.db || connection.readyState !== 1) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return connection.db;
}

function maskSafeUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;

    return `${parsed.protocol}//${parsed.host}${path}`.replace(/\/\/[^@]+@/, "//***@");
  } catch {
    return "an invalid connection string";
  }
}
