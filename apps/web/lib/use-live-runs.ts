"use client";

import { useEffect, useRef, useState } from "react";
import { activatedInWindow, freshness, type Delta, type LiveRun, type Snapshot } from "@rails/domain";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "failed";

export interface LiveData {
  runs: LiveRun[];
  connection: ConnectionState;
  /** Instante del último cambio aplicado, no de la última comprobación. */
  updatedAt: number | null;
  /** Reloj compartido para clasificar frescura sin recalcularlo en cada fila. */
  now: number;
}

// Envejecer no produce una versión nueva, así que el servidor no puede avisar de
// que una circulación caducó: el cliente la retira por su cuenta.
const EXPIRY_TICK_MS = 20_000;

/**
 * Carga el snapshot y después aplica los deltas que llegan por SSE.
 *
 * `EventSource` reconecta solo y reenvía `Last-Event-ID`, que el servidor honra,
 * así que una caída breve no pierde cambios ni los repite.
 */
export function useLiveRuns(): LiveData {
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const byId = useRef(new Map<string, LiveRun>());

  useEffect(() => {
    const timer = setInterval(() => {
      const instant = Date.now();
      let dropped = false;
      for (const [id, run] of byId.current) {
        // Misma regla que el servidor: los activados se miden por su salida
        // prevista, no por la antigüedad de un reporte que no existe.
        const servable = run.status === "activated" && run.scheduledDeparture
          ? activatedInWindow(run.scheduledDeparture, instant)
          : freshness(run.observedAt, instant) !== "expired";
        if (!servable) { byId.current.delete(id); dropped = true; }
      }
      if (dropped) setRuns([...byId.current.values()]);
      setNow(instant);
    }, EXPIRY_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | undefined;

    const apply = (incoming: LiveRun[]) => {
      for (const run of incoming) byId.current.set(run.runId, run);
      setRuns([...byId.current.values()]);
      setUpdatedAt(Date.now());
    };

    (async () => {
      try {
        const response = await fetch("/api/snapshot", {cache: "no-store"});
        if (!response.ok) throw new Error("snapshot");
        const snapshot = (await response.json()) as Snapshot;
        if (cancelled) return;
        apply(snapshot.runs);

        source = new EventSource(`/api/stream?since=${snapshot.version}`);
        source.addEventListener("open", () => setConnection("live"));
        source.addEventListener("delta", event => {
          const delta = JSON.parse((event as MessageEvent).data) as Delta;
          apply(delta.runs);
        });
        // EventSource reintenta por su cuenta; aquí solo se refleja el estado.
        source.addEventListener("error", () => setConnection(current => current === "live" ? "reconnecting" : current));
      } catch {
        if (!cancelled) setConnection("failed");
      }
    })();

    return () => { cancelled = true; source?.close(); };
  }, []);

  return {runs, connection, updatedAt, now};
}
