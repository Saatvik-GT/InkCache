import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMetrics, type NodeMetrics } from "../lib/api";
import { logEvent } from "../lib/log";

export type NodeStatus = "connecting" | "online" | "offline";

/**
 * Polls /metrics on an interval. Poll success doubles as the health signal:
 * the node is "online" exactly when it answers. Also diffs the eviction
 * counter between polls so LRU evictions surface in the op stream even
 * though they happen server-side.
 */
export function useNode(pollMs = 1000): {
  metrics: NodeMetrics | null;
  status: NodeStatus;
  refreshNow: () => void;
} {
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);
  const [status, setStatus] = useState<NodeStatus>("connecting");
  const prevEvictions = useRef<number | null>(null);
  const statusRef = useRef<NodeStatus>("connecting");

  const tick = useCallback(async () => {
    try {
      const m = await fetchMetrics();
      if (statusRef.current === "offline") {
        logEvent("set", `link restored to ${m.node}`);
      }
      statusRef.current = "online";
      setStatus("online");
      setMetrics(m);
      if (prevEvictions.current !== null && m.evictions > prevEvictions.current) {
        const n = m.evictions - prevEvictions.current;
        logEvent("evict", `lru evicted ${n} key${n > 1 ? "s" : ""} (total ${m.evictions})`);
      }
      prevEvictions.current = m.evictions;
    } catch {
      if (statusRef.current === "online") {
        logEvent("err", "lost contact with node");
      }
      statusRef.current = "offline";
      setStatus("offline");
    }
  }, []);

  useEffect(() => {
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => clearInterval(id);
  }, [tick, pollMs]);

  return { metrics, status, refreshNow: () => void tick() };
}
