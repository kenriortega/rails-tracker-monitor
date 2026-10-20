import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export const PORTAL = "https://publicdatafeeds.networkrail.co.uk";
export interface Credentials { username: string; password: string }

export function safeErrorCode(error: unknown): string {
  const e = error as {code?: string; message?: string; cause?: {code?: string}};
  const code = e?.code ?? e?.cause?.code;
  const known = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPERM", "EACCES", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"];
  if (code && known.includes(code)) return code;
  if (e?.message && /authentication|invalid.?password|invalid.?user|login failed/i.test(e.message)) return "AUTHENTICATION_REJECTED";
  if (e?.message && /not authorized|not authorised|permission|securityexception/i.test(e.message)) return "ACCESS_REJECTED";
  if (e?.message && /timeout|timed out/i.test(e.message)) return "TIMEOUT";
  if ((error as Error)?.name === "AbortError" || (error as Error)?.name === "TimeoutError") return "TIMEOUT";
  const local = ["INVALID_CORPUS", "INVALID_SCHEDULE", "INVALID_JSON", "BODY_LIMIT", "REDIRECT_REJECTED", "TOO_MANY_REDIRECTS", "EMPTY_BODY"];
  return e?.message && local.includes(e.message) ? e.message : "REQUEST_OR_PROTOCOL_ERROR";
}

/** Authorization never follows a cross-origin redirect, including signed S3 downloads. */
export async function fetchFeed(path: string, credentials: Credentials, request: typeof fetch = fetch, timeoutMs = 30_000): Promise<Response> {
  let url = new URL(path, PORTAL);
  if (url.origin !== PORTAL) throw new Error("REDIRECT_REJECTED");
  const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
  // El diagnóstico se conforma con 30 s; la descarga del horario completo no.
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await request(url, {headers: url.origin === PORTAL ? {Authorization: authorization} : {}, redirect: "manual", signal});
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("REDIRECT_REJECTED");
    const next = new URL(location, url);
    const allowed = next.origin === PORTAL || next.hostname.endsWith(".amazonaws.com");
    if (next.protocol !== "https:" || next.username || next.password || !allowed) throw new Error("REDIRECT_REJECTED");
    url = next;
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

/**
 * Decode gzip files or already-decoded responses; cancel the download on early exit.
 *
 * El límite protege al diagnóstico de una respuesta inesperadamente grande. La
 * importación del horario completo lo eleva a propósito, porque ese fichero sí
 * se espera voluminoso.
 */
export async function* decodedChunks(response: Response, limitBytes = 32 * 1024 * 1024): AsyncGenerator<Buffer> {
  if (!response.body) throw new Error("EMPTY_BODY");
  const reader = response.body.getReader();
  let source: Readable | undefined;
  let output: Readable | undefined;
  try {
    const initial: Buffer[] = [];
    let initialBytes = 0;
    while (initialBytes < 2) {
      const next = await reader.read();
      if (next.done) break;
      initial.push(Buffer.from(next.value)); initialBytes += next.value.length;
    }
    const first = Buffer.concat(initial);
    if (!first.length) throw new Error("EMPTY_BODY");
    let inputBytes = first.length;
    const raw = async function* () {
      yield first;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        inputBytes += next.value.length;
        if (inputBytes > limitBytes) throw new Error("BODY_LIMIT");
        yield Buffer.from(next.value);
      }
    };
    source = Readable.from(raw());
    output = first[0] === 0x1f && first[1] === 0x8b ? source.pipe(createGunzip()) : source;
    if (output !== source) source.on("error", error => output?.destroy(error));
    for await (const chunk of output) yield Buffer.from(chunk);
  } finally {
    source?.destroy(); output?.destroy();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readJson(response: Response): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of decodedChunks(response)) {
    bytes += chunk.length;
    if (bytes > 32 * 1024 * 1024) throw new Error("BODY_LIMIT");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("INVALID_JSON"); }
}

/** Validate a bounded NDJSON sample without downloading the full timetable. */
export async function readScheduleSample(response: Response) {
  let text = "";
  let bytes = 0;
  let checkedLines = 0;
  for await (const chunk of decodedChunks(response)) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) throw new Error("BODY_LIMIT");
    text += chunk.toString("utf8");
    let newline: number;
    while ((newline = text.indexOf("\n")) >= 0) {
      const line = text.slice(0, newline).trim(); text = text.slice(newline + 1);
      if (!line) continue;
      checkedLines++;
      const kind = scheduleKind(line);
      if (kind) return {validJson: true, recordKind: kind, checkedLines, sampleOnly: true};
      if (checkedLines >= 10) throw new Error("INVALID_SCHEDULE");
    }
  }
  const kind = scheduleKind(text.trim());
  if (kind) return {validJson: true, recordKind: kind, checkedLines: checkedLines + 1, sampleOnly: true};
  throw new Error("INVALID_SCHEDULE");
}

function scheduleKind(line: string): string | null {
  try {
    const value = JSON.parse(line);
    for (const key of ["JsonTimetableV1", "JsonScheduleV1", "TiplocV1", "JsonAssociationV1", "EOF"]) {
      if (value && typeof value === "object" && Object.hasOwn(value, key)) return key;
    }
  } catch { /* Never echo unexpected response bodies. */ }
  return null;
}
