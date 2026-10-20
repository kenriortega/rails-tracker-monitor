"use client";

import { useEffect, useState } from "react";
import type { Trail } from "@rails/domain";

/**
 * Recorrido de la circulación seleccionada. `version` es la de esa circulación,
 * de modo que solo se recarga cuando ese tren reporta, no con cada delta.
 */
export function useTrail(runId: string | null, version: number): Trail | null {
  const [trail, setTrail] = useState<Trail | null>(null);

  useEffect(() => {
    if (!runId) { setTrail(null); return; }
    let cancelled = false;
    fetch(`/api/runs/${runId}/trail`, {cache: "no-store"})
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!cancelled) setTrail(data as Trail | null); })
      .catch(() => { if (!cancelled) setTrail(null); });
    return () => { cancelled = true; };
  }, [runId, version]);

  return trail;
}
