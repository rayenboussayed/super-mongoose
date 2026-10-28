import { mongo } from "mongoose";
import { StudioError } from "./result";
import type { StudioConfig } from "./config";
import { collectionExists } from "./collections";
import { parseObjectText, stringifyEjson } from "./ejson";
import { assertCollectionName, assertFilter, assertSort } from "./guards";

/** The inputs of a query plan. */
export interface ExplainInput {
  /** The collection the query reads. */
  collection: string;
  /** EJSON filter. */
  filter?: string;
  /** EJSON sort. */
  sort?: string;
  /** Maximum number of documents the query returns. */
  limit?: number;
}

/** The parts of an explain the studio renders above the raw plan. */
export interface PlanSummary {
  /** Top stage of the winning plan. */
  stage: string;
  /** Index the winning plan uses, if any. */
  indexName?: string;
  /** Keys the plan examined. */
  keysExamined: number;
  /** Documents the plan examined. */
  docsExamined: number;
  /** Documents the plan returned. */
  returned: number;
  /** Time of the winning plan in milliseconds. */
  executionTimeMillis: number;
  /** Whether an index served the query. */
  usesIndex: boolean;
  /** Ratio of examined documents to returned documents. */
  examinedPerReturned: number;
  /** Notes about the plan. */
  notes: string[];
  /** Raw explain output as EJSON. */
  raw: string;
}

/** The result of a query plan. */
export interface ExplainResult {
  /** Summary of the winning plan. */
  summary: PlanSummary;
  /** An index the filter suggests, when the studio has a recommendation. */
  recommendation: IndexRecommendation | null;
}

/** The index the studio suggests for a query. */
export interface IndexRecommendation {
  /** Keys of the suggested index. */
  keys: Record<string, 1 | -1>;
  /** Why the index should help. */
  rationale: string;
  /** The keys as a shell style expression. */
  expression: string;
}

/**
 * Runs a query with the execution stats verbosity and summarises the winning
 * plan.
 *
 * @param db - The database.
 * @param input - The collection and the query.
 * @param config - The settings of the studio.
 * @returns The summary of the plan.
 */
export async function explainQuery(
  db: mongo.Db,
  input: ExplainInput,
  config: StudioConfig,
): Promise<ExplainResult> {
  assertCollectionName(input.collection);

  if (!(await collectionExists(db, input.collection))) {
    throw new StudioError("NOT_FOUND", `the collection "${input.collection}" does not exist`);
  }

  const filter = input.filter?.trim() ? parseObjectText(input.filter, "the filter") : {};
  const sort = input.sort?.trim() ? parseObjectText(input.sort, "the sort") : {};

  assertFilter(filter);
  assertSort(sort);

  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 100));

  try {
    const raw = await db.command({
      explain: {
        find: input.collection,
        filter,
        sort,
        limit,
      },
      verbosity: "executionStats",
      maxTimeMS: config.maxTimeMs,
    });

    return {
      summary: analyzeExplain(raw),
      recommendation: suggestIndex(filter, sort),
    };
  } catch (error) {
    if (error instanceof StudioError) {
      throw error;
    }

    throw new StudioError("QUERY_FAILED", `the query plan failed: ${String(error)}`);
  }
}

/**
 * Reads the winning plan out of an explain response.
 *
 * @param explain - The response of the server.
 * @returns The summary of the plan.
 */
export function analyzeExplain(explain: unknown): PlanSummary {
  const root = isRecord(explain) ? explain : {};
  const planner = isRecord(root.queryPlanner) ? root.queryPlanner : {};
  const winning = isRecord(planner.winningPlan) ? planner.winningPlan : {};
  const stats = isRecord(root.executionStats) ? root.executionStats : {};
  const planStage = isRecord(winning.queryPlan) ? winning.queryPlan : winning;
  const stages = collectStages(planStage);
  const leaf = [...stages].reverse().find((stage) => stage !== "SINGLE_SHARD") ?? "UNKNOWN";
  const indexName = findIndexName(planStage);
  const keysExamined = numberOrZero(stats.totalKeysExamined);
  const docsExamined = numberOrZero(stats.totalDocsExamined);
  const returned = numberOrZero(stats.nReturned ?? stats.totalDocsReturned);
  const notes: string[] = [];
  const usesIndex = indexName !== undefined && leaf !== "COLLSCAN";

  if (leaf === "COLLSCAN") {
    notes.push("The planner scans the whole collection. Add an index on the fields the filter uses.");
  }

  if (stages.includes("SORT") || stages.includes("SORT_KEY_GENERATOR")) {
    notes.push("The planner sorts in memory. Extend the index to cover the sort fields.");
  }

  if (returned > 0 && docsExamined > returned * 10) {
    notes.push(`The plan examines ${docsExamined} documents to return ${returned}. The index is not selective enough.`);
  }

  if (indexName) {
    notes.push(`The winning plan uses the index "${indexName}".`);
  }

  return {
    stage: leaf,
    ...(indexName === undefined ? {} : { indexName }),
    keysExamined,
    docsExamined,
    returned,
    executionTimeMillis: numberOrZero(stats.executionTimeMillis),
    usesIndex,
    examinedPerReturned: returned === 0 ? 0 : Math.round((docsExamined / returned) * 100) / 100,
    notes,
    raw: stringifyEjson(explain),
  };
}

/**
 * Suggests a compound index for a filter and a sort, in equality, sort, range
 * order.
 *
 * @param filter - The filter of the query.
 * @param sort - The sort of the query.
 * @returns The suggestion, or null when the query carries no field.
 */
export function suggestIndex(
  filter: Record<string, unknown>,
  sort: Record<string, unknown>,
): IndexRecommendation | null {
  const equality: string[] = [];
  const range: string[] = [];

  for (const [field, value] of Object.entries(filter)) {
    if (field === "$and" || field === "$or" || field === "$nor") {
      continue;
    }

    if (isEqualityValue(value)) {
      equality.push(field);
    } else {
      range.push(field);
    }
  }

  const sortFields = Object.entries(sort)
    .filter(([, direction]) => direction === 1 || direction === -1)
    .map(([field]) => field);

  const keys: Record<string, 1 | -1> = {};

  for (const field of equality) {
    keys[field] = 1;
  }

  for (const field of sortFields) {
    if (keys[field] === undefined) {
      keys[field] = (sort[field] as 1 | -1) ?? 1;
    }
  }

  for (const field of range) {
    if (keys[field] === undefined) {
      keys[field] = 1;
    }
  }

  if (Object.keys(keys).length === 0) {
    return null;
  }

  const ordered = orderKeys(keys, equality, sortFields, range);
  const expression = `{ ${Object.entries(ordered)
    .map(([field, direction]) => `${field}: ${direction}`)
    .join(", ")} }`;

  return {
    keys: ordered,
    rationale:
      "Equality fields lead, the sort follows, and the range fields close the key so the planner can walk one index.",
    expression,
  };
}

function orderKeys(
  keys: Record<string, 1 | -1>,
  equality: string[],
  sortFields: string[],
  range: string[],
): Record<string, 1 | -1> {
  const ordered: Record<string, 1 | -1> = {};

  for (const field of [...equality, ...sortFields, ...range]) {
    if (ordered[field] === undefined && keys[field] !== undefined) {
      ordered[field] = keys[field];
    }
  }

  for (const [field, direction] of Object.entries(keys)) {
    if (ordered[field] === undefined) {
      ordered[field] = direction;
    }
  }

  return ordered;
}

function isEqualityValue(value: unknown): boolean {
  if (!isRecord(value)) {
    return true;
  }

  const operators = Object.keys(value);

  if (operators.length === 0 || operators.some((operator) => !operator.startsWith("$"))) {
    return true;
  }

  return operators.every((operator) =>
    ["$eq", "$in", "$exists", "$type", "$all", "$size"].includes(operator),
  );
}

function collectStages(plan: unknown): string[] {
  if (!isRecord(plan)) {
    return [];
  }

  const stages: string[] = [];

  if (typeof plan.stage === "string") {
    stages.push(plan.stage);
  }

  if (plan.queryPlan !== undefined) {
    stages.push(...collectStages(plan.queryPlan));
  }

  if (plan.inputStage !== undefined) {
    stages.push(...collectStages(plan.inputStage));
  }

  if (Array.isArray(plan.inputStages)) {
    for (const stage of plan.inputStages) {
      stages.push(...collectStages(stage));
    }
  }

  return stages;
}

function findIndexName(plan: unknown): string | undefined {
  if (!isRecord(plan)) {
    return undefined;
  }

  if (typeof plan.indexName === "string") {
    return plan.indexName;
  }

  for (const key of ["queryPlan", "inputStage"]) {
    const name = findIndexName(plan[key]);

    if (name) {
      return name;
    }
  }

  if (Array.isArray(plan.inputStages)) {
    for (const stage of plan.inputStages) {
      const name = findIndexName(stage);

      if (name) {
        return name;
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
