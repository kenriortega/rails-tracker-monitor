import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { startConsumer } from "./consumer";

const root = new URL("../../../", import.meta.url);
try { loadEnvFile(fileURLToPath(new URL(".env", root))); }
catch { console.info(JSON.stringify({status: "env-file-unavailable"})); process.exit(1); }

const username = process.env.NETWORK_RAIL_USERNAME;
const password = process.env.NETWORK_RAIL_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!username?.trim() || !password || !connectionString) {
  console.info(JSON.stringify({status: "configuration-missing", credentialsPresent: Boolean(username?.trim() && password), databaseUrlPresent: Boolean(connectionString)}));
  process.exit(1);
}

console.info(JSON.stringify({status: "starting", valuesRedacted: true}));
const consumer = startConsumer({credentials: {username, password}, connectionString});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    consumer.stop().then(() => process.exit(0), () => process.exit(1));
  });
}
