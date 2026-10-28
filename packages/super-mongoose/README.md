# super-mongoose

A migration layer for Mongoose. A contract declares the state a collection
should have, the runner brings the database to that state and records what it
applied.

The layer keeps working next to the models an application already has. A
contract describes the collections the layer owns, the fields and the indexes
of each one, and the runner touches nothing else.

## Install

```bash
npm install super-mongoose mongoose zod
```

Mongoose is a peer dependency, versions 6 up to 9 are supported. The package
is written in TypeScript and ships its own types.

## Write a contract

A contract is a plain object with a version and the models it declares.

```ts
export default [
  {
    version: "20240101090000",
    models: {
      Driver: {
        name: "Driver",
        collection: "drivers",
        fields: {
          firstName: { type: "String", status: "up", required: true },
          lastName: { type: "String", status: "up" },
          age: { type: "Number", status: "up", min: 18 },
          status: { type: "String", status: "up", enum: ["active", "suspended"] },
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
      },
    },
  },
];
```

Every field and every index carries a status that says what the layer should
do with it.

| Status | Meaning |
| --- | --- |
| `up` | The element belongs to the contract, the layer creates it when it is missing. |
| `down` | A field is left out of the schema and the validator, an index is dropped. Stored field values are not changed. |
| `ignore` | The element belongs to the application, the layer leaves it alone. |

A contract that names a model declares the whole state of that model. A later
contract that names the same model replaces it. A field the newer contract
does not name anymore is retired.

The types are `String`, `Number`, `Boolean`, `Date`, `ObjectId`,
`Decimal128`, `Buffer`, `UUID`, `BigInt`, `Mixed`, `Map`, `Array` and
`Subdocument`. An array and a map carry the contract of their elements in
`of`, a subdocument carries the contract of its fields in `fields`.

## Run the migrations

```ts
import mongoose from "mongoose";
import { runMigrations } from "super-mongoose";
import contracts from "./contracts.js";

await mongoose.connect(process.env.MONGO_URL);

const result = await runMigrations(contracts, { connection: mongoose.connection });

console.log(result.applied);
```

The runner takes the lock of the database first, reads the ledger, works out
the difference between the declared state and the live state and applies it.
Every operation is safe to run again, so an interrupted run converges on the
next one. The ledger row of a version is written after the operations of that
version succeeded.

Three more functions sit next to it.

| Function | What it does |
| --- | --- |
| `planMigrations(contracts, options)` | Returns the difference without writing anything. |
| `runMigrations(contracts, options)` | Applies the difference and records the versions it applied. |
| `migrationStatus(contracts, options)` | Returns the applied versions and the work that is pending. |

The options carry the connection, where the runner writes what it does, the
lock and the level and the action of the validator.

```ts
const result = await runMigrations(contracts, {
  connection: mongoose.connection,
  log: (message) => console.log(message),
  lock: { ttlSeconds: 300 },
  validationLevel: "moderate",
  validationAction: "error",
});
```

The validator of a collection is built from the fields the contract owns, and
is written as a `$jsonSchema` rule. The default action is `warn`, so a
document that does not fit the contract is still stored. Pass
`validationAction: "error"` to refuse it.

## Use the contract in the application

The same contract builds the Mongoose schema and the Mongoose model, so the
application and the migration never disagree about the shape of a document.

```ts
import { defineModel } from "super-mongoose";
import { Driver } from "./contracts.js";

const DriverModel = defineModel(Driver);
```

`Schem.fromContract(contract)` returns the schema alone when the application
builds its own model.

The schema has `autoIndex` and `autoCreate` off. The runner owns the
collection and its indexes, so the application never creates one that the
contract does not describe.

## Use the command line

```bash
MONGO_URL=mongodb://localhost:27017/drivers super-mongoose migrate plan --file contracts.mjs
MONGO_URL=mongodb://localhost:27017/drivers super-mongoose migrate up --file contracts.mjs
MONGO_URL=mongodb://localhost:27017/drivers super-mongoose migrate status --file contracts.mjs
```

| Command | What it prints |
| --- | --- |
| `plan` | The operations a run would apply, the advisories and the conflicts. |
| `up` | The versions the run applied, the versions that were already applied and the operations it skipped. |
| `status` | The applied versions with their time, the pending versions, the number of operations left and the conflicts. |

The file of the contracts is a JavaScript module that exports an array of
contracts, or an object with a `contracts` property. The `--database` flag
chooses the database of the connection string.

## What the layer keeps in the database

| Collection | What it holds |
| --- | --- |
| `__migrations` | One row per applied version, with the checksum of the contract and the state it declared. |
| `__migrations_lock` | The lock that keeps two runners apart. |

The checksum of a contract is checked on every run. A contract that changed
after it was applied stops the run, because the ledger no longer describes
what the database holds.

## Test

```bash
npm test
npm run test:integration
npm run test:e2e
npm run test:cov
```

The unit tests run without a database. The integration tests and the end to
end tests need a MongoDB, they read the connection string from
`SUPER_MONGOOSE_TEST_URI` and fall back to `mongodb://127.0.0.1:27018`.

## Licence

ISC
