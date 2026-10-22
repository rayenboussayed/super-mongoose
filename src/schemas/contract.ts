import { z } from "zod";

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
  "up", // create if not exists
  "down", // delete it if exists
  "ignore", // legacy , keep it and ignore it
]);

export const MigrationIndexContract = z.object({
  name: z.string().optional(),
  status: MigrationStatusContract,
  fields: z.record(z.string(), IndexDirection),
  unique: z.boolean().optional(),
  sparse: z.boolean().optional(),
  expireAfterSeconds: z.number().int().nonnegative().optional(),
  partialFilterExpression: z.record(z.string(), z.unknown()).optional(),
});

export const MigrationModelFieldContract = z.object({
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
  ref: z.string().optional(),

  // String
  enum: z.array(z.union([z.string(), z.number()])).optional(),
  match: z.string().optional(), // regex source
  trim: z.boolean().optional(),
  lowercase: z.boolean().optional(),
  uppercase: z.boolean().optional(),
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),

  // Number / Date
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),

  // Array / Map element type
  get of() {
    return MigrationModelFieldContract.optional();
  },

  // Subdocument shape
  get fields() {
    return z.record(z.string(), MigrationModelFieldContract).optional();
  },
});

export const MigrationModelContract = z.object({
  name: z.string(),
  collection: z.string().optional(),
  fields: z.record(z.string(), MigrationModelFieldContract),
  indexes: z.array(MigrationIndexContract).default([]),
  options: z
    .object({
      timestamps: z.boolean().default(true),
      versionKey: z.union([z.string(), z.literal(false)]).optional(),
      strict: z.union([z.boolean(), z.literal("throw")]).optional(),
      _id: z.boolean().optional(),
      discriminatorKey: z.string().optional(),
    })
    .default({ timestamps: true }),
});

export const MigrationContract = z.object({
  version: z.string(),
  description: z.string().optional(),
  models: z.record(z.string(), MigrationModelContract),
});
