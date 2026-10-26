import { Schema as MongooseSchema } from "mongoose";
import type { SchemaDefinition } from "mongoose";
import { MigrationError } from "../errors";
import { compileModelContract, definedModelOptions } from "../internal/definition";
import type { FieldDefinition, ModelDefinition } from "../internal/definition";
import { toIndexOptions } from "../internal/mongo/state";
import type { MigrationModelContractInput } from "../schemas/contract";

/**
 * A Mongoose schema that can be built from a migration contract.
 *
 * @example
 * ```ts
 * const schema = Schem.fromContract({
 *   name: "Driver",
 *   collection: "drivers",
 *   fields: {
 *     firstName: { type: "String", status: "up", required: true },
 *   },
 * });
 * ```
 */
export class Schem extends MongooseSchema {
  /**
   * Builds a Mongoose schema from a model contract.
   *
   * Fields with status "up" and "ignore" are declared on the schema, fields
   * with status "down" are left out because the field is retired. The indexes
   * of the contract are declared with the same names the migration runner
   * uses in the database, and `autoIndex` is off, so the runner stays the only
   * creator of the indexes. `autoCreate` is off as well, so the collection
   * only appears with the validator the contract declares.
   *
   * @param contract - The model contract to compile.
   * @returns The compiled schema.
   * @throws {import("zod").ZodError} When the contract does not match the migration schema.
   * @throws {MigrationError} With code `CONTRACT_INVALID` when the contract uses a type the installed Mongoose does not have.
   */
  static fromContract(contract: MigrationModelContractInput): Schem {
    return buildSchema(compileModelContract(contract));
  }
}

/**
 * Builds a Mongoose schema from a resolved model definition.
 *
 * @param definition - The resolved model definition.
 * @returns The compiled schema.
 */
export function buildSchema(definition: ModelDefinition): Schem {
  const schema = new Schem(toPathsDefinition(definition.fields), toSchemaOptions(definition));

  for (const index of definition.indexes) {
    if (index.status !== "up") {
      continue;
    }

    schema.index(index.key, toIndexOptions(index));
  }

  return schema;
}

function toPathsDefinition(fields: Record<string, FieldDefinition>): SchemaDefinition {
  const paths: Record<string, unknown> = {};

  for (const field of Object.values(fields)) {
    if (field.status === "down") {
      continue;
    }

    paths[field.name] = toPathDefinition(field);
  }

  return paths as SchemaDefinition;
}

function toPathDefinition(field: FieldDefinition): unknown {
  const definition = toTypeDefinition(field);

  if (field.type === "Array") {
    return { ...definition, type: [elementDefinition(field)] };
  }

  if (field.type === "Map") {
    return { ...definition, type: MongooseSchema.Types.Map, of: elementDefinition(field) };
  }

  if (field.type === "Subdocument") {
    return { ...definition, type: toPathsDefinition(field.children ?? {}) };
  }

  return definition;
}

function toTypeDefinition(field: FieldDefinition): Record<string, unknown> {
  return { type: toMongooseType(field), ...toFieldOptions(field) };
}

function elementDefinition(field: FieldDefinition): unknown {
  if (!field.element) {
    return { type: MongooseSchema.Types.Mixed };
  }

  return toPathDefinition(field.element);
}

function toFieldOptions(field: FieldDefinition): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  if (field.required) {
    options.required = true;
  }

  if (field.default !== undefined) {
    options.default = field.default;
  }

  if (field.enum !== undefined) {
    options.enum = field.enum;
  }

  if (field.type === "String") {
    if (field.match !== undefined) {
      options.match = field.match;
    }

    if (field.trim) {
      options.trim = true;
    }

    if (field.lowercase) {
      options.lowercase = true;
    }

    if (field.uppercase) {
      options.uppercase = true;
    }

    if (field.minLength !== undefined) {
      options.minLength = field.minLength;
    }

    if (field.maxLength !== undefined) {
      options.maxLength = field.maxLength;
    }
  }

  if (field.type === "Number" || field.type === "Date") {
    if (field.min !== undefined) {
      options.min = field.min;
    }

    if (field.max !== undefined) {
      options.max = field.max;
    }
  }

  if (field.ref !== undefined) {
    options.ref = field.ref;
  }

  if (field.immutable) {
    options.immutable = true;
  }

  if (field.select !== undefined) {
    options.select = field.select;
  }

  return options;
}

function toMongooseType(field: FieldDefinition): unknown {
  switch (field.type) {
    case "String":
      return String;
    case "Number":
      return Number;
    case "Boolean":
      return Boolean;
    case "Date":
      return Date;
    case "ObjectId":
      return MongooseSchema.Types.ObjectId;
    case "Decimal128":
      return MongooseSchema.Types.Decimal128;
    case "Buffer":
      return Buffer;
    case "UUID":
      return requireType("UUID", field.name);
    case "BigInt":
      return requireType("BigInt", field.name);
    case "Mixed":
      return MongooseSchema.Types.Mixed;
    case "Array":
    case "Map":
    case "Subdocument":
      return undefined;
  }
}

/**
 * The schema type of the installed Mongoose, when it has it.
 *
 * @param type - The name of the type, "UUID" or "BigInt".
 * @param field - The field that uses the type.
 * @returns The schema type.
 * @throws {MigrationError} With code `CONTRACT_INVALID` when the installed Mongoose does not have the type.
 */
function requireType(type: "UUID" | "BigInt", field: string): unknown {
  const schemaType = (MongooseSchema.Types as Record<string, unknown>)[type];

  if (!schemaType) {
    throw new MigrationError(
      "CONTRACT_INVALID",
      `the installed Mongoose has no ${type} type, the field "${field}" needs a later version of Mongoose`,
      { context: { field, type } },
    );
  }

  return schemaType;
}

function toSchemaOptions(definition: ModelDefinition) {
  return {
    timestamps: definition.options.timestamps,
    collection: definition.collection,
    autoIndex: false,
    autoCreate: false,
    ...definedModelOptions(definition.options),
  };
}
