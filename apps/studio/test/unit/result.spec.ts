import { describe, expect, it } from "vitest";
import { capture, fail, ok } from "../../src/server/result";

describe("studio result", () => {
  it("wraps data", () => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it("fails with StudioError details", async () => {
    const result = await capture(async () => {
      throw new Error("boom");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toBe("boom");
    }
  });

  it("fail wraps errors", () => {
    const result = fail(new (class extends Error {})("nope"));
    expect(result.ok).toBe(false);
  });
});
