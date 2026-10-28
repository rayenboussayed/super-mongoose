import { createServerFn } from "@tanstack/react-start";

import { capture } from "./result";
import { StudioError } from "./result";
import { configFromEnv } from "./config";
import { getConnection } from "./overview";
import { listCollections, getCollection, createCollection } from "./collections";
import {
  listDocuments,
  getDocument as getOneDocument,
  createDocument,
  replaceDocument,
  deleteDocument,
} from "./documents";
import { listIndexes } from "./collections";
import { createIndex, dropIndex } from "./indexes";
import { explainQuery } from "./plans";
import { getMigrationOverview, applyMigrations } from "./migrations";
import { getOverview } from "./overview";
import {
  parseListDocumentsInput,
  parseSaveDocumentInput,
  parseDeleteDocumentInput,
  parseCreateCollectionInput,
  parseCreateIndexInput,
  parseDropIndexInput,
  parseExplainInput,
} from "./inputs";
import { assertWritable } from "./guards";
import { parseObjectText } from "./ejson";
import type { ExplainInput } from "./plans";

export const getOverviewFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { connection, config } = await dbChecks();
  return capture(async () => getOverview(connection, config));
});

export const listCollectionsFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { connection, config } = await dbChecks();

  return capture(async () => {
    const db = connection.db;

    if (!db) {
      throw new StudioError("CONNECTION_FAILED", "the connection is not open");
    }

    return listCollections(db, config);
  });
});

export const getCollectionFn = createServerFn({
  method: "GET",
}).validator((input: unknown) => {
  if (typeof input !== "string") {
    throw new StudioError("INVALID_INPUT", "a collection name is required");
  }

  return input;
})
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => getCollection(db, ctx.data, config));
});

export const createCollectionFn = createServerFn({
  method: "POST",
}).validator(parseCreateCollectionInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  void config;
  assertWritable(config);

  const validator =
    ctx.data.validator && ctx.data.validator.trim().length > 0
      ? parseObjectText(ctx.data.validator, "the validator")
      : undefined;

  return capture(async () => createCollection(db, ctx.data.name, validator, config));
});

export const listDocumentsFn = createServerFn({
  method: "GET",
}).validator(parseListDocumentsInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => listDocuments(db, ctx.data, config));
});

export const getDocumentFn = createServerFn({
  method: "GET",
}).validator((input: unknown) => {
  const value = parseSaveDocumentInput(input);

  if (value.id === undefined) {
    throw new StudioError("INVALID_INPUT", "an identifier is required");
  }

  return { collection: value.collection, id: value.id };
})
.handler(async (ctx) => {
  const { connection } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => getOneDocument(db, ctx.data.collection, ctx.data.id));
});

export const saveDocumentFn = createServerFn({
  method: "POST",
}).validator(parseSaveDocumentInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => {
    if (ctx.data.id) {
      return replaceDocument(db, ctx.data.collection, ctx.data.id, ctx.data.document, config);
    }

    return createDocument(db, ctx.data.collection, ctx.data.document, config);
  });
});

export const deleteDocumentFn = createServerFn({
  method: "POST",
}).validator(parseDeleteDocumentInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => {
    await deleteDocument(db, ctx.data.collection, ctx.data.id, config);

    return { deleted: true };
  });
});

export const getCollectionIndexesFn = createServerFn({
  method: "GET",
}).validator((input: unknown) => {
  if (typeof input !== "string") {
    throw new StudioError("INVALID_INPUT", "a collection name is required");
  }

  return input;
})
.handler(async (ctx) => {
  const { connection } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => listIndexes(db, ctx.data));
});

export const createIndexFn = createServerFn({
  method: "POST",
}).validator(parseCreateIndexInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () =>
    createIndex(
      db,
      {
        collection: ctx.data.collection,
        keys: ctx.data.keys,
        name: ctx.data.name,
        unique: ctx.data.unique,
        sparse: ctx.data.sparse,
        expireAfterSeconds: ctx.data.expireAfterSeconds,
        partialFilterExpression: ctx.data.partialFilterExpression,
        hidden: ctx.data.hidden,
      },
      config,
    ),
  );
});

export const dropIndexFn = createServerFn({
  method: "POST",
}).validator(parseDropIndexInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () => dropIndex(db, ctx.data.collection, ctx.data.name, config));
});

export const explainQueryFn = createServerFn({
  method: "POST",
}).validator(parseExplainInput)
.handler(async (ctx) => {
  const { connection, config } = await dbChecks();
  const db = connection.db;

  if (!db) {
    throw new StudioError("CONNECTION_FAILED", "the connection is not open");
  }

  return capture(async () =>
    explainQuery(db, ctx.data as ExplainInput, config),
  );
});

export const getMigrationsFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const { connection, config } = await dbChecks();
  return capture(async () => getMigrationOverview(connection, config));
});

export const applyMigrationsFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const { connection, config } = await dbChecks();
  assertWritable(config);
  return capture(async () => applyMigrations(connection, config));
});

async function dbChecks(): Promise<{ config: import("./config").StudioConfig; connection: import("mongoose").Connection }> {
  const config = configFromEnv();
  const connection = await getConnection(config);
  return { config, connection };
}
