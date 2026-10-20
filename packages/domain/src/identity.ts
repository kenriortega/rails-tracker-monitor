/**
 * El `train_id` de TRUST son diez caracteres y lleva el headcode embebido en las
 * posiciones 3 a 6.
 *
 * Verificado sobre 63 activaciones reales: en las 63, esos cuatro caracteres
 * coinciden con los cuatro primeros de `schedule_wtt_id`. Ambos campos los emite
 * TRUST, así que concuerdan dos valores del mismo origen y no dos sistemas
 * independientes; un contraste contra `signalling_id` de SCHEDULE sería la
 * confirmación definitiva.
 */
const HEADCODE = /^[0-9][A-Z][0-9]{2}$/;

/** Devuelve null cuando no cumple el formato, en lugar de un valor inventado. */
export function headcodeFromTrainId(trainId: string | null | undefined): string | null {
  if (typeof trainId !== "string" || trainId.length < 6) return null;
  const candidate = trainId.slice(2, 6).toUpperCase();
  return HEADCODE.test(candidate) ? candidate : null;
}
