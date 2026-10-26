import { afterEach, describe, expect, it, vi } from "vitest";
import { loadContracts, main, readCommand, runCliProcess } from "../../src/cli";
import { MigrationError } from "../../src/errors";

const messages: string[] = [];
const errors: string[] = [];

vi.spyOn(console, "log").mockImplementation((message: unknown) => {
  messages.push(String(message));
});

vi.spyOn(console, "error").mockImplementation((message: unknown) => {
  errors.push(String(message));
});

const planResult = {
  models: [
    {
      model: "Driver",
      collection: "drivers",
      operations: [
        { type: "createCollection", collection: "drivers", validator: {} },
        {
          type: "createIndex",
          collection: "drivers",
          name: "firstName_1",
          key: {},
          options: {},
        },
      ],
      advisories: ["field \"age\" left the model, the stored documents keep their value"],
      conflicts: ["index \"firstName_1\" exists with another definition"],
    },
  ],
};

const statusResult = {
  applied: [{ version: "001", checksum: "abc", appliedAt: new Date("2024-01-01T00:00:00.000Z") }],
  pending: ["002"],
  operations: 2,
  conflicts: ["index \"firstName_1\" exists with another definition"],
};

const runResult = {
  applied: ["001"],
  skipped: ["000"],
  operations: [
    {
      type: "setValidator",
      collection: "drivers",
      outcome: "skipped",
      reason: "the database user has no collMod privilege",
      durationMs: 1,
    },
  ],
  advisories: ["field \"age\" left the model, the stored documents keep their value"],
};

const migratorMock = vi.hoisted(() => ({
  planMigrations: vi.fn(async () => planResult),
  migrationStatus: vi.fn(async () => statusResult),
  runMigrations: vi.fn(async () => runResult),
}));

vi.mock("../../src/migrator", () => migratorMock);

const mongooseMock = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  connection: { readyState: 1, db: {}, models: {} },
}));

vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();

  return {
    ...actual,
    default: {
      ...actual,
      connect: mongooseMock.connect,
      disconnect: mongooseMock.disconnect,
      connection: mongooseMock.connection,
    },
    connect: mongooseMock.connect,
    disconnect: mongooseMock.disconnect,
  };
});

const CONTRACTS = "./test/helpers/array-contracts.mjs";

afterEach(() => {
  messages.length = 0;
  errors.length = 0;
  mongooseMock.connect.mockClear();
  mongooseMock.disconnect.mockClear();
  process.env.MONGO_URL = "mongodb://127.0.0.1:27018";
});

describe("the command of the cli", () => {
  it("reads a command that follows the word migrate", () => {
    expect(readCommand(["migrate", "plan"])).toBe("plan");
    expect(readCommand(["migrate", "up"])).toBe("up");
    expect(readCommand(["migrate", "status"])).toBe("status");
  });

  it("has no command when the arguments hold none", () => {
    expect(readCommand([])).toBeUndefined();
    expect(readCommand(["migrate"])).toBeUndefined();
    expect(readCommand(["plan"])).toBeUndefined();
    expect(readCommand(["migrate", "nonsense"])).toBeUndefined();
  });
});

describe("the cli", () => {
  it("prints the usage when there is no command", async () => {
    const code = await main([]);

    expect(code).toBe(2);
    expect(errors[0]).toMatch(/Usage: super-mongoose/);
  });

  it("prints the usage when a flag is unknown", async () => {
    const code = await main(["migrate", "plan", "--nonsense"]);

    expect(code).toBe(2);
    expect(errors[0]).toMatch(/Unknown option/);
    expect(errors[1]).toMatch(/Usage: super-mongoose/);
  });

  it("asks for the file of the contracts", async () => {
    const code = await main(["migrate", "plan"]);

    expect(code).toBe(2);
    expect(errors[0]).toMatch(/Missing required flag/);
  });

  it("asks for the connection string", async () => {
    const previous = process.env.MONGO_URL;
    delete process.env.MONGO_URL;

    const code = await main(["migrate", "plan", "--file", CONTRACTS]);

    if (previous === undefined) {
      delete process.env.MONGO_URL;
    } else {
      process.env.MONGO_URL = previous;
    }

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/MONGO_URL is required/);
  });

  it("prints the usage when the help is asked for", async () => {
    const code = await main(["--help"]);

    expect(code).toBe(0);
    expect(messages[0]).toMatch(/Usage: super-mongoose/);
  });

  it("reports a file that cannot be loaded", async () => {
    const code = await main(["migrate", "plan", "--file", "/does/not/exist.js"]);

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/could not be loaded/);
  });

  it("reports a file that holds no contracts", async () => {
    const code = await main([
      "migrate",
      "plan",
      "--file",
      "./test/helpers/empty-contracts.mjs",
    ]);

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/does not export an array of contracts/);
  });

  it("reports that the database refused the connection", async () => {
    mongooseMock.connect.mockRejectedValueOnce(new Error("no route to host"));

    const code = await main(["migrate", "plan", "--file", CONTRACTS]);

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/Could not connect to the database/);
  });

  it("prints the difference between the contract and the database", async () => {
    const code = await main(["migrate", "plan", "--file", CONTRACTS]);

    expect(code).toBe(1);
    expect(messages[0]).toBe("createCollection drivers");
    expect(messages[1]).toBe("createIndex drivers firstName_1");
    expect(messages[2]).toMatch(/^advisory: /);
    expect(messages[3]).toMatch(/^conflict: /);
  });

  it("prints the applied versions and the pending ones", async () => {
    const code = await main(["migrate", "status", "--file", CONTRACTS]);

    expect(code).toBe(1);
    expect(messages[0]).toMatch(/^applied 001 2024-01-01T00:00:00.000Z$/);
    expect(messages[1]).toBe("pending 002");
    expect(messages[2]).toBe("2 operations to apply");
    expect(messages[3]).toMatch(/^conflict: /);
  });

  it("prints what the run did", async () => {
    const code = await main(["migrate", "up", "--file", CONTRACTS]);

    expect(code).toBe(0);
    expect(messages[0]).toBe("applied 1 versions, 1 were already applied");
    expect(messages[1]).toBe("applied 001");
    expect(messages[2]).toMatch(/^skipped setValidator drivers: /);
    expect(messages[3]).toMatch(/^advisory: /);
  });

  it("reports a failure of the runner", async () => {
    migratorMock.runMigrations.mockRejectedValueOnce(new Error("boom"));

    const code = await main(["migrate", "up", "--file", CONTRACTS]);

    expect(code).toBe(1);
    expect(errors[0]).toBe("boom");
  });

  it("reports a failure of the runner that carries a code", async () => {
    migratorMock.runMigrations.mockRejectedValueOnce(
      new MigrationError("CONFLICT", "the database does not match the contract"),
    );

    const code = await main(["migrate", "up", "--file", CONTRACTS]);

    expect(code).toBe(1);
    expect(errors[0]).toBe("CONFLICT: the database does not match the contract");
  });

  it("runs on the database the flag names", async () => {
    await main(["migrate", "plan", "--file", CONTRACTS, "--database", "other"]);

    expect(mongooseMock.connect).toHaveBeenCalledWith("mongodb://127.0.0.1:27018", {
      dbName: "other",
    });
  });

  it("sets the exit code of the process when it runs as a program", async () => {
    const previous = process.exitCode;

    await runCliProcess(["migrate", "plan", "--file", CONTRACTS]);

    expect(process.exitCode).toBe(1);

    process.exitCode = previous;
  });
});

describe("the contracts of a file", () => {
  it("reads an array of contracts", async () => {
    const contracts = await loadContracts("./test/helpers/array-contracts.mjs");

    expect(contracts).toHaveLength(1);
    expect(contracts[0].version).toBe("001");
  });
});
