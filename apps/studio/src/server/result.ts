/** The reasons a studio call can fail. */
export const STUDIO_ERROR_CODES = [
  "INVALID_INPUT",
  "READ_ONLY",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "CONNECTION_FAILED",
  "QUERY_FAILED",
  "MIGRATION_FAILED",
  "INTERNAL",
] as const;

/** Reason a studio call failed. */
export type StudioErrorCode = (typeof STUDIO_ERROR_CODES)[number];

/** A failure the browser can render. */
export interface StudioFailure {
  /** Stable reason of the failure. */
  code: StudioErrorCode;
  /** Human readable message. */
  message: string;
  /** Extra data, serializable when present. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

/** The result of a studio call, safe to send over the wire. */
export type StudioResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StudioFailure };

/**
 * An error of the studio. The services raise it, the server functions turn it
 * into a {@link StudioResult}.
 */
export class StudioError extends Error {
  readonly code: StudioErrorCode;
  readonly details?: unknown;

  constructor(code: StudioErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "StudioError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Wraps data in a successful result.
 *
 * @param data - The data of the result.
 * @returns The successful result.
 */
export function ok<T>(data: T): StudioResult<T> {
  return { ok: true, data };
}

/**
 * Turns any failure into a result the browser can render.
 *
 * @param error - The failure to convert.
 * @returns The failed result.
 */
export function fail(error: unknown): StudioResult<never> {
  if (error instanceof StudioError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: error.message,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL",
      message: String(error),
    },
  };
}

/**
 * Runs an operation and captures its failure as a result.
 *
 * @param operation - The operation to run.
 * @returns The result of the operation, successful or failed.
 */
export async function capture<T>(operation: () => Promise<T>): Promise<StudioResult<T>> {
  try {
    return ok(await operation());
  } catch (error) {
    return fail(error);
  }
}
