import { londonServiceDate } from "@rails/domain";
import { observedAtFrom } from "./records";

export const PROVIDER = "TRUST";

export type RunStatus = "running" | "terminated";

/** Lo que un reporte de movimiento aporta a la proyección, ya normalizado. */
export interface MovementProjection {
  providerRunId: string;
  serviceDate: string;
  status: RunStatus;
  delaySeconds: number | null;
  stanox: string | null;
  observedAt: Date;
  /** Identificador nuevo cuando la circulación se renumera; informativo por ahora. */
  renamedTo: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `timetable_variation` llega en minutos sin signo; el signo lo da `variation_status`. */
export function delaySecondsFrom(body: Record<string, unknown>): number | null {
  const raw = text(body.timetable_variation);
  // Number("") es cero: una variación ausente no es un retraso de cero minutos.
  if (!raw) return null;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return null;
  const status = text(body.variation_status).toUpperCase();
  if (status === "LATE") return Math.round(minutes * 60);
  if (status === "EARLY") return -Math.round(minutes * 60);
  if (status === "ON TIME") return 0;
  return null; // OFF ROUTE u otros: el retraso no es interpretable
}

export function stanoxFrom(body: Record<string, unknown>): string | null {
  const raw = text(body.loc_stanox);
  return /^\d{1,5}$/.test(raw) && Number(raw) > 0 ? raw.padStart(5, "0") : null;
}

/**
 * Devuelve null para todo lo que no sea un movimiento proyectable.
 *
 * El feed no trae fecha de servicio, así que se deriva de la fecha londinense
 * del evento. Un tren que cruza medianoche producirá dos circulaciones.
 */
export function projectMovement(payload: unknown, receivedAt: Date): MovementProjection | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const header = record.header as Record<string, unknown> | undefined;
  const body = record.body as Record<string, unknown> | undefined;
  if (!header || !body || String(header.msg_type) !== "0003") return null;

  const providerRunId = text(body.train_id);
  if (!providerRunId) return null;

  const observedAt = observedAtFrom(body) ?? receivedAt;
  const current = text(body.current_train_id);
  return {
    providerRunId,
    serviceDate: londonServiceDate(observedAt),
    status: text(body.train_terminated).toLowerCase() === "true" ? "terminated" : "running",
    delaySeconds: delaySecondsFrom(body),
    stanox: stanoxFrom(body),
    observedAt,
    renamedTo: current && current !== providerRunId ? current : null
  };
}
