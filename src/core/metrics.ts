/**
 * Node-level metrics collection: op counters, hit rate, latency percentiles,
 * and rolling throughput. All numbers are measured from real operations —
 * nothing here is synthesized.
 */

export type OpType = "get" | "set" | "delete";

const LATENCY_SAMPLE_CAP = 512; // ring buffer size for percentile estimation
const THROUGHPUT_WINDOW_MS = 10_000;

export class MetricsCollector {
  hits = 0;
  misses = 0;
  sets = 0;
  deletes = 0;

  private readonly startedAt = Date.now();
  private latenciesUs: number[] = [];
  private latencyIdx = 0;
  private opTimestamps: number[] = [];

  /** Record one completed operation and how long it took (microseconds). */
  record(op: OpType, latencyUs: number, hit?: boolean): void {
    if (op === "get") hit ? this.hits++ : this.misses++;
    else if (op === "set") this.sets++;
    else this.deletes++;

    if (this.latenciesUs.length < LATENCY_SAMPLE_CAP) {
      this.latenciesUs.push(latencyUs);
    } else {
      // Overwrite oldest sample so the buffer tracks recent behaviour.
      this.latenciesUs[this.latencyIdx] = latencyUs;
      this.latencyIdx = (this.latencyIdx + 1) % LATENCY_SAMPLE_CAP;
    }

    const now = Date.now();
    this.opTimestamps.push(now);
    // Trim anything outside the throughput window; array stays small because
    // it's pruned on every record.
    const cutoff = now - THROUGHPUT_WINDOW_MS;
    while (this.opTimestamps.length > 0 && this.opTimestamps[0]! < cutoff) {
      this.opTimestamps.shift();
    }
  }

  get uptimeSec(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  snapshot(): {
    uptimeSec: number;
    hits: number;
    misses: number;
    hitRate: number | null;
    sets: number;
    deletes: number;
    opsPerSec: number;
    latency: { avgUs: number | null; p95Us: number | null; samples: number };
  } {
    const reads = this.hits + this.misses;
    const sorted = [...this.latenciesUs].sort((a, b) => a - b);
    const avg = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : null;
    const p95 =
      sorted.length > 0
        ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!
        : null;

    const now = Date.now();
    const recent = this.opTimestamps.filter((t) => t >= now - THROUGHPUT_WINDOW_MS);

    return {
      uptimeSec: this.uptimeSec,
      hits: this.hits,
      misses: this.misses,
      hitRate: reads > 0 ? this.hits / reads : null,
      sets: this.sets,
      deletes: this.deletes,
      opsPerSec: recent.length / (THROUGHPUT_WINDOW_MS / 1000),
      latency: {
        avgUs: avg !== null ? Math.round(avg * 100) / 100 : null,
        p95Us: p95,
        samples: sorted.length,
      },
    };
  }
}
