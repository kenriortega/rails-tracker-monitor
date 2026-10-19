/**
 * TRUST emite `actual_timestamp` como epoch en milisegundos, pero con la hora de
 * pared de Londres ya incorporada: codifica hora local como si fuera UTC. Estas
 * funciones recuperan el instante real. No aplicar un desplazamiento fijo de una
 * hora: el offset depende del momento del evento.
 */

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
});

/** Posibles offsets de Europe/London desde 1972, del más tardío al más temprano. */
const OFFSETS_MS = [0, 3600000];

/** Offset UTC de Europe/London vigente en ese instante, en milisegundos. */
export function londonOffsetMs(instant: number): number {
  const parts = Object.fromEntries(LONDON.formatToParts(instant).map(part => [part.type, part.value]));
  const wallClock = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return wallClock - Math.floor(instant / 1000) * 1000;
}

export type LondonResolution = "unique" | "ambiguous" | "nonexistent";

export interface ResolvedInstant {
  /** Instante UTC real, o null si esa hora local no existe. */
  utc: number | null;
  offsetSeconds: number | null;
  resolution: LondonResolution;
}

/**
 * Convierte una hora de pared de Londres codificada como epoch UTC al instante real.
 *
 * Una hora local no siempre identifica un instante único. En el pliegue de otoño
 * ocurre dos veces (`ambiguous`, se elige la lectura GMT por convención) y en el
 * salto de primavera no ocurre nunca (`nonexistent`). Una sola iteración de
 * "calcular offset y restar" no distingue el caso ambiguo: hay que comprobar
 * ambos candidatos.
 */
export function resolveLondonLocalEpoch(localEpoch: number): ResolvedInstant {
  const candidates = OFFSETS_MS
    .map(offset => ({offset, instant: localEpoch - offset}))
    .filter(candidate => londonOffsetMs(candidate.instant) === candidate.offset);
  if (!candidates.length) return {utc: null, offsetSeconds: null, resolution: "nonexistent"};
  const chosen = candidates[0];
  return {utc: chosen.instant, offsetSeconds: chosen.offset / 1000, resolution: candidates.length === 1 ? "unique" : "ambiguous"};
}

const LONDON_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit"
});

/**
 * Fecha operativa en Europe/London, en formato ISO.
 *
 * Es una aproximación: los reportes de movimiento no traen fecha de servicio, y
 * un tren que cruza medianoche produce dos fechas distintas para una misma
 * circulación. Ver «Semántica temporal de TRUST» en docs/data-contracts.md.
 */
export function londonServiceDate(instant: number | Date): string {
  return LONDON_DATE.format(instant);
}
