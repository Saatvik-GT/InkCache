/**
 * Node-level metrics collection: op counters, hit rate, latency percentiles,
 * and rolling throughput. All numbers are measured from real operations —
 * nothing here is synthesized.
 */

export type OpType = "get" | "set" | "delete";

export interface MetricsSnapshot {
  uptimeSec: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  sets: number;
  deletes: number;
  opsPerSec: number;
  latency: { avgUs: number | null; p95Us: number | null; samples: number };
}

/** One snapshot() call plus when it was taken -- what /metrics/history hands back. */
export interface MetricsHistoryEntry extends MetricsSnapshot {
  at: number; // epoch ms
}

const LATENCY_SAMPLE_CAP = 512; // ring buffer size for percentile estimation
const THROUGHPUT_WINDOW_MS = 10_000;
const HISTORY_CAP = 360; // 1 hour of history at the default 10s sampling interval

export class MetricsCollector {
  hits = 0;
  misses = 0;
  sets = 0;
  deletes = 0;

  private readonly startedAt = Date.now();
  private latenciesUs: number[] = [];
  private latencyIdx = 0;
  // opTimestamps is a queue pruned from the front on every op (the hot
  // path), so a head pointer + occasional compaction is used instead of
  // Array.shift(), which is O(n) per call because it re-indexes every
  // remaining element. The head only ever grows; the backing array is
  // physically trimmed (splice) once the discarded prefix gets large
  // enough to matter, so memory doesn't grow unbounded either.
  private opTimestamps: number[] = [];
  private opTimestampsHead = 0;
  // Running sum lets avgUs be O(1) instead of re-summing (or sorting) the
  // whole latency buffer on every snapshot() call. Adjusted for whichever
  // sample the ring buffer overwrites, so it always matches latenciesUs.
  private latencySum = 0;
  private historyTimer?: NodeJS.Timeout;
  private historyEntries: MetricsHistoryEntry[] = [];

  /** Record one completed operation and how long it took (microseconds). */
  record(op: OpType, latencyUs: number, hit?: boolean): void {
    if (op === "get") hit ? this.hits++ : this.misses++;
    else if (op === "set") this.sets++;
    else this.deletes++;

    if (this.latenciesUs.length < LATENCY_SAMPLE_CAP) {
      this.latenciesUs.push(latencyUs);
      this.latencySum += latencyUs;
    } else {
      // Overwrite oldest sample so the buffer tracks recent behaviour.
      this.latencySum += latencyUs - this.latenciesUs[this.latencyIdx]!;
      this.latenciesUs[this.latencyIdx] = latencyUs;
      this.latencyIdx = (this.latencyIdx + 1) % LATENCY_SAMPLE_CAP;
    }

    const now = Date.now();
    this.opTimestamps.push(now);
    const cutoff = now - THROUGHPUT_WINDOW_MS;
    while (
      this.opTimestampsHead < this.opTimestamps.length &&
      this.opTimestamps[this.opTimestampsHead]! < cutoff
    ) {
      this.opTimestampsHead++;
    }
    // Physically drop the stale prefix once it's a meaningful fraction of
    // the array, so opTimestamps can't grow forever under sustained load
    // -- amortized O(1), unlike shifting on every single push.
    if (this.opTimestampsHead > 256 && this.opTimestampsHead * 2 > this.opTimestamps.length) {
      this.opTimestamps = this.opTimestamps.slice(this.opTimestampsHead);
      this.opTimestampsHead = 0;
    }
  }

  get uptimeSec(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  snapshot(): MetricsSnapshot {
    const reads = this.hits + this.misses;
    // p95 genuinely needs order statistics, so this sort stays -- but avg
    // no longer needs it (see latencySum, updated incrementally in record()).
    const sorted = [...this.latenciesUs].sort((a, b) => a - b);
    const avg = this.latenciesUs.length > 0 ? this.latencySum / this.latenciesUs.length : null;
    // Nearest-rank percentile: rank = ceil(p * N), 1-indexed. The previous
    // Math.floor(N * 0.95) undercounts the rank by one whenever N * 0.95 is
    // already an integer (any N that's a multiple of 20) -- e.g. for 20
    // samples it picked index 19, the single largest sample (the 100th
    // percentile), not the 95th.
    const p95 =
      sorted.length > 0
        ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))]!
        : null;

    // record() only prunes opTimestampsHead forward when a new op arrives,
    // so during an idle read (no ops since the window closed) the head can
    // be stale by the time /metrics is polled. Binary-search for the first
    // still-live timestamp instead of re-filtering the whole array -- the
    // array is already sorted (timestamps are pushed in increasing order).
    const now = Date.now();
    const cutoff = now - THROUGHPUT_WINDOW_MS;
    let lo = this.opTimestampsHead;
    let hi = this.opTimestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.opTimestamps[mid]! < cutoff) lo = mid + 1;
      else hi = mid;
    }
    const recentCount = this.opTimestamps.length - lo;

    return {
      uptimeSec: this.uptimeSec,
      hits: this.hits,
      misses: this.misses,
      hitRate: reads > 0 ? this.hits / reads : null,
      sets: this.sets,
      deletes: this.deletes,
      opsPerSec: recentCount / (THROUGHPUT_WINDOW_MS / 1000),
      latency: {
        avgUs: avg !== null ? Math.round(avg * 100) / 100 : null,
        p95Us: p95,
        samples: sorted.length,
      },
    };
  }

  /** Start periodically appending a snapshot() to the bounded history ring
      buffer. Same start/stop/unref pattern as CacheStore's sweeper -- a
      background timer here shouldn't keep the process alive on its own,
      and calling this twice restarts cleanly instead of leaking a second
      interval. */
  startHistory(intervalMs = 10_000): void {
    this.stopHistory();
    this.historyTimer = setInterval(() => {
      this.historyEntries = [
        ...this.historyEntries.slice(-(HISTORY_CAP - 1)),
        { at: Date.now(), ...this.snapshot() },
      ];
    }, intervalMs);
    this.historyTimer.unref?.();
  }

  stopHistory(): void {
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = undefined;
    }
  }

  /** Up to the last HISTORY_CAP periodic snapshots, oldest first. Empty
      until startHistory() has been running for at least one interval. */
  get history(): MetricsHistoryEntry[] {
    return this.historyEntries;
  }
}
