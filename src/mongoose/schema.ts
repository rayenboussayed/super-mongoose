import { Schema as MongooseSchema } from "mongoose";
import { z } from "zod";
import { MigrationModelContract } from "../schemas/contract";


export class Schem extends MongooseSchema {

    static fromContract(contract: z.infer<typeof MigrationModelContract>) {

    }
}