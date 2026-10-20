/**
 * SCHEDULE llega como JSON por líneas: una cabecera `JsonTimetableV1`, después
 * registros `JsonScheduleV1`, `TiplocV1` y `JsonAssociationV1`. Se analiza en
 * flujo porque el fichero diario completo no cabe cómodamente en memoria.
 */
export interface ScheduleRecord {
  uid: string;
  validFrom: string;
  validTo: string;
  stpIndicator: string;
  /** Primer y último punto del recorrido, por código TIPLOC. */
  originTiploc: string | null;
  destinationTiploc: string | null;
  signallingId: string | null;
  payload: unknown;
}

export interface ScheduleTotals {
  lines: number;
  schedules: number;
  skipped: number;
  outsideWindow: number;
  cancellations: number;
}

function locationTiplocs(segment: Record<string, unknown> | undefined) {
  const locations = segment?.schedule_location;
  if (!Array.isArray(locations) || !locations.length) return {origin: null, destination: null};
  const code = (entry: unknown) => {
    const value = (entry as Record<string, unknown> | null)?.tiploc_code;
    return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
  };
  return {origin: code(locations[0]), destination: code(locations[locations.length - 1])};
}

/** Devuelve null para líneas que no sean un horario utilizable. */
export function parseScheduleLine(line: string): ScheduleRecord | null {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  const schedule = (parsed as Record<string, unknown> | null)?.JsonScheduleV1 as Record<string, unknown> | undefined;
  if (!schedule) return null;
  const uid = String(schedule.CIF_train_uid ?? "").trim();
  const validFrom = String(schedule.schedule_start_date ?? "").trim();
  const stpIndicator = String(schedule.CIF_stp_indicator ?? "").trim();
  if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !stpIndicator) return null;
  const segment = schedule.schedule_segment as Record<string, unknown> | undefined;
  const {origin, destination} = locationTiplocs(segment);
  const signalling = String(segment?.signalling_id ?? "").trim();
  return {
    uid, validFrom,
    validTo: /^\d{4}-\d{2}-\d{2}$/.test(String(schedule.schedule_end_date ?? "")) ? String(schedule.schedule_end_date) : validFrom,
    stpIndicator, originTiploc: origin, destinationTiploc: destination,
    signallingId: signalling || null, payload: schedule
  };
}

/** Cierto si la ventana de validez del horario cubre la fecha indicada. */
export function coversDate(record: ScheduleRecord, isoDate: string): boolean {
  return record.validFrom <= isoDate && isoDate <= record.validTo;
}

/**
 * Recorre las líneas de un flujo ya descomprimido y entrega los horarios cuya
 * validez cubra `isoDate`. Importar el fichero entero multiplicaría el volumen
 * sin que el enlace por activación pueda usar lo que queda fuera.
 */
export async function readSchedules(
  chunks: AsyncIterable<Buffer | string>,
  isoDate: string,
  emit: (record: ScheduleRecord) => void | Promise<void>
): Promise<ScheduleTotals> {
  const totals: ScheduleTotals = {lines: 0, schedules: 0, skipped: 0, outsideWindow: 0, cancellations: 0};
  let buffer = "";
  const handle = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    totals.lines++;
    const record = parseScheduleLine(line);
    if (!record) { totals.skipped++; return; }
    // Las cancelaciones no describen un recorrido; se cuentan y no se guardan.
    if (record.stpIndicator === "C") { totals.cancellations++; return; }
    if (!coversDate(record, isoDate)) { totals.outsideWindow++; return; }
    totals.schedules++;
    await emit(record);
  };
  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await handle(line);
    }
  }
  await handle(buffer);
  return totals;
}
