import "server-only";
import { createDatabase } from "@rails/db";

/**
 * `createDatabase` abre un pool nuevo en cada llamada. Con recarga en caliente,
 * invocarlo por petición agotaría las conexiones, así que se cachea por proceso.
 */
const globalForDatabase = globalThis as unknown as {railsDatabase?: ReturnType<typeof createDatabase>};

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to serve live data.");
  globalForDatabase.railsDatabase ??= createDatabase(url);
  return globalForDatabase.railsDatabase.db;
}
