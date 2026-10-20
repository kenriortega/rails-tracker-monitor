"use client";

import { useEffect, useRef, useState } from "react";
import type { Delta, LiveRun, Snapshot } from "@rails/domain";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "failed";

export interface LiveData {
  runs: LiveRun[];
  connection: ConnectionState;
  /** Instante del último cambio aplicado, no de la última comprobación. */
  updatedAt: number | null;
}

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
  const byId = useRef(new Map<string, LiveRun>());

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

  return {runs, connection, updatedAt};
}
