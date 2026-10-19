import { createReadStream } from "node:fs";
import { SaxesParser } from "saxes";

/**
 * NaPTAN publica el TIPLOC solo en el XML, dentro de AnnotatedRailRef; el CSV no
 * lo incluye. El fichero nacional ronda los 580 MB, así que se analiza en flujo.
 */
export interface RailStation {
  tiploc: string;
  crs: string | null;
  name: string | null;
  longitude: number;
  latitude: number;
}

export interface ParseTotals {
  stopPoints: number;
  railStopPoints: number;
  withoutTiploc: number;
  withoutCoordinates: number;
  stations: number;
}

/** Texto de los elementos que nos interesan, por nombre local. */
const WANTED = new Set(["StopType", "TiplocRef", "CrsRef", "Longitude", "Latitude", "CommonName"]);

function finishStop(current: Map<string, string>, totals: ParseTotals, emit: (station: RailStation) => void) {
  totals.stopPoints++;
  if (current.get("StopType") !== "RLY") return;
  totals.railStopPoints++;
  const tiploc = (current.get("TiplocRef") ?? "").trim().toUpperCase();
  if (!tiploc) { totals.withoutTiploc++; return; }
  const longitude = Number(current.get("Longitude"));
  const latitude = Number(current.get("Latitude"));
  // Algunas estaciones tienen códigos válidos y geometría nula en NaPTAN.
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) { totals.withoutCoordinates++; return; }
  totals.stations++;
  emit({tiploc, crs: (current.get("CrsRef") ?? "").trim() || null, name: (current.get("CommonName") ?? "").trim() || null, longitude, latitude});
}

/** Analiza el XML y entrega cada estación con TIPLOC y coordenadas. */
export function parseRailStations(path: string, emit: (station: RailStation) => void): Promise<ParseTotals> {
  const totals: ParseTotals = {stopPoints: 0, railStopPoints: 0, withoutTiploc: 0, withoutCoordinates: 0, stations: 0};
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();
    let current: Map<string, string> | null = null;
    let capturing: string | null = null;

    parser.on("opentag", node => {
      const name = node.name.replace(/^.*:/, "");
      if (name === "StopPoint") { current = new Map(); return; }
      // Solo el primer valor de cada nombre: el primero es el del propio StopPoint.
      if (current && WANTED.has(name) && !current.has(name)) capturing = name;
    });
    parser.on("text", text => {
      if (current && capturing) current.set(capturing, (current.get(capturing) ?? "") + text);
    });
    parser.on("closetag", node => {
      const name = node.name.replace(/^.*:/, "");
      if (name === capturing) { capturing = null; return; }
      if (name === "StopPoint" && current) { finishStop(current, totals, emit); current = null; }
    });
    parser.on("error", reject);

    const stream = createReadStream(path, {encoding: "utf8", highWaterMark: 1 << 20});
    stream.on("data", chunk => {
      try { parser.write(chunk as string); } catch (error) { stream.destroy(); reject(error); }
    });
    stream.on("error", reject);
    stream.on("end", () => {
      try { parser.close(); resolve(totals); } catch (error) { reject(error); }
    });
  });
}
