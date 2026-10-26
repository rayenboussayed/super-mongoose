import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { Connection } from "mongoose";

/** The connection string of the MongoDB the tests write to. */
export const TEST_URI = process.env.SUPER_MONGOOSE_TEST_URI ?? "mongodb://127.0.0.1:27018";

/** Marker every document a test creates carries. */
export const TEST_MARKER = "cmb-0000-test";

/** The run the tests belong to, it keeps the databases of two runs apart. */
export const RUN_ID = randomUUID().slice(0, 8);

/**
 * The name of the database a test writes to.
 *
 * @param name - The name of the test.
 * @returns The name of the database.
 */
export function databaseName(name: string): string {
  return `super_mongoose_test_${RUN_ID}_${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
}

/**
 * Opens a connection to a database of the test MongoDB.
 *
 * @param name - The name of the database.
 * @returns The open connection.
 */
export async function connectTo(name: string): Promise<Connection> {
  const connection = mongoose.createConnection(TEST_URI, { dbName: name });

  await connection.asPromise();

  return connection;
}

/**
 * Removes a database of the test MongoDB and closes the connection to it.
 *
 * @param connection - The connection to the database.
 * @returns Nothing.
 */
export async function dropDatabase(connection: Connection): Promise<void> {
  await connection.dropDatabase();
  await connection.close();
}

/**
 * The marker a test puts on the documents it creates.
 *
 * @param name - The name of the test.
 * @returns The marker.
 */
export function markerOf(name: string): string {
  return `${TEST_MARKER}-${RUN_ID}-${name}`;
}
