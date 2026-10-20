/**
 * Umbrales de frescura de una posición reportada.
 *
 * FRESH sale de triplicar el p90 medido entre reportes consecutivos de un mismo
 * tren, que fue de 5 minutos. **Es provisional**: la cola de esa distribución se
 * midió con captura intermitente y está contaminada por nuestros propios huecos.
 * Revisar con un día de ingesta continua antes de darlos por buenos.
 */
export const FRESH_SECONDS = 15 * 60;
export const SERVE_SECONDS = 2 * 60 * 60;

export type Freshness = "fresh" | "stale" | "expired";

/** Clasifica por antigüedad del último reporte; no mira la calidad geográfica. */
export function freshness(observedAt: string | Date, now: number = Date.now()): Freshness {
  const observed = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "expired";
  // Las marcas pueden ir por delante de la recepción: eso es reciente, no futuro inválido.
  const age = (now - observed) / 1000;
  if (age <= FRESH_SECONDS) return "fresh";
  if (age <= SERVE_SECONDS) return "stale";
  return "expired";
}
