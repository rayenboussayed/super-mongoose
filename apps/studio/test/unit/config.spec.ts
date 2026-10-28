import { describe, expect, it } from "vitest";
import { configFromEnv, maskUri } from "../../src/server/config";

describe("studio config", () => {
  it("reads defaults", () => {
    expect(configFromEnv({})).toMatchObject({
      uri: "mongodb://127.0.0.1:27018",
      database: "super_mongoose_studio",
      readOnly: false,
    });
  });

  it("reads read only flag", () => {
    expect(configFromEnv({ STUDIO_READ_ONLY: "1" }).readOnly).toBe(true);
  });

  it("masks credentials", () => {
    expect(maskUri("mongodb://user:pass@host/db")).not.toContain("pass");
  });

  it("handles invalid values", () => {
    expect(configFromEnv({ STUDIO_MAX_PAGE_SIZE: "5" }).maxPageSize).toBe(5);
    expect(maskUri("not uri")).toBe("an invalid connection string");
    expect(configFromEnv({ MONGO_URL: "not://uri" }).database).toBe("super_mongoose_studio");
  });
});
