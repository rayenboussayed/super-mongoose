import mongoose from "mongoose";
import type { Connection, Model } from "mongoose";
import { buildSchema } from "./schema";
import { compileModelContract } from "../internal/definition";
import { MigrationError } from "../errors";
import type { MigrationModelContractInput } from "../schemas/contract";

/**
 * Registers a Mongoose model built from a migration contract.
 *
 * The model is registered on the given connection, so an application can use
 * it exactly like a hand written model. The collection is the one declared by
 * the contract, or the model name when the contract does not declare one.
 * The schema has `autoIndex` off, the migration runner owns the indexes.
 *
 * The document type is a parameter, because the fields of a contract are
 * declared at runtime and the compiler cannot read them. An application that
 * already declares an interface for its documents passes it as `TDoc`.
 *
 * @param contract - The model contract to compile.
 * @param connection - The connection to register the model on, the default connection when omitted.
 * @returns The registered model.
 * @throws {import("zod").ZodError} When the contract does not match the migration schema.
 * @throws {MigrationError} With code `CONFLICT` when the connection already holds a model of the same name on another collection.
 *
 * @example
 * ```ts
 * const Driver = defineModel<{ firstName: string }>({
 *   name: "Driver",
 *   collection: "drivers",
 *   fields: { firstName: { type: "String", status: "up", required: true } },
 * });
 * ```
 */
export function defineModel<TDoc = Record<string, unknown>>(
  contract: MigrationModelContractInput,
  connection: Connection = mongoose.connection,
): Model<TDoc> {
  const definition = compileModelContract(contract);
  const existing = connection.models[definition.name];

  if (existing) {
    const collection = existing.collection?.name ?? existing.collection?.collectionName;

    if (collection !== undefined && collection !== definition.collection) {
      throw new MigrationError(
        "CONFLICT",
        `the connection already holds a model named "${definition.name}" on the collection "${collection}"`,
        { context: { model: definition.name, collection } },
      );
    }

    return existing as Model<TDoc>;
  }

  const model = connection.model(definition.name, buildSchema(definition), definition.collection);

  return model as unknown as Model<TDoc>;
}
