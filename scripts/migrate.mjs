/**
 * Apply the migrations in drizzle/ to DATABASE_URL. Plain Node with runtime
 * dependencies only, so it works as a deploy step after dev dependencies are gone
 * (Railway's pre-deploy command). Already-applied migrations are skipped.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
