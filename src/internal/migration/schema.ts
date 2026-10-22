import { model, Schema } from "mongoose"

export const MIGRATION_COLLECTION = "__migrations"

const MigrationSchema = new Schema({
    schema: {
        type: Object,
        required: true
    }
}, { autoCreate: true, timestamps: true })

export default model(MIGRATION_COLLECTION, MigrationSchema)