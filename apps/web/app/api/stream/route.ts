import type { Delta } from "@rails/domain";
import { changes } from "@/lib/changes";
import { latestVersion, liveRuns } from "@/lib/live-runs";

const HEARTBEAT_MS = 15_000;
// Las escrituras llegan en ráfagas: se agrupan los avisos antes de consultar.
const DEBOUNCE_MS = 250;

export async function GET(request: Request) {
  const url = new URL(request.url);
  // `Last-Event-ID` lo reenvía EventSource al reconectar por su cuenta.
  const header = request.headers.get("last-event-id");
  const requested = Number(header ?? url.searchParams.get("since") ?? 0);
  let cursor = Number.isFinite(requested) && requested > 0 ? requested : 0;

  const encoder = new TextEncoder();
  const emitter = changes();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let flushing = false;
      let again = false;

      const send = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };

      async function flush() {
        if (closed) return;
        if (flushing) { again = true; return; }
        flushing = true;
        try {
          const runs = await liveRuns(cursor);
          if (runs.length) {
            cursor = latestVersion(runs, cursor);
            const delta: Delta = {version: cursor, runs};
            send(`id: ${cursor}\nevent: delta\ndata: ${JSON.stringify(delta)}\n\n`);
          }
        } catch {
          send(`event: error\ndata: {"detail":"query-failed"}\n\n`);
        } finally {
          flushing = false;
          if (again) { again = false; void flush(); }
        }
      }

      const onChange = () => {
        if (timer) return;
        timer = setTimeout(() => { timer = undefined; void flush(); }, DEBOUNCE_MS);
      };

      const heartbeat = setInterval(() => send(`: keep-alive\n\n`), HEARTBEAT_MS);
      emitter.on("change", onChange);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        emitter.off("change", onChange);
        try { controller.close(); } catch { /* ya cerrado */ }
      };
      request.signal.addEventListener("abort", close);

      send(`retry: 2000\n\n`);
      void flush();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive"
    }
  });
}
