import type { FieldDefinition, ModelDefinition } from "../definition";
import { canonicalJson } from "../definition";
import type { MongooseTypeName } from "../../schemas/contract";

/** A MongoDB document, the shape the driver uses for validators and commands. */
export type MongoDocument = Record<string, unknown>;

const BSON_TYPE_BY_CONTRACT_TYPE: Readonly<Record<MongooseTypeName, string | undefined>> = {
  String: "string",
  Number: "number",
  Boolean: "bool",
  Date: "date",
  ObjectId: "objectId",
  Decimal128: "decimal",
  Buffer: "binData",
  UUID: "binData",
  BigInt: "long",
  Mixed: undefined,
  Map: "object",
  Array: "array",
  Subdocument: "object",
};

/** The validator of a model, with the rules the database cannot enforce. */
export interface BuiltValidator {
  /** The `$jsonSchema` document, ready for `createCollection` or `collMod`. */
  validator: MongoDocument;
  /** Rules the contract declares and the database cannot enforce. */
  advisories: string[];
  /** Paths of the fields the contract leaves to the application. */
  ignoredPaths: string[];
}

/**
 * Builds the MongoDB `$jsonSchema` validator of a model, the closest
 * equivalent MongoDB has to a table definition.
 *
 * Fields with status "up" are validated, fields with status "down" or
 * "ignore" are left out so the database keeps its own rules for them. A
 * field that is not required allows null, like Mongoose does.
 *
 * @param definition - The resolved model definition.
 * @returns The validator, the rules the database cannot enforce and the
 * paths of the fields the contract leaves to the application.
 */
export function buildValidator(definition: ModelDefinition): BuiltValidator {
  const { properties, required } = collectProperties(definition.fields);
  const advisories: string[] = [];

  for (const field of Object.values(definition.fields)) {
    if (field.status !== "up") {
      continue;
    }

    if (field.required && field.default !== undefined) {
      advisories.push(
        `field "${field.name}" has a default, the database does not require it until the documents are backfilled`,
      );
    }

    if (field.type === "Date" && (field.min !== undefined || field.max !== undefined)) {
      advisories.push(
        `field "${field.name}" has a date bound, the database validator cannot enforce it`,
      );
    }
  }

  return {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
    advisories,
    ignoredPaths: collectIgnoredPaths(definition.fields),
  };
}

/**
 * Collects the properties and the required fields of a group of fields.
 *
 * @param fields - The fields to read.
 * @returns The properties and the names of the required fields.
 */
function collectProperties(fields: Record<string, FieldDefinition>): {
  properties: Record<string, MongoDocument>;
  required: string[];
} {
  const properties: Record<string, MongoDocument> = {};
  const required: string[] = [];

  for (const field of Object.values(fields)) {
    if (field.status !== "up") {
      continue;
    }

    properties[field.name] = buildFieldValidator(field);

    if (field.required && field.default === undefined) {
      required.push(field.name);
    }
  }

  return { properties, required };
}

/**
 * Collects the paths of the fields the contract leaves to the application,
 * the paths of the children of a subdocument included.
 *
 * @param fields - The fields to read.
 * @param prefix - The path of the parent of the fields.
 * @returns The paths of the ignored fields.
 */
function collectIgnoredPaths(fields: Record<string, FieldDefinition>, prefix = ""): string[] {
  const paths: string[] = [];

  for (const field of Object.values(fields)) {
    const path = prefix === "" ? field.name : `${prefix}.${field.name}`;

    if (field.status === "ignore") {
      paths.push(path);
      continue;
    }

    if (field.children) {
      paths.push(...collectIgnoredPaths(field.children, path));
    }
  }

  return paths;
}

function buildFieldValidator(field: FieldDefinition): MongoDocument {
  const validator: MongoDocument = {};
  const bsonType = BSON_TYPE_BY_CONTRACT_TYPE[field.type];

  if (bsonType !== undefined) {
    validator.bsonType = field.required ? bsonType : [bsonType, "null"];
  }

  if (field.enum !== undefined && field.type !== "Array") {
    validator.enum = enumRule(field.enum, field.required);
  }

  if (field.type === "String") {
    if (field.match !== undefined) {
      validator.pattern = field.match.source;
    }

    if (field.minLength !== undefined) {
      validator.minLength = field.minLength;
    }

    if (field.maxLength !== undefined) {
      validator.maxLength = field.maxLength;
    }
  }

  if (field.type === "Number") {
    if (typeof field.min === "number") {
      validator.minimum = field.min;
    }

    if (typeof field.max === "number") {
      validator.maximum = field.max;
    }
  }

  if (field.type === "Array") {
    const items = field.element ? buildFieldValidator(field.element) : {};

    if (field.enum !== undefined) {
      items.enum = enumRule(field.enum, field.element?.required ?? false);
    }

    validator.items = items;
  }

  if (field.type === "Map") {
    validator.additionalProperties = field.element ? buildFieldValidator(field.element) : {};
  }

  if (field.type === "Subdocument" && field.children) {
    const { properties, required } = collectProperties(field.children);

    validator.properties = properties;

    if (required.length > 0) {
      validator.required = required;
    }
  }

  return validator;
}

/**
 * The allowed values of a field, with the null the field accepts when it is
 * not required.
 *
 * @param values - The values the contract declares.
 * @param required - Whether the field must be present.
 * @returns The allowed values.
 */
function enumRule(values: (string | number)[], required: boolean): (string | number | null)[] {
  const allowed = required ? [...values] : [...values, null];

  return [...new Set(allowed)];
}

/**
 * Tells whether a live validator and a desired validator describe the same
 * rules, ignoring the key order the server may return.
 *
 * @param live - The validator read from the server.
 * @param desired - The validator built from the contract.
 * @returns True when both validators are equivalent.
 */
export function isSameValidator(
  live: MongoDocument | undefined,
  desired: MongoDocument,
): boolean {
  if (live === undefined) {
    return false;
  }

  return canonicalJson(live.$jsonSchema) === canonicalJson(desired.$jsonSchema);
}

/**
 * Keeps the rules the database already enforces on the fields the contract
 * leaves to the application.
 *
 * A field with status "ignore" is not part of the desired state, but the
 * collection may already carry a rule for it. Replacing the whole validator
 * would drop that rule, so the live rule is carried over, the rule of the
 * children of a subdocument included.
 *
 * @param live - The validator read from the server.
 * @param desired - The validator built from the contract.
 * @param ignoredPaths - Paths of the fields the contract leaves alone.
 * @returns The desired validator, with the live rules of the ignored fields.
 */
export function mergeIgnoredFields(
  live: MongoDocument | undefined,
  desired: MongoDocument,
  ignoredPaths: string[],
): MongoDocument {
  if (live === undefined || ignoredPaths.length === 0) {
    return desired;
  }

  const liveSchema = (live.$jsonSchema ?? {}) as MongoDocument;
  const desiredSchema = (desired.$jsonSchema ?? {}) as MongoDocument;
  const liveProperties = (liveSchema.properties ?? {}) as MongoDocument;
  const desiredProperties = { ...((desiredSchema.properties ?? {}) as MongoDocument) };

  for (const path of ignoredPaths) {
    mergeLiveRule(desiredProperties, liveProperties, path.split("."));
  }

  const required = mergeRequired(
    (liveSchema.required ?? []) as string[],
    (desiredSchema.required ?? []) as string[],
    ignoredPaths,
  );

  return {
    ...desired,
    $jsonSchema: {
      ...desiredSchema,
      properties: desiredProperties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

function mergeLiveRule(
  target: MongoDocument,
  live: MongoDocument,
  segments: string[],
): void {
  const [head, ...rest] = segments;

  if (head === undefined) {
    return;
  }

  if (rest.length === 0) {
    if (live[head] !== undefined) {
      target[head] = live[head];
    }

    return;
  }

  const targetChild = target[head] as MongoDocument | undefined;
  const liveChild = live[head] as MongoDocument | undefined;

  if (targetChild === undefined || liveChild === undefined) {
    return;
  }

  const childTarget = { ...((targetChild.properties ?? {}) as MongoDocument) };

  mergeLiveRule(childTarget, (liveChild.properties ?? {}) as MongoDocument, rest);

  target[head] = { ...targetChild, properties: childTarget };
}

function mergeRequired(live: string[], desired: string[], ignoredPaths: string[]): string[] {
  const ignored = new Set(
    ignoredPaths.filter((path) => !path.includes(".")).map((path) => path.split(".")[0]),
  );

  return [...new Set([...desired, ...live.filter((name) => ignored.has(name))])];
}
