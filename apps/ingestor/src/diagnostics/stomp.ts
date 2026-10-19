import stompit from "stompit";
import { MovementAudit, type CorpusEntry } from "./audit";
import { safeErrorCode, type Credentials } from "./http";

// destroy() accepts no argument at runtime; the community typings require one.
function closeClient(client?: stompit.Client) {
  if (client) Reflect.apply(client.destroy, client, []);
}

export async function checkMovement(credentials: Credentials, corpus: CorpusEntry[] | null, seconds: number) {
  const audit = new MovementAudit(corpus);
  const result = {
    status: "pending", authentication: "not-tested", subscription: "not-tested",
    destination: "/topic/TRAIN_MVT_ALL_TOC", requestedSeconds: seconds,
    observedSeconds: 0, error: null as string | null
  };
  await new Promise<void>(resolve => {
    let client: stompit.Client | undefined;
    let started = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: string, error?: unknown) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      clearTimeout(deadline);
      process.removeListener("SIGINT", interrupted);
      result.status = status;
      result.observedSeconds = started ? Math.round((Date.now() - started) / 1000) : 0;
      if (error) result.error = safeErrorCode(error);
      if (client && started && !error) {
        const forceClose = setTimeout(() => {closeClient(client); resolve();}, 1500);
        client.disconnect(() => {clearTimeout(forceClose); closeClient(client); resolve();});
      } else {closeClient(client); resolve();}
    };
    const interrupted = () => finish("interrupted");
    const deadline = setTimeout(() => finish("connection-timeout", new Error("timeout")), 18_000);
    process.once("SIGINT", interrupted);
    client = stompit.connect({
      host: "publicdatafeeds.networkrail.co.uk", port: 61618, timeout: 12_000,
      connectHeaders: {
        host: "publicdatafeeds.networkrail.co.uk", login: credentials.username,
        passcode: credentials.password, "accept-version": "1.2,1.1", "heart-beat": "10000,10000"
      }
    }, (error, connected) => {
      if (done) {closeClient(connected); return;}
      if (error) {result.authentication = "not-confirmed"; finish("connection-failed", error); return;}
      client = connected;
      clearTimeout(deadline);
      result.authentication = "accepted";
      result.subscription = "requested";
      started = Date.now();
      console.info(JSON.stringify({step: "movement", authentication: "accepted", listeningSeconds: seconds}));
      // Temporary subscription; no client-id or durable subscription name is reused.
      client.setImplicitSubscription(0, "auto", (messageError, message) => {
        if (done) {message?.resume(); return;}
        if (messageError) {finish("subscription-failed", messageError); return;}
        result.subscription = "messages-received";
        const buffers: Buffer[] = [];
        let bytes = 0;
        message.on("data", (chunk: Buffer) => {
          if (done) return;
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {finish("message-limit", new Error("BODY_LIMIT")); return;}
          buffers.push(Buffer.from(chunk));
        });
        message.on("error", error => finish("message-failed", error));
        message.on("end", () => {
          if (!done) audit.consume(Buffer.concat(buffers).toString("utf8"));
        });
      });
      client.sendFrame("SUBSCRIBE", {id: "0", destination: result.destination, ack: "auto"}, {
        onReceipt: () => {if (result.subscription === "requested") result.subscription = "receipt-confirmed";},
        onError: error => finish("subscription-failed", error)
      }).end();
      timer = setTimeout(() => finish(audit.records > 0 ? "received" : "no-records-in-window"), seconds * 1000);
    });
    // Broker errors may include usernames; expose only whitelisted error categories.
    client.on("error", error => finish(started ? "stream-failed" : "connection-failed", error));
  });
  return {...result, ...audit.summary(corpus !== null)};
}
