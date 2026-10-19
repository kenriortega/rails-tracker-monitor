export type CorpusEntry = { STANOX?: string; TIPLOC?: string; NLCDESC?: string };

export function corpusRecords(value: unknown): CorpusEntry[] {
  if (!value || typeof value !== "object") throw new Error("INVALID_CORPUS");
  const entries = (value as Record<string, unknown>).TIPLOCDATA;
  if (!Array.isArray(entries) || !entries.length || !entries.every(entry => entry && typeof entry === "object" && !Array.isArray(entry))) throw new Error("INVALID_CORPUS");
  return entries as CorpusEntry[];
}

function stanoxKey(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^\d{1,5}$/.test(text) && Number(text) > 0 ? text.padStart(5, "0") : null;
}

export class MovementAudit {
  batches = 0;
  records = 0;
  invalidRecords = 0;
  invalidJsonBatches = 0;
  emptyBatches = 0;
  types: Record<string, number> = {};
  locationsPresent = 0;
  locationsResolved = 0;
  missingLocation = 0;
  timestampsPresent = 0;
  invalidTimestamps = 0;
  private locationIndex: Set<string>;
  private runs = new Set<string>();
  private lags: number[] = [];

  constructor(corpus: CorpusEntry[] | null) {
    this.locationIndex = new Set((corpus ?? []).map(entry => stanoxKey(entry.STANOX)).filter((key): key is string => key !== null));
  }

  consume(body: string, receivedAt = Date.now()): void {
    this.batches++;
    let items: unknown;
    try { items = JSON.parse(body); }
    catch { this.invalidJsonBatches++; return; }
    if (!Array.isArray(items)) { this.invalidRecords++; return; }
    if (!items.length) this.emptyBatches++;
    for (const item of items) {
      if (!item || typeof item !== "object" || !item.header || !item.body || typeof item.header !== "object" || typeof item.body !== "object" || Array.isArray(item.body)) {
        this.invalidRecords++; continue;
      }
      this.records++;
      const type = /^\d{4}$/.test(String(item.header.msg_type)) ? String(item.header.msg_type) : "other";
      this.types[type] = (this.types[type] ?? 0) + 1;
      if (typeof item.body.train_id === "string") this.runs.add(item.body.train_id);
      // Only movement reports have the location/timestamp semantics measured here.
      if (type === "0003") {
        const location = stanoxKey(item.body.loc_stanox);
        if (location) {
          this.locationsPresent++;
          if (this.locationIndex.has(location)) this.locationsResolved++;
        } else this.missingLocation++;
        if (item.body.actual_timestamp !== undefined && item.body.actual_timestamp !== "") {
          const timestamp = Number(item.body.actual_timestamp);
          if (Number.isFinite(timestamp) && timestamp >= 946684800000 && timestamp < 4102444800000) {
            this.timestampsPresent++;
            this.lags.push(Math.round((receivedAt - timestamp) / 1000));
          } else this.invalidTimestamps++;
        }
      }
    }
  }

  summary(corpusAvailable: boolean) {
    const lags = [...this.lags].sort((a, b) => a - b);
    return {
      batches: this.batches, records: this.records, types: this.types,
      invalidJsonBatches: this.invalidJsonBatches, invalidRecords: this.invalidRecords,
      emptyBatches: this.emptyBatches, distinctTrainIds: this.runs.size,
      movementLocations: {
        present: this.locationsPresent, missing: this.missingLocation,
        resolvedInCorpus: corpusAvailable ? this.locationsResolved : null,
        coveragePercent: corpusAvailable && this.locationsPresent ? Math.round(this.locationsResolved / this.locationsPresent * 1000) / 10 : null,
        note: "Code correspondence only; not geographic coordinates or confirmed map positions."
      },
      movementTimes: {
        valid: this.timestampsPresent, invalid: this.invalidTimestamps,
        rawDifferenceSeconds: lags.length ? {min: lags[0], median: lags[Math.floor(lags.length / 2)], max: lags[lags.length - 1], negative: lags.filter(lag => lag < 0).length} : null,
        note: "Uncorrected reception minus actual_timestamp; not a validated latency metric. BST/manual reports require review."
      }
    };
  }
}
