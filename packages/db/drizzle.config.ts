import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

// El .env vive en la raíz del workspace; drizzle-kit se ejecuta desde packages/db.
try { loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url))); } catch { /* el entorno ya puede traerla */ }

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to generate or apply migrations.");

export default defineConfig({
  dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle",
  extensionsFilters: ["postgis"], dbCredentials: {url}
});
