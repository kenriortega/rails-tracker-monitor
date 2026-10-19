import { createHash } from "node:crypto";
import { resolveLondonLocalEpoch } from "@rails/domain";

export const MOVEMENT_FEED = "TRUST_MVT";

/** Rango defensivo de epoch en milisegundos: del año 2000 al 2100. */
const EPOCH_FLOOR = 946684800000;
const EPOCH_CEILING = 4102444800000;

export interface RawEventRow {
  feed: string;
  deduplicationKey: string;
  observedAt: Date | null;
  receivedAt: Date;
  payload: unknown;
}

/** JSON con las claves de objeto ordenadas, para que el orden no altere el hash. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Identifica un mensaje idéntico, no un evento semánticamente parecido: lo que
 * debe deduplicarse aquí es la reentrega tras una reconexión. La deduplicación
 * semántica corresponde a la proyección, que sí tiene contexto para decidirla.
 */
export function deduplicationKey(record: unknown): string {
  return createHash("sha256").update(canonicalize(record)).digest("hex");
}

/** TRUST codifica hora de pared de Londres como si fuera UTC; ver packages/domain/src/time.ts. */
export function observedAtFrom(body: Record<string, unknown>): Date | null {
  const raw = body.actual_timestamp;
  if (raw === undefined || raw === null || raw === "") return null;
  const stamp = Number(raw);
  if (!Number.isFinite(stamp) || stamp < EPOCH_FLOOR || stamp >= EPOCH_CEILING) return null;
  const resolved = resolveLondonLocalEpoch(stamp);
  return resolved.utc === null ? null : new Date(resolved.utc);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Devuelve null para cualquier registro que no tenga la forma esperada. */
export function toRawEventRow(record: unknown, receivedAt: Date, feed = MOVEMENT_FEED): RawEventRow | null {
  if (!isPlainObject(record) || !isPlainObject(record.header) || !isPlainObject(record.body)) return null;
  return {
    feed, deduplicationKey: deduplicationKey(record),
    observedAt: observedAtFrom(record.body), receivedAt, payload: record
  };
}

/** Convierte el cuerpo de un lote STOMP en filas; descarta lo que no encaje. */
export function rowsFromBatch(body: string, receivedAt: Date, feed = MOVEMENT_FEED): {rows: RawEventRow[]; skipped: number} {
  let records: unknown;
  try { records = JSON.parse(body); } catch { return {rows: [], skipped: 1}; }
  if (!Array.isArray(records)) return {rows: [], skipped: 1};
  const rows: RawEventRow[] = [];
  let skipped = 0;
  for (const record of records) {
    const row = toRawEventRow(record, receivedAt, feed);
    if (row) rows.push(row); else skipped++;
  }
  return {rows, skipped};
}
