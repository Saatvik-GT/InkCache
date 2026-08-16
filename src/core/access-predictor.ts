/**
 * Access-pattern prediction (roadmap Sprint 5's remaining item:
 * "predictive prefetching"). InkCache has no upstream/origin store to
 * warm data from -- it *is* the store -- so a cache-internal prefetcher
 * has no meaningful target to fetch into. What's real and buildable
 * instead: track which key tends to get read right after which other
 * key (a first-order Markov / bigram frequency table over the global
 * GET stream), and expose the prediction so a *client* can decide to
 * proactively fetch a key it's likely to need next -- the same idea as
 * an HTTP Link: rel=prefetch hint, just server-observed instead of
 * author-declared.
 *
 * This is a statistical heuristic, not a trained/learned model -- same
 * honesty this project already applies to access-aware eviction (see
 * cache.ts's own header comment). No neural net, no training step, just
 * frequency counting with a bound on memory.
 *
 * One real limitation worth stating plainly: the GET stream has no
 * client/session identity in this API, so "key A then key B" transitions
 * from different concurrent clients interleave into one global stream.
 * For a single logical traffic source (the common case for a small
 * demo node, and exactly what the dashboard's own traffic simulator
 * produces) this still captures real sequential structure; under many
 * truly independent concurrent clients hitting unrelated keys, the
 * signal degrades toward noise. That's a property of not having a
 * session concept, not a bug in the counting itself.
 */

export interface Prediction {
  key: string;
  count: number;
  /** count / total observations of a transition away from the queried
      key -- how often this specific next-key followed it, of all the
      times something followed it. */
  probability: number;
}

const DEFAULT_MAX_TRACKED_KEYS = 2000;
const DEFAULT_MAX_CANDIDATES_PER_KEY = 20;

export class AccessPredictor {
  private transitions = new Map<string, Map<string, number>>();
  private lastKey: string | undefined;
  private readonly maxTrackedKeys: number;
  private readonly maxCandidatesPerKey: number;

  constructor(
    maxTrackedKeys = DEFAULT_MAX_TRACKED_KEYS,
    maxCandidatesPerKey = DEFAULT_MAX_CANDIDATES_PER_KEY,
  ) {
    this.maxTrackedKeys = maxTrackedKeys;
    this.maxCandidatesPerKey = maxCandidatesPerKey;
  }

  /** Records that `key` was just requested, incrementing the transition
      count from whatever key preceded it (if any) to this one. Call
      once per GET, regardless of hit/miss -- what a client asks for is
      part of the access pattern even when the answer isn't cached. */
  record(key: string): void {
    const from = this.lastKey;
    this.lastKey = key;
    if (from === undefined || from === key) return;

    let candidates = this.transitions.get(from);
    if (!candidates) {
      // Bound the number of distinct "from" keys tracked -- without
      // this, a high-cardinality or adversarial key stream grows this
      // map forever. Evict the oldest-inserted entry (Map iteration
      // order is insertion order), same simple bounding strategy the
      // ring buffers elsewhere in this codebase use.
      if (this.transitions.size >= this.maxTrackedKeys) {
        const oldest = this.transitions.keys().next().value;
        if (oldest !== undefined) this.transitions.delete(oldest);
      }
      candidates = new Map();
      this.transitions.set(from, candidates);
    }

    candidates.set(key, (candidates.get(key) ?? 0) + 1);
    if (candidates.size > this.maxCandidatesPerKey) {
      // Drop the single least-observed candidate to make room -- keeps
      // per-key memory bounded regardless of how many distinct keys
      // have ever followed it.
      let worstKey: string | undefined;
      let worstCount = Infinity;
      for (const [k, c] of candidates) {
        if (c < worstCount) {
          worstCount = c;
          worstKey = k;
        }
      }
      if (worstKey !== undefined) candidates.delete(worstKey);
    }
  }

  /** The `topN` keys most likely to be requested next, given that `key`
      was just requested -- highest count first, ties broken by
      insertion order. Empty if `key` has never been followed by
      anything (including if it's never been seen at all). */
  predict(key: string, topN = 3): Prediction[] {
    const candidates = this.transitions.get(key);
    if (!candidates || candidates.size === 0) return [];
    const total = [...candidates.values()].reduce((sum, c) => sum + c, 0);
    return [...candidates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([k, count]) => ({ key: k, count, probability: count / total }));
  }

  /** Number of distinct "from" keys currently tracked -- for
      introspection/metrics, not used by predict() itself. */
  get size(): number {
    return this.transitions.size;
  }
}
