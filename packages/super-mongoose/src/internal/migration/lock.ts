import { randomUUID } from "node:crypto";
import { mongo } from "mongoose";
import { MigrationError } from "../../errors";
import { isDuplicateKeyError } from "../mongo/state";

/** Collection that holds the migration lock. */
export const MIGRATION_LOCK_COLLECTION = "__migrations_lock";

const LOCK_ID = "super-mongoose";

/** Default lifetime of the lock, in seconds. */
export const DEFAULT_LOCK_TTL_SECONDS = 300;

/** One lock document. */
export interface MigrationLockDocument {
  /** Fixed identifier of the lock. */
  _id: string;
  /** Identifier of the runner that holds the lock. */
  owner: string;
  /** When the runner took the lock. */
  createdAt: Date;
  /** When the lock expires, the runner renews it before that moment. */
  expiresAt: Date;
}

/** Options of the migration lock. */
export interface MigrationLockOptions {
  /** Lifetime of the lock in seconds, 300 by default. */
  ttlSeconds?: number;
  /** Label of the runner, a random identifier is added to it. */
  owner?: string;
}

/**
 * Serialises the migration runs of a database with a single lock document.
 *
 * The lock is taken with an insert, and a lock whose lifetime expired is
 * taken over with a compare and swap on the expiry date, so two runners can
 * never hold the lock at the same time. A runner that works for longer than
 * the lifetime has to renew the lock, otherwise another runner takes over.
 */
export class MigrationLock {
  private readonly collection: mongo.Collection<MigrationLockDocument>;
  private readonly owner: string;
  private readonly ttlMilliseconds: number;
  private acquired = false;

  constructor(db: mongo.Db, options: MigrationLockOptions = {}) {
    this.collection = db.collection<MigrationLockDocument>(MIGRATION_LOCK_COLLECTION);
    this.owner = `${options.owner ?? "runner"}:${randomUUID()}`;
    this.ttlMilliseconds = (options.ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS) * 1000;
  }

  /**
   * Takes the lock, or takes over a lock that expired.
   *
   * @returns Nothing.
   * @throws {MigrationError} With code `LOCK_HELD` when another runner holds the lock.
   */
  async acquire(): Promise<void> {
    const now = new Date();

    try {
      await this.collection.insertOne({
        _id: LOCK_ID,
        owner: this.owner,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.ttlMilliseconds),
      });
      this.acquired = true;
      return;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }

    const taken = await this.collection.updateOne(
      { _id: LOCK_ID, expiresAt: { $lte: new Date() } },
      {
        $set: {
          owner: this.owner,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + this.ttlMilliseconds),
        },
      },
    );

    if (taken.matchedCount === 0) {
      throw new MigrationError("LOCK_HELD", "another migration runner holds the lock", {
        context: { collection: MIGRATION_LOCK_COLLECTION },
      });
    }

    this.acquired = true;
  }

  /**
   * Extends the lock, so a long migration is not taken over.
   *
   * @returns Nothing.
   * @throws {MigrationError} With code `LOCK_HELD` when the lock was taken over.
   */
  async renew(): Promise<void> {
    if (!this.acquired) {
      return;
    }

    const result = await this.collection.updateOne(
      { _id: LOCK_ID, owner: this.owner },
      { $set: { expiresAt: new Date(Date.now() + this.ttlMilliseconds) } },
    );

    if (result.matchedCount === 0) {
      throw new MigrationError("LOCK_HELD", "the migration lock was taken over by another runner", {
        context: { collection: MIGRATION_LOCK_COLLECTION },
      });
    }
  }

  /**
   * Releases the lock, when this runner holds it.
   *
   * @returns Nothing.
   */
  async release(): Promise<void> {
    if (!this.acquired) {
      return;
    }

    this.acquired = false;

    await this.collection.deleteOne({ _id: LOCK_ID, owner: this.owner });
  }
}
