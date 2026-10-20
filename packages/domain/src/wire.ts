import type { PositionQuality } from "./index";

/**
 * Contrato entre el servidor y el navegador. Vive en el dominio para que ambos
 * lados no se desincronicen. No expone payloads originales del feed.
 */
export interface LiveRun {
  runId: string;
  providerRunId: string;
  serviceDate: string;
  status: string;
  delaySeconds: number | null;
  /** Código de operador de TRUST; nulo cuando el mensaje no lo trae. */
  tocId: string | null;
  quality: PositionQuality;
  /** Nula cuando la ubicación no resuelve o resuelve a puntos distintos. */
  coordinate: [longitude: number, latitude: number] | null;
  observedAt: string;
  version: number;
}

export interface Snapshot {
  version: number;
  generatedAt: string;
  runs: LiveRun[];
}

/** Lote de cambios posteriores a `since`; `version` es el nuevo cursor. */
export interface Delta {
  version: number;
  runs: LiveRun[];
}
