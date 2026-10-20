import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";

const CHANNEL = "train_positions_changed";

/**
 * Una sola conexión LISTEN por proceso, repartida entre todos los clientes SSE.
 * La notificación no lleva contenido: cada cliente consulta su propio delta, así
 * que una notificación perdida durante una reconexión no pierde datos.
 */
const globalForChanges = globalThis as unknown as {railsChanges?: EventEmitter};

function connect(emitter: EventEmitter) {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = new Client({connectionString: url});
  let retry = 1000;
  const reconnect = () => {
    setTimeout(() => connect(emitter), retry);
    retry = Math.min(retry * 2, 30_000);
  };
  client.on("error", () => { client.end().catch(() => {}); reconnect(); });
  client.on("notification", notification => {
    if (notification.channel === CHANNEL) emitter.emit("change");
  });
  client.connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    // Tras reconectar pudieron perderse avisos: se señala para que cada cliente
    // consulte desde su cursor y recupere lo ocurrido mientras no había escucha.
    .then(() => { retry = 1000; emitter.emit("change"); })
    .catch(() => { client.end().catch(() => {}); reconnect(); });
}

export function changes(): EventEmitter {
  if (!globalForChanges.railsChanges) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalForChanges.railsChanges = emitter;
    connect(emitter);
  }
  return globalForChanges.railsChanges;
}
