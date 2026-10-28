import { z } from "zod";

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RESERVED_COLLECTIONS = new Set(["__migrations", "__migrations_lock"]);

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code < 0x20 || code === 0x7f);
  });
}

function isSafeKey(value: string): boolean {
  return (
    value.length > 0 &&
    !RESERVED_KEYS.has(value) &&
    !hasControlCharacter(value)
  );
}

const MigrationVersion = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => /^\S+$/.test(value) && !hasControlCharacter(value), {
    message: "a version needs to be a non empty word without spaces or control characters",
  });

const ModelName = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => isSafeKey(value) && !value.includes("$"), {
    message: "a model name needs to be a safe MongoDB name, without $ or a control character",
  });

const CollectionName = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      isSafeKey(value) &&
      !value.includes("$") &&
      !value.startsWith("system.") &&
      !RESERVED_COLLECTIONS.has(value),
    {
      message:
        "a collection name cannot be empty, start with system., use a name the layer reserves, or contain $ or a control character",
    },
  );

const FieldName = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => isSafeKey(value) && !value.includes(".") && !value.startsWith("$"),
    { message: "a field name cannot be empty, contain a dot or a control character, or start with $" },
  );

const IndexPath = z
  .string()
  .min(1)
  .max(400)
  .refine(
    (value) =>
      isSafeKey(value) &&
      !value.startsWith("$") &&
      value.split(".").every((part) => isSafeKey(part) && !part.startsWith("$")),
    { message: "an index path needs safe, non empty segments without a leading $" },
  );

const IndexName = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      isSafeKey(value) &&
      value !== "*" &&
      value !== "_id_" &&
      new TextEncoder().encode(value).length <= 127,
    {
      message:
        "an index name cannot be the star, the index of the identifier, longer than 127 bytes, or carry a control character",
    },
  );

const FilterKey = z.string().min(1).max(200).refine((value) => isSafeKey(value), {
  message: "a filter needs safe, non empty keys",
});

// z.record drops a __proto__ key while it parses, so the raw keys are checked first.
const PartialFilterExpression = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getOwnPropertyNames(value).every((key) => FilterKey.safeParse(key).success),
  { message: "a filter needs a plain object with safe, non empty keys" },
);

export const MongooseType = z.enum([
  "String",
  "Number",
  "Boolean",
  "Date",
  "ObjectId",
  "Decimal128",
  "Buffer",
  "UUID",
  "BigInt",
  "Mixed",
  "Map",
  "Array",
  "Subdocument",
]);

export const IndexDirection = z.union([
  z.literal(1),
  z.literal(-1),
  z.enum(["text", "2dsphere", "2d", "hashed"]),
]);

export const MigrationStatusContract = z.enum([
  "up", // create it when it does not exist
  "down", // remove it when it exists
  "ignore", // leave the existing element alone
]);

export const MigrationIndexContract = z
  .strictObject({
    name: IndexName.optional(),
    status: MigrationStatusContract,
    fields: z.record(IndexPath, IndexDirection),
    unique: z.boolean().optional(),
    sparse: z.boolean().optional(),
    expireAfterSeconds: z.number().int().nonnegative().max(2147483647).optional(),
    partialFilterExpression: PartialFilterExpression.optional(),
  })
  .superRefine((index, context) => {
    const fields = Object.entries(index.fields);

    if (fields.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: "an index needs at least one field",
      });
    }

    if (index.expireAfterSeconds !== undefined && fields.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["expireAfterSeconds"],
        message: "a ttl index is single field only, the server ignores the option on a compound index",
      });
    }

    const specialTypes = fields.filter(([, direction]) => direction !== 1 && direction !== -1);

    if (index.unique && specialTypes.some(([, direction]) => direction === "hashed")) {
      context.addIssue({
        code: "custom",
        path: ["unique"],
        message: "a hashed index cannot be unique",
      });
    }

    if (
      index.unique &&
      specialTypes.some(([, direction]) => direction === "text" || direction === "2dsphere")
    ) {
      context.addIssue({
        code: "custom",
        path: ["unique"],
        message: "a text or a geospatial index cannot be unique",
      });
    }

    if (index.partialFilterExpression !== undefined && index.sparse === true) {
      context.addIssue({
        code: "custom",
        path: ["partialFilterExpression"],
        message: "a partial index cannot be sparse at the same time",
      });
    }
  });

export const MigrationModelFieldContract = z
  .strictObject({
    type: MongooseType,
    status: MigrationStatusContract,
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    unique: z.boolean().optional(),
    index: z.boolean().optional(),
    sparse: z.boolean().optional(),
    immutable: z.boolean().optional(),
    select: z.boolean().optional(),

    // ObjectId
    ref: z.string().min(1).max(128).optional(),

    // String
    enum: z
      .array(z.union([z.string(), z.number()]))
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        message: "an enum cannot repeat a value",
      })
      .optional(),
    match: z.string().max(1000).optional(), // regex source
    trim: z.boolean().optional(),
    lowercase: z.boolean().optional(),
    uppercase: z.boolean().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),

    // Number / Date
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),

    // Array / Map element type
    get of() {
      return MigrationModelFieldContract.optional();
    },

    // Subdocument shape
    get fields() {
      return z.record(FieldName, MigrationModelFieldContract).optional();
    },
  })
  .superRefine((field, context) => {
    const stringOnly = ["match", "trim", "lowercase", "uppercase", "minLength", "maxLength"];
    const enumTypes = ["String", "Number", "Array"];

    if (field.type !== "String") {
      for (const option of stringOnly) {
        if (field[option as keyof typeof field] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [option],
            message: `the option "${option}" only applies to a String field`,
          });
        }
      }
    }

    if (field.enum !== undefined && !enumTypes.includes(field.type)) {
      context.addIssue({
        code: "custom",
        path: ["enum"],
        message: `the option "enum" does not apply to a ${field.type} field`,
      });
    }

    if (field.type === "Array" && field.enum !== undefined && field.of?.enum !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["enum"],
        message: "set enum either on the Array or on its of field, not on both",
      });
    }

    if (field.of !== undefined && field.type !== "Array" && field.type !== "Map") {
      context.addIssue({
        code: "custom",
        path: ["of"],
        message: `the option "of" only applies to an Array or a Map field`,
      });
    }

    if (field.fields !== undefined && field.type !== "Subdocument") {
      context.addIssue({
        code: "custom",
        path: ["fields"],
        message: `the option "fields" only applies to a Subdocument field`,
      });
    }

    if (field.ref !== undefined && field.type !== "ObjectId") {
      context.addIssue({
        code: "custom",
        path: ["ref"],
        message: `the option "ref" only applies to an ObjectId field`,
      });
    }

    if (field.sparse === true && field.unique !== true && field.index !== true) {
      context.addIssue({
        code: "custom",
        path: ["sparse"],
        message: `the option "sparse" needs "unique" or "index" on the field`,
      });
    }

    if (field.status === "ignore" && (field.unique === true || field.index === true)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: `a field the contract ignores cannot ask for an index`,
      });
    }

    if (field.type === "Number") {
      for (const option of ["min", "max"] as const) {
        if (field[option] !== undefined && typeof field[option] !== "number") {
          context.addIssue({
            code: "custom",
            path: [option],
            message: `the option "${option}" of a Number field needs a number`,
          });
        }
      }
    }

    if (field.type === "Date") {
      for (const option of ["min", "max"] as const) {
        const value = field[option];

        if (value === undefined) {
          continue;
        }

        if (typeof value === "number") {
          continue;
        }

        if (Number.isNaN(new Date(value).getTime())) {
          context.addIssue({
            code: "custom",
            path: [option],
            message: `the option "${option}" of a Date field needs a date`,
          });
        }
      }
    }

    if (field.type !== "Number" && field.type !== "Date") {
      for (const option of ["min", "max"] as const) {
        if (field[option] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [option],
            message: `the option "${option}" only applies to a Number or a Date field`,
          });
        }
      }
    }

    if (field.min !== undefined && field.max !== undefined) {
      const minimum = field.type === "Date" ? new Date(field.min).getTime() : field.min;
      const maximum = field.type === "Date" ? new Date(field.max).getTime() : field.max;

      if (typeof minimum === "number" && typeof maximum === "number" && minimum > maximum) {
        context.addIssue({
          code: "custom",
          path: ["min"],
          message: `"min" cannot be greater than "max"`,
        });
      }
    }

    if (
      field.minLength !== undefined &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["minLength"],
        message: `"minLength" cannot be greater than "maxLength"`,
      });
    }

    if (field.index === false && field.unique === true) {
      context.addIssue({
        code: "custom",
        path: ["index"],
        message: "a field cannot be unique and without an index",
      });
    }
  });

export const MigrationModelContract = z
  .strictObject({
    name: ModelName,
    collection: CollectionName.optional(),
    fields: z.record(FieldName, MigrationModelFieldContract),
    indexes: z.array(MigrationIndexContract).default([]),
    options: z
      .strictObject({
        timestamps: z.boolean().default(true),
        versionKey: z.union([FieldName, z.literal(false)]).optional(),
        strict: z.union([z.boolean(), z.literal("throw")]).optional(),
        _id: z.boolean().optional(),
        discriminatorKey: FieldName.optional(),
      })
      .default({ timestamps: true }),
  });

export const MigrationContract = z
  .strictObject({
    version: MigrationVersion,
    models: z.record(ModelName, MigrationModelContract),
  })
  .superRefine((contract, context) => {
    for (const [name, model] of Object.entries(contract.models)) {
      if (name !== model.name) {
        context.addIssue({
          code: "custom",
          path: ["models", name, "name"],
          message: `the model is stored under "${name}" but declares the name "${model.name}"`,
        });
      }
    }
  });

/** Contract type name, for example "String" or "ObjectId". */
export type MongooseTypeName = z.infer<typeof MongooseType>;

/** Index direction, either 1, -1 or a special index type. */
export type IndexDirectionValue = z.infer<typeof IndexDirection>;

/** Lifecycle of a contract element: "up" creates it, "down" removes it, "ignore" leaves it alone. */
export type MigrationStatus = z.infer<typeof MigrationStatusContract>;

/** A migration contract as it is authored, before the schema defaults are applied. */
export type MigrationContractInput = z.input<typeof MigrationContract>;

/** A migration contract after the schema defaults are applied. */
export type MigrationContractOutput = z.output<typeof MigrationContract>;

/** A model contract as it is authored, before the schema defaults are applied. */
export type MigrationModelContractInput = z.input<typeof MigrationModelContract>;

/** A model contract after the schema defaults are applied. */
export type MigrationModelContractOutput = z.output<typeof MigrationModelContract>;

/** A field contract as it is authored, before the schema defaults are applied. */
export type MigrationModelFieldContractInput = z.input<typeof MigrationModelFieldContract>;

/** A field contract after the schema defaults are applied. */
export type MigrationModelFieldContractOutput = z.output<typeof MigrationModelFieldContract>;

/** An index contract as it is authored, before the schema defaults are applied. */
export type MigrationIndexContractInput = z.input<typeof MigrationIndexContract>;

/** An index contract after the schema defaults are applied. */
export type MigrationIndexContractOutput = z.output<typeof MigrationIndexContract>;
