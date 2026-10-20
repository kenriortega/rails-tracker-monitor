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

/**
 * Ventana de los trenes activados que todavía no han reportado.
 *
 * No puede medirse por antigüedad del último reporte, porque no hay ninguno:
 * un activado desaparecía a las dos horas aunque no hubiese salido. Se ancla a
 * la salida prevista del origen, que la activación trae. La antelación mediana
 * medida entre activación y salida fue de 60 minutos, con p90 de cinco horas.
 */
export const ACTIVATED_LEAD_SECONDS = 3 * 60 * 60;
export const ACTIVATED_GRACE_SECONDS = 60 * 60;

/** Cierto mientras un tren activado deba mostrarse, aunque no haya reportado. */
export function activatedInWindow(scheduledDeparture: string | null | undefined, now: number = Date.now()): boolean {
  if (!scheduledDeparture) return false;
  const departure = Date.parse(scheduledDeparture);
  if (!Number.isFinite(departure)) return false;
  const seconds = (departure - now) / 1000;
  return seconds <= ACTIVATED_LEAD_SECONDS && seconds >= -ACTIVATED_GRACE_SECONDS;
}
