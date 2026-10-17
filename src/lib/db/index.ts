import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseEnv } from "@/lib/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { fatherhoodDb?: Database };

/** Lazily connected database client. */
export function getDb(): Database {
  if (!globalForDb.fatherhoodDb) {
    const client = postgres(databaseEnv().DATABASE_URL, { max: 10, prepare: false });
    globalForDb.fatherhoodDb = drizzle(client, { schema });
  }
  return globalForDb.fatherhoodDb;
}

export { schema };
