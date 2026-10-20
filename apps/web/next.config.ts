import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

// Next carga el .env de apps/web; DATABASE_URL vive en el de la raíz del workspace.
try { loadEnvFile(new URL("../../.env", import.meta.url).pathname); } catch { /* el entorno puede traerlo */ }

const config: NextConfig = { transpilePackages: ["@rails/domain", "@rails/db"] };
export default config;
