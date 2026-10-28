import mongoose from "mongoose";
const URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27018";
const DATABASE = process.env.MONGO_DB || "super_mongoose_studio_e2e";
export default async function globalTeardown(): Promise<void> {
  const connection = await mongoose.createConnection(URL).asPromise();
  const database = connection.useDb(DATABASE);
  await database.dropDatabase();
  await connection.close();
}
