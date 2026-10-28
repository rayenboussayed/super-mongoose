import type { MigrationContractInput, MigrationModelContractInput } from "../../src/schemas/contract";

/** Marker every document a test creates carries, so teardown finds them again. */
export const TEST_MARKER = "cmb-0000-test";

/** The database every staging test writes to, unique per run. */
export const TEST_DATABASE = process.env.SUPER_MONGOOSE_TEST_DATABASE ?? "super_mongoose_test";

/**
 * A model contract with a few field types, used by most tests.
 *
 * @returns The contract.
 */
export function driverContract(): MigrationModelContractInput {
  return {
    name: "Driver",
    collection: "drivers",
    fields: {
      firstName: { type: "String", status: "up", required: true },
      lastName: { type: "String", status: "up" },
      age: { type: "Number", status: "up", min: 18, max: 99 },
      status: { type: "String", status: "up", enum: ["active", "suspended"] },
      createdAt: { type: "Date", status: "up" },
      vehicle: {
        type: "Subdocument",
        status: "up",
        fields: {
          plate: { type: "String", status: "up", required: true },
          seats: { type: "Number", status: "up" },
        },
      },
      tags: {
        type: "Array",
        status: "up",
        of: { type: "String", status: "up" },
      },
      legacyScore: { type: "Number", status: "ignore" },
    },
    indexes: [
      { status: "up", fields: { firstName: 1 }, name: "firstName_1" },
      { status: "up", fields: { status: 1, createdAt: -1 }, name: "status_1_createdAt_-1" },
    ],
  };
}

/**
 * A contract that declares one model.
 *
 * @param version - The version of the contract.
 * @param models - The models of the contract.
 * @returns The contract.
 */
export function contractOf(
  version: string,
  models: Record<string, MigrationModelContractInput>,
): MigrationContractInput {
  return { version, models };
}
