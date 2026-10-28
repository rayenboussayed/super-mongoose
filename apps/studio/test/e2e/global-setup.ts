import mongoose from "mongoose";
const URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27018";
const DATABASE = process.env.MONGO_DB || "super_mongoose_studio_e2e";
export default async function globalSetup(): Promise<void> {
  const connection = await mongoose.createConnection(URL).asPromise();
  const database = connection.useDb(DATABASE);
  await database.dropDatabase();
  await database.collection("drivers").insertMany([
    { name: "Ade Test", status: "active", createdAt: new Date("2026-01-01T00:00:00.000Z"), email: "e2e-test-a@example.com" },
    { name: "Bea Test", status: "suspended", createdAt: new Date("2026-01-02T00:00:00.000Z"), email: "e2e-test-b@example.com" },
  ]);
  await database.collection("vehicles").insertMany([{ plate: "ABC-123", capacity: 4 }]);
  await connection.close();
}
