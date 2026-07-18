import { useEffect, useState } from "react";
import { fetchKeys } from "../lib/api";
import { Panel } from "./Panel";

/**
 * Live list of keys currently in the store, rendered as sunken chips.
 * Polls independently on a slower cadence than metrics since the list
 * itself is cheap but rarely the thing you're staring at.
 */
export function KeysPanel({ refreshToken }: { refreshToken: number }) {
  const [keys, setKeys] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchKeys()
      .then((res) => {
        if (!cancelled) setKeys(res.keys);
      })
      .catch(() => {
        if (!cancelled) setKeys(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return (
    <Panel title="KEYS" right={keys ? `${keys.length} live` : "--"}>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
        {keys === null ? (
          <p className="text-ink-mid">-- no signal --</p>
        ) : keys.length === 0 ? (
          <p className="text-ink-faint">-- store empty --</p>
        ) : (
          keys.map((k) => (
            <span
              key={k}
              className="neu-inset-sm max-w-full truncate rounded-full px-3 py-1 text-xs text-ink"
              title={k}
            >
              {k}
            </span>
          ))
        )}
      </div>
    </Panel>
  );
}
