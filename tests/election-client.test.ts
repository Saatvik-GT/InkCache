import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { announceLeader, runElection } from "../src/network/election-client.js";

/** A minimal peer double: answers /election/request-vote with a fixed
    grant/deny decision (real ElectionState logic is already covered by
    tests/election.test.ts -- this only needs to exercise the network
    call shape) and captures whatever /election/leader announcements it
    receives. */
async function startPeer(vote: boolean): Promise<{
  url: string;
  server: http.Server;
  announcements: Array<{ term: number; primaryUrl: string }>;
}> {
  const announcements: Array<{ term: number; primaryUrl: string }> = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      if (req.url === "/election/request-vote") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ voteGranted: vote, term: body.term }));
      } else if (req.url === "/election/leader") {
        announcements.push({ term: body.term as number, primaryUrl: body.primaryUrl as string });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, announcements };
}

async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("runElection()", () => {
  const servers: http.Server[] = [];
  after(() => {
    for (const s of servers) s.close();
  });

  it("wins with a majority of real yes votes from peers", async () => {
    const a = await startPeer(true);
    const b = await startPeer(true);
    servers.push(a.server, b.server);
    // Candidate + 2 yes-voting peers = 3 votes out of 3 -- a clear majority.
    const result = await runElection([a.url, b.url], "candidate-1", () => 1);
    assert.equal(result.won, true);
    assert.equal(result.votes, 3);
    assert.equal(result.totalNodes, 3);
    assert.equal(result.term, 1);
  });

  it("loses without a majority of real votes", async () => {
    const a = await startPeer(false);
    const b = await startPeer(false);
    servers.push(a.server, b.server);
    // Candidate's own vote + 2 refusals = 1 of 3 -- not a majority.
    const result = await runElection([a.url, b.url], "candidate-1", () => 1);
    assert.equal(result.won, false);
    assert.equal(result.votes, 1);
  });

  it("wins a tie-breaking majority when exactly half the peers vote yes plus itself", async () => {
    const yes = await startPeer(true);
    const no = await startPeer(false);
    servers.push(yes.server, no.server);
    // Candidate + 1 yes + 1 no = 2 votes of 3 -- still a majority (>1.5).
    const result = await runElection([yes.url, no.url], "candidate-1", () => 1);
    assert.equal(result.won, true);
    assert.equal(result.votes, 2);
  });

  it("wins unopposed with zero peers -- its own vote is the whole electorate", async () => {
    const result = await runElection([], "candidate-1", () => 1);
    assert.equal(result.won, true);
    assert.equal(result.votes, 1);
    assert.equal(result.totalNodes, 1);
  });

  it("treats an unreachable peer as a non-vote rather than failing the election", async () => {
    const reachable = await startPeer(true);
    servers.push(reachable.server);
    const result = await runElection(
      [reachable.url, "http://127.0.0.1:1"],
      "candidate-1",
      () => 1,
      undefined,
      300,
    );
    // Candidate + 1 real yes vote = 2 of 3 -- still a majority even
    // though the unreachable peer never responded.
    assert.equal(result.won, true);
    assert.equal(result.votes, 2);
  });

  it("calls startElection() exactly once and uses its returned term", async () => {
    const a = await startPeer(true);
    servers.push(a.server);
    let calls = 0;
    const result = await runElection([a.url], "candidate-1", () => {
      calls++;
      return 42;
    });
    assert.equal(calls, 1);
    assert.equal(result.term, 42);
  });
});

describe("announceLeader()", () => {
  const servers: http.Server[] = [];
  after(() => {
    for (const s of servers) s.close();
  });

  it("posts the term and primaryUrl to every peer", async () => {
    const a = await startPeer(true);
    const b = await startPeer(true);
    servers.push(a.server, b.server);
    announceLeader([a.url, b.url], 5, "http://new-leader:8080");
    await waitUntil(() => a.announcements.length >= 1 && b.announcements.length >= 1);
    assert.deepEqual(a.announcements[0], { term: 5, primaryUrl: "http://new-leader:8080" });
    assert.deepEqual(b.announcements[0], { term: 5, primaryUrl: "http://new-leader:8080" });
  });

  it("does not throw when a peer is unreachable", () => {
    assert.doesNotThrow(() => {
      announceLeader(["http://127.0.0.1:1"], 1, "http://leader:8080");
    });
  });
});
