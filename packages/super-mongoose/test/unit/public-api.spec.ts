import { describe, expect, it } from "vitest";
import * as publicApi from "../../src/index";

describe("the public api of the package", () => {
  it("exports the contract schemas", () => {
    expect(typeof publicApi.MigrationContract.parse).toBe("function");
    expect(typeof publicApi.MigrationModelContract.parse).toBe("function");
    expect(typeof publicApi.MigrationModelFieldContract.parse).toBe("function");
    expect(typeof publicApi.MigrationIndexContract.parse).toBe("function");
    expect(typeof publicApi.MigrationStatusContract.parse).toBe("function");
    expect(typeof publicApi.MongooseType.parse).toBe("function");
    expect(typeof publicApi.IndexDirection.parse).toBe("function");
  });

  it("exports the schema builder and the model builder", () => {
    expect(typeof publicApi.Schem.fromContract).toBe("function");
    expect(typeof publicApi.defineModel).toBe("function");
  });

  it("exports the runner", () => {
    expect(typeof publicApi.planMigrations).toBe("function");
    expect(typeof publicApi.runMigrations).toBe("function");
    expect(typeof publicApi.migrationStatus).toBe("function");
  });

  it("exports the error of the layer", () => {
    const error = new publicApi.MigrationError("CONFLICT", "boom");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("boom");
  });
});
