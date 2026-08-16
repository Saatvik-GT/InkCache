/**
 * Candidate-side leader election (multi-replica-safe automatic
 * promotion, part 3 of N): the network calls that turn
 * src/core/election.ts's pure term/vote logic into an actual election
 * against real peers over HTTP. Kept separate from election.ts itself
 * (network vs. pure logic) and from server.ts (network mechanics vs.
 * "when do we call this" policy), matching the split already used for
 * primary-monitor.ts (sensing) vs. server.ts (deciding).
 */

import { authHeader } from "./auth.js";
import { hasMajority } from "../core/election.js";

/** Requests a vote from one peer, tolerating any failure (network
    error, timeout, non-2xx, malformed response) as simply "no vote" --
    an unreachable peer during an election is exactly the kind of
    thing a real cluster has to keep working through, not a reason to
    abort the whole election. */
async function requestVoteFrom(
  peerUrl: string,
  term: number,
  candidateId: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${peerUrl}/election/request-vote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(apiKey) },
      body: JSON.stringify({ term, candidateId }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { voteGranted?: unknown };
    return body.voteGranted === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ElectionResult {
  won: boolean;
  term: number;
  votes: number;
  totalNodes: number;
}

/**
 * Runs one full election round: advances `election`'s term, votes for
 * itself, requests a vote from every peer in parallel, and reports
 * whether it won a majority of the full peer set (peers + the
 * candidate itself). Does **not** promote anything or announce a
 * winner -- purely the vote-counting mechanics; the caller decides
 * what winning means (server.ts calls promoteToPrimary() +
 * announceLeader() below).
 */
export async function runElection(
  peerUrls: readonly string[],
  candidateId: string,
  startElection: () => number,
  apiKey?: string,
  timeoutMs = 1000,
): Promise<ElectionResult> {
  const term = startElection();
  const grants = await Promise.all(
    peerUrls.map((peerUrl) => requestVoteFrom(peerUrl, term, candidateId, apiKey, timeoutMs)),
  );
  const votes = 1 + grants.filter(Boolean).length; // +1: the candidate's own vote for itself
  const totalNodes = peerUrls.length + 1;
  return { won: hasMajority(votes, totalNodes), term, votes, totalNodes };
}

/** Announces a won election to every peer, fire-and-forget -- same
    "never block the caller, log and move on" shape as
    replication.ts's forwardToReplicas(), for the same reason: the
    candidate has already won (a majority already voted for it), so a
    slow or unreachable peer here doesn't change that outcome, it just
    means that one peer catches up later (its own next failed
    primary-health-check streak would trigger it to call for a vote
    itself, observe the higher term via /election/request-vote's
    response, and fall in line). */
export function announceLeader(
  peerUrls: readonly string[],
  term: number,
  primaryUrl: string,
  apiKey?: string,
): void {
  for (const peerUrl of peerUrls) {
    fetch(`${peerUrl}/election/leader`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(apiKey) },
      body: JSON.stringify({ term, primaryUrl }),
    }).catch((err: unknown) => {
      console.warn(
        `[inkcache] failed to announce leadership to ${peerUrl}: ${(err as Error).message}`,
      );
    });
  }
}
