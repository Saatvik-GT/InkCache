import { useEffect, useState } from "react";
import { fetchKeys } from "../lib/api";
import { Panel } from "./Panel";

/**
 * Live list of keys currently in the store. Polls independently on a slower
 * cadence than metrics since the list itself is cheap but rarely the thing
 * you're staring at.
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
      <div className="h-32 overflow-y-auto leading-5">
        {keys === null ? (
          <p className="text-phos-mid">-- no signal --</p>
        ) : keys.length === 0 ? (
          <p className="text-phos-dim">-- store empty --</p>
        ) : (
          keys.map((k) => (
            <div key={k} className="truncate text-phos">
              {k}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
