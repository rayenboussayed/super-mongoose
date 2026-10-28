import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { TEST_URI, databaseName } from "../helpers/database";

const run = promisify(execFile);

const ROOT = process.cwd();
const CLI = join(ROOT, "dist", "cli.js");

const CONTRACTS = `export default [
  {
    version: "001",
    models: {
      Driver: {
        name: "Driver",
        collection: "drivers",
        fields: {
          firstName: { type: "String", status: "up", required: true },
          age: { type: "Number", status: "up" },
        },
        indexes: [{ status: "up", fields: { firstName: 1 }, name: "firstName_1" }],
      },
    },
  },
];
`;

describe("the migration cli against a real MongoDB", () => {
  let directory: string;
  let contractsFile: string;
  let database: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "super-mongoose-cli-"));
    contractsFile = join(directory, "contracts.mjs");
    database = databaseName("cli");
    await writeFile(contractsFile, CONTRACTS, "utf8");
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });

    const connection = mongoose.createConnection(TEST_URI, { dbName: database });

    await connection.asPromise();
    await connection.dropDatabase();
    await connection.close();
  });

  it("prints the difference between the contract and the database", async () => {
    const { stdout } = await runCli(["migrate", "plan"]);

    expect(stdout).toMatch(/createCollection drivers/);
    expect(stdout).toMatch(/createIndex drivers/);
  });

  it("applies the contract and records the version", async () => {
    const { stdout } = await runCli(["migrate", "up"]);

    expect(stdout).toMatch(/applied 1 versions/);

    const connection = mongoose.createConnection(TEST_URI, { dbName: database });

    await connection.asPromise();

    const rows = await connection.db!.collection("__migrations").find({}).toArray();
    const indexes = await connection.db!.collection("drivers").listIndexes().toArray();

    expect(rows.map((row) => row.version)).toEqual(["001"]);
    expect(indexes.map((index) => index.name)).toContain("firstName_1");

    await connection.close();
  });

  it("prints the applied versions", async () => {
    const { stdout } = await runCli(["migrate", "status"]);

    expect(stdout).toMatch(/applied 001/);
    expect(stdout).toMatch(/0 operations to apply/);
  });

  it("applies nothing on a second run", async () => {
    const { stdout } = await runCli(["migrate", "up"]);

    expect(stdout).toMatch(/applied 0 versions, 1 were already applied/);
  });

  it("fails when the file of the contracts does not exist", async () => {
    const result = await runCli(["migrate", "plan"], join(directory, "missing.mjs"));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/could not be loaded/);
  });

  it("fails when there is no command", async () => {
    const result = await runCli(["migrate"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Usage: super-mongoose/);
  });

  async function runCli(args: string[], file: string = contractsFile) {
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        [CLI, ...args, "--file", file, "--database", database],
        {
          cwd: ROOT,
          env: { ...process.env, MONGO_URL: TEST_URI, MONGODB_URI: "" },
        },
      );

      return { code: 0, stdout, stderr };
    } catch (error) {
      const failure = error as { code?: number; stdout: string; stderr: string };

      return { code: failure.code ?? 1, stdout: failure.stdout, stderr: failure.stderr };
    }
  }
});
