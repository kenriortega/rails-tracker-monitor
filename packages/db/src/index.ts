import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
/** Lazy: no database connection during web builds or demo rendering. Caller owns shutdown. */
export function createDatabase(connectionString: string) {
  if (!connectionString) throw new Error("DATABASE_URL is required for live storage.");
  const pool = new Pool({connectionString, max: 5});
  return {db: drizzle(pool, {schema}), close: () => pool.end()};
}

export * from "./schema";
