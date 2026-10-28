import { describe, expect, it } from "vitest";
import { loadContractFiles } from "../../src/server/migrations";
import path from "node:path";

describe("migration loader", () => {
  it("loads a contracts module", async () => {
    const result = await loadContractFiles({
      uri: "mongodb://127.0.0.1",
      database: "x",
      readOnly: false,
      maxPageSize: 25,
      maxTimeMs: 1000,
      contractsPath: path.resolve(process.cwd(), "test/helpers/contracts.mjs"),
    } as never);
    expect(result.files).toEqual(["contracts.mjs"]);
    expect(result.contracts).toHaveLength(1);
  });

});
