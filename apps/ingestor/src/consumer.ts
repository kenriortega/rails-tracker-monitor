import stompit from "stompit";
import { createDatabase, rawEvents } from "@rails/db";
import { safeErrorCode, type Credentials } from "./diagnostics/http";
import { rowsFromBatch, type RawEventRow } from "./records";

const DESTINATION = "/topic/TRAIN_MVT_ALL_TOC";
const BODY_LIMIT = 4 * 1024 * 1024;

function log(event: Record<string, unknown>) {
  console.info(JSON.stringify({at: new Date().toISOString(), ...event}));
}

export interface ConsumerOptions {
  credentials: Credentials;
  connectionString: string;
  destination?: string;
}

/**
 * Consumidor duradero. Confirma cada mensaje solo después de que su transacción
 * haya hecho commit: con ack automático una caída entre recepción y escritura
 * perdería eventos sin dejar rastro.
 */
export function startConsumer({credentials, connectionString, destination = DESTINATION}: ConsumerOptions) {
  const {db, close} = createDatabase(connectionString);
  const totals = {batches: 0, rows: 0, inserted: 0, duplicates: 0, skipped: 0, reconnects: 0};
  let stopping = false;
  let writing: Promise<unknown> = Promise.resolve();
  let disconnectedAt: number | null = null;

  const failover = new stompit.ConnectFailover([{
    host: "publicdatafeeds.networkrail.co.uk", port: 61618, timeout: 12_000,
    connectHeaders: {
      host: "publicdatafeeds.networkrail.co.uk", login: credentials.username,
      passcode: credentials.password, "accept-version": "1.2,1.1", "heart-beat": "10000,10000"
    }
  }], {initialReconnectDelay: 1000, maxReconnectDelay: 60_000, useExponentialBackOff: true, maxReconnects: -1, randomize: false});

  // Los errores del broker pueden incluir el usuario: solo categorías permitidas.
  failover.on("error", error => log({event: "connection-error", error: safeErrorCode(error)}));

  async function persist(rows: RawEventRow[]): Promise<number> {
    if (!rows.length) return 0;
    const inserted = await db.insert(rawEvents).values(rows)
      .onConflictDoNothing({target: [rawEvents.feed, rawEvents.deduplicationKey]})
      .returning({id: rawEvents.id});
    return inserted.length;
  }

  const connection = failover.connect((error, client, reconnect) => {
    if (stopping) return;
    if (error) { log({event: "connect-failed", error: safeErrorCode(error)}); return; }
    if (disconnectedAt !== null) {
      // El hueco no se puede rellenar: el broker no reenvía lo emitido mientras no había sesión.
      log({event: "gap", unreachableSeconds: Math.round((Date.now() - disconnectedAt) / 1000), recoverable: false});
      disconnectedAt = null;
    }
    totals.reconnects++;
    log({event: "connected", destination, attempt: totals.reconnects});

    client.on("error", clientError => {
      if (stopping) return;
      disconnectedAt = Date.now();
      log({event: "stream-failed", error: safeErrorCode(clientError)});
      reconnect();
    });

    const subscription = client.subscribe({id: "ingest", destination, ack: "client-individual"}, (messageError, message) => {
      if (stopping) { message?.resume(); return; }
      if (messageError) { log({event: "subscription-failed", error: safeErrorCode(messageError)}); return; }
      const receivedAt = new Date();
      const chunks: Buffer[] = [];
      let bytes = 0;
      message.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > BODY_LIMIT) { log({event: "body-limit", bytes}); return; }
        chunks.push(Buffer.from(chunk));
      });
      message.on("error", streamError => log({event: "message-failed", error: safeErrorCode(streamError)}));
      message.on("end", () => {
        const {rows, skipped} = rowsFromBatch(Buffer.concat(chunks).toString("utf8"), receivedAt);
        // Escrituras en serie: una transacción confirmada antes de confirmar su mensaje.
        writing = writing.then(async () => {
          try {
            const inserted = await persist(rows);
            totals.batches++; totals.rows += rows.length; totals.inserted += inserted;
            totals.duplicates += rows.length - inserted; totals.skipped += skipped;
            client.ack(message);
          } catch (writeError) {
            // Sin ack: el broker podrá reentregarlo. La clave de deduplicación evita el duplicado.
            log({event: "write-failed", error: safeErrorCode(writeError), rows: rows.length});
          }
        });
      });
    });

    if (stopping) subscription.unsubscribe();
  });

  async function stop() {
    if (stopping) return totals;
    stopping = true;
    connection.abort();
    await writing;
    await close();
    log({event: "stopped", ...totals});
    return totals;
  }

  return {stop, totals};
}
