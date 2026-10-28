import { EJSON } from "bson";
import { StudioError } from "./result";

/** Largest JSON body the studio accepts, in bytes. */
export const MAX_JSON_BYTES = 512 * 1024;

/**
 * Parses an EJSON document and refuses anything that is not a plain object.
 *
 * @param text - The EJSON text.
 * @param label - The name of the value, used in messages.
 * @returns The parsed object.
 * @throws {StudioError} With code `INVALID_INPUT` when the text is not an object.
 */
export function parseObjectText(text: string, label: string): Record<string, unknown> {
  const value = parseEjson(text, label);

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StudioError("INVALID_INPUT", `${label} needs a JSON object`);
  }

  return value as Record<string, unknown>;
}

/**
 * Parses EJSON text, including extended values such as ObjectId and Date.
 *
 * @param text - The EJSON text.
 * @param label - The name of the value, used in messages.
 * @returns The parsed value.
 * @throws {StudioError} With code `INVALID_INPUT` when the text is too large or invalid.
 */
export function parseEjson(text: string, label: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) {
    throw new StudioError("INVALID_INPUT", `${label} is larger than ${MAX_JSON_BYTES} bytes`);
  }

  try {
    return EJSON.parse(text, { relaxed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new StudioError("INVALID_INPUT", `${label} is not valid EJSON: ${message}`);
  }
}

/**
 * Turns a BSON value into EJSON text the browser can display and send back.
 *
 * @param value - The value to write.
 * @param pretty - Whether to indent the output.
 * @returns The EJSON text.
 */
export function stringifyEjson(value: unknown, pretty = true): string {
  return EJSON.stringify(value, undefined, pretty ? 2 : undefined, { relaxed: false });
}

/**
 * Reads the text of an identifier.
 *
 * @param value - The identifier value.
 * @returns The EJSON text of the value.
 */
export function idText(value: unknown): string {
  return stringifyEjson(value, false);
}

/**
 * Parses the text of an identifier.
 *
 * @param text - The EJSON text.
 * @returns The identifier value.
 * @throws {StudioError} With code `INVALID_INPUT` when the text is invalid.
 */
export function parseId(text: string): unknown {
  return parseEjson(text, "the identifier");
}

/**
 * Builds a short preview of a document for a table cell.
 *
 * @param document - The document to summarise.
 * @param maximum - The maximum length of the preview.
 * @returns The preview text.
 */
export function documentPreview(document: Record<string, unknown>, maximum = 180): string {
  const entries = Object.entries(document).filter(([key]) => key !== "_id");
  const parts = entries.slice(0, 6).map(([key, value]) => {
    const text = EJSON.stringify(value, { relaxed: true });

    return `${key}: ${text}`;
  });
  const preview = parts.join(", ");
  const suffix = entries.length > 6 ? ", ..." : "";

  if (preview.length + suffix.length <= maximum) {
    return preview + suffix;
  }

  return `${preview.slice(0, Math.max(0, maximum - suffix.length - 3))}...${suffix}`;
}

/**
 * The view of one document the browser receives.
 */
export interface DocumentView {
  /** EJSON text of the identifier. */
  id: string;
  /** EJSON text of the whole document. */
  json: string;
  /** Short text for a table cell. */
  preview: string;
}

/**
 * Converts a stored document into the view the browser receives.
 *
 * @param document - The document.
 * @returns The view of the document.
 */
export function toDocumentView(document: Record<string, unknown>): DocumentView {
  return {
    id: idText(document._id),
    json: stringifyEjson(document),
    preview: documentPreview(document),
  };
}
