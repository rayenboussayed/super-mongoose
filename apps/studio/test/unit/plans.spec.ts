import { describe, expect, it } from "vitest";
import { analyzeExplain, suggestIndex } from "../../src/server/plans";

describe("query plans", () => {
  it("marks a collscan", () => {
    const summary = analyzeExplain({
      queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
      executionStats: { totalDocsExamined: 10, nReturned: 1 },
    });

    expect(summary.stage).toBe("COLLSCAN");
    expect(summary.usesIndex).toBe(false);
  });

  it("reads an index name", () => {
    const summary = analyzeExplain({
      queryPlanner: { winningPlan: { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "status_1" } } },
      executionStats: { totalKeysExamined: 2, totalDocsExamined: 2, nReturned: 2, executionTimeMillis: 1 },
    });

    expect(summary.indexName).toBe("status_1");
    expect(summary.usesIndex).toBe(true);
  });

  it("suggests equality, sort, range", () => {
    const suggestion = suggestIndex({ status: "active", createdAt: { $gt: 1 } }, { name: -1 });

    expect(Object.keys(suggestion?.keys ?? {})).toEqual(["status", "name", "createdAt"]);
  });
});
