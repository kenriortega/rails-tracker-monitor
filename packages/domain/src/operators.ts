/**
 * Los movimientos de TRUST traen `toc_id`, un código numérico que no nombra a
 * nadie. El nombre se arma en dos pasos.
 *
 * El primero **sale de nuestros propios datos**: cruzando las activaciones, que
 * llevan `toc_id` y `train_uid`, con los horarios importados, que llevan
 * `atoc_code`. Regenerable con la consulta documentada en
 * `docs/data-contracts.md`; refleja lo observado el 20 de octubre de 2026 y no
 * cubre los códigos que aún no hemos visto.
 *
 * Un mismo `toc_id` puede dar varios códigos ATOC: el 88 aparece como TL y GN,
 * porque el mismo operador explota varias marcas. Se conserva el más frecuente.
 * Los operadores de mercancías aparecen como `ZZ`, que es un comodín y no
 * identifica compañía, así que se omiten.
 */
const ATOC_BY_TOC: Record<string, string> = {
  "12": "LF", "20": "TP", "21": "LE", "23": "NT", "25": "GW", "27": "XC",
  "28": "EM", "29": "LM", "30": "LO", "33": "XR", "56": "TW", "60": "SR",
  "64": "ME", "71": "AW", "79": "CC", "80": "SE", "84": "SW", "88": "TL",
  "91": "LT"
};

/**
 * El segundo paso es una lista curada de códigos ATOC a nombre comercial. **No
 * sale de los datos**: los nombres cambian cuando cambian las concesiones, así
 * que puede quedar desactualizada. Un código ausente se muestra tal cual, que
 * es menos informativo pero nunca incorrecto.
 */
const NAME_BY_ATOC: Record<string, string> = {
  AW: "Transport for Wales", CC: "c2c", EM: "East Midlands Railway",
  GN: "Great Northern", GW: "Great Western Railway", LE: "Greater Anglia",
  LM: "West Midlands Trains", LO: "London Overground", LT: "London Underground",
  ME: "Merseyrail", NT: "Northern", SE: "Southeastern", SR: "ScotRail",
  SW: "South Western Railway", TL: "Thameslink", TP: "TransPennine Express",
  TW: "Tyne and Wear Metro", XC: "CrossCountry", XR: "Elizabeth line"
};

export interface Operator {
  tocId: string;
  atocCode: string | null;
  name: string | null;
  /** Lo que se muestra: nombre si se conoce, si no el código ATOC, si no el número. */
  label: string;
}

export function operator(tocId: string | null | undefined): Operator | null {
  const code = typeof tocId === "string" ? tocId.trim() : "";
  if (!code) return null;
  const atocCode = ATOC_BY_TOC[code] ?? null;
  const name = atocCode ? NAME_BY_ATOC[atocCode] ?? null : null;
  return {tocId: code, atocCode, name, label: name ?? atocCode ?? `Operador ${code}`};
}
