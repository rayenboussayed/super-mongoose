import type { IndexDirectionValue } from "../schemas/contract";
import type { IndexDefinition, ModelDefinition } from "../internal/definition";
import { isSameIndexKey } from "../internal/definition";
import type { IndexOptions } from "../internal/mongo/state";
import { isSameIndexOptions, toIndexOptions } from "../internal/mongo/state";
import type { CollectionState, LiveIndex } from "../internal/mongo/state";
import { buildValidator, isSameValidator, mergeIgnoredFields } from "../internal/mongo/validator";
import type { MongoDocument } from "../internal/mongo/validator";

/** A change the runner has to apply to reach the declared state. */
export type MigrationOperation =
  | { type: "createCollection"; collection: string; validator: MongoDocument }
  | { type: "setValidator"; collection: string; validator: MongoDocument }
  | {
      type: "createIndex";
      collection: string;
      name: string;
      key: Record<string, IndexDirectionValue>;
      options: IndexOptions;
    }
  | { type: "dropIndex"; collection: string; name: string };

/** What the runner has to do for one model. */
export interface ModelPlan {
  /** Name of the model. */
  model: string;
  /** Collection of the model. */
  collection: string;
  /** Operations that reach the declared state. */
  operations: MigrationOperation[];
  /** Differences that need no operation but deserve a mention. */
  advisories: string[];
  /** Differences the runner refuses to resolve on its own. */
  conflicts: string[];
}

/** The level and the action of the validator of a collection. */
export interface ValidationSettings {
  /** When the validator applies, "moderate" by default. */
  level: "strict" | "moderate";
  /** What the server does with a document the validator refuses. */
  action: "error" | "warn";
}

/**
 * Compares the declared state of a model with the live state of its
 * collection and returns the operations that close the difference.
 *
 * The comparison never removes an index the contract does not mention, an
 * index can be shared with another service. Only an index the contract marks
 * as "down" is dropped, and an index that exists with another name is left
 * alone as well.
 *
 * @param definition - The declared state of the model.
 * @param state - The live state of the collection.
 * @param validation - The level and the action the runner writes.
 * @returns The plan of the model.
 */
export function planModel(
  definition: ModelDefinition,
  state: CollectionState,
  validation: ValidationSettings = { level: "moderate", action: "warn" },
): ModelPlan {
  const { validator: desired, advisories, ignoredPaths } = buildValidator(definition);
  const operations: MigrationOperation[] = [];
  const conflicts: string[] = [];
  const notes = [...advisories];

  if (!state.exists) {
    operations.push({ type: "createCollection", collection: definition.collection, validator: desired });
  } else {
    const validator = mergeIgnoredFields(state.validator, desired, ignoredPaths);

    if (!isSameValidator(state.validator, validator) || state.validation?.level !== validation.level) {
      operations.push({ type: "setValidator", collection: definition.collection, validator });
    }
  }

  const liveByName = new Map(state.indexes.map((index) => [index.name, index]));
  const declared = definition.indexes;

  for (const index of declared.filter((candidate) => candidate.status === "up")) {
    const live = liveByName.get(index.name);

    if (live) {
      if (!coversSameFields(live, index) || !isSameIndexOptions(live, index)) {
        conflicts.push(
          `index "${index.name}" exists with another definition, drop it and run the migration again`,
        );
      } else if (live.hidden) {
        notes.push(`index "${index.name}" is hidden from the query planner`);
      }

      continue;
    }

    const sameKey = state.indexes.find((candidate) => coversSameFields(candidate, index));

    if (sameKey) {
      if (!isSameIndexOptions(sameKey, index)) {
        conflicts.push(
          `index "${index.name}" exists as "${sameKey.name}" with another definition, drop it and run the migration again`,
        );
      } else {
        notes.push(`index "${index.name}" already exists as "${sameKey.name}" and was left alone`);
      }

      continue;
    }

    operations.push({
      type: "createIndex",
      collection: definition.collection,
      name: index.name,
      key: index.key,
      options: toIndexOptions(index),
    });
  }

  for (const index of declared.filter((candidate) => candidate.status === "down")) {
    const live = liveByName.get(index.name);

    if (!live) {
      continue;
    }

    if (!coversSameFields(live, index)) {
      conflicts.push(
        `index "${index.name}" exists with another definition, the runner does not drop it`,
      );

      continue;
    }

    operations.push({ type: "dropIndex", collection: definition.collection, name: index.name });
  }

  const managedNames = new Set(
    declared.filter((index) => index.status !== "ignore").map((index) => index.name),
  );

  for (const index of state.indexes) {
    if (index.name !== "_id_" && !managedNames.has(index.name)) {
      notes.push(`index "${index.name}" of "${definition.collection}" is not owned by the contract`);
    }
  }

  for (const field of Object.values(definition.fields)) {
    if (field.status === "down") {
      notes.push(`field "${field.name}" left the model, the stored documents keep their value`);
    }
  }

  return {
    model: definition.name,
    collection: definition.collection,
    operations,
    advisories: notes,
    conflicts,
  };
}

/**
 * Tells whether a live index covers the same fields as a declared one.
 *
 * The server reports a text index with the fields `_fts` and `_ftsx`, the
 * fields the contract names are read from the weights of the live index.
 *
 * @param live - The index that exists in the database.
 * @param declared - The declared index.
 * @returns True when both indexes cover the same fields.
 */
function coversSameFields(live: LiveIndex, declared: IndexDefinition): boolean {
  if (live.key._fts === "text") {
    const liveFields = Object.keys(live.weights ?? {}).sort();
    const declaredFields = Object.entries(declared.key)
      .filter(([, direction]) => direction === "text")
      .map(([field]) => field)
      .sort();

    return liveFields.join(",") === declaredFields.join(",");
  }

  return isSameIndexKey(live.key, declared.key);
}
