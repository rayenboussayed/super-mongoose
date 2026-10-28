/** Default connection string of the local development database. */
export const DEFAULT_URI = "mongodb://127.0.0.1:27018";

/** Default database the studio opens. */
export const DEFAULT_DATABASE = "super_mongoose_studio";

/** Settings the studio reads once per request. */
export interface StudioConfig {
  /** Connection string of the MongoDB server. */
  uri: string;
  /** Database the studio manages. */
  database: string;
  /** When true every write control is refused. */
  readOnly: boolean;
  /** Absolute or relative path of a contract file or a directory of them. */
  contractsPath?: string;
  /** Largest page the document list serves. */
  maxPageSize: number;
  /** Time budget of a query the studio sends. */
  maxTimeMs: number;
}

function readBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), maximum);
}

function databaseFromUri(uri: string): string | undefined {
  try {
    const parsed = new URL(uri);
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the studio settings from an environment.
 *
 * The database comes from `MONGO_DB`, then from the path of the connection
 * string, then from {@link DEFAULT_DATABASE}. The contracts come from
 * `SUPER_MONGOOSE_CONTRACTS`.
 *
 * @param env - The environment to read.
 * @returns The settings of the studio.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StudioConfig {
  const uri = env.MONGO_URL?.trim() || DEFAULT_URI;
  const database = env.MONGO_DB?.trim() || databaseFromUri(uri) || DEFAULT_DATABASE;
  const contractsPath = env.SUPER_MONGOOSE_CONTRACTS?.trim();

  return {
    uri,
    database,
    readOnly: readBoolean(env.STUDIO_READ_ONLY),
    ...(contractsPath ? { contractsPath } : {}),
    maxPageSize: readInteger(env.STUDIO_MAX_PAGE_SIZE, 100, 500),
    maxTimeMs: readInteger(env.STUDIO_MAX_TIME_MS, 5_000, 60_000),
  };
}

/**
 * Hides the credentials of a connection string.
 *
 * @param uri - The connection string.
 * @returns The connection string with its user and password removed.
 */
export function maskUri(uri: string): string {
  try {
    const parsed = new URL(uri);

    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }

    return parsed.toString();
  } catch {
    return "an invalid connection string";
  }
}
