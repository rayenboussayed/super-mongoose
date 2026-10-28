# super-mongoose

A migration layer for Mongoose. A contract declares the state a collection should have, the runner brings the database to that state and records what it applied.

This repository is an npm workspace with two packages.

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/super-mongoose` | `super-mongoose` | The migration library and its CLI |
| `apps/studio` | `@super-mongoose/studio` | A TanStack Start studio for collections, documents, indexes, migrations and query plans |

## Requirements

Node 22.12 or newer, npm 10 or newer, and a MongoDB server. The workspace defaults to `mongodb://127.0.0.1:27018` for local development.

## Install

```bash
npm install
```

## Start the studio

```bash
docker compose up -d mongo
npm run dev:studio
```

The studio opens on `http://127.0.0.1:3010`. Set `MONGO_URL` to point it at another server. Set `STUDIO_READ_ONLY=1` to hide every write control.

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

The suite runs one project at a time. Integration and end to end tests need `SUPER_MONGOOSE_TEST_URI` or the local MongoDB from `docker compose`.

## Package documentation

The library API, the contract format and the CLI are documented in [`packages/super-mongoose/README.md`](packages/super-mongoose/README.md).
