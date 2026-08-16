import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ElectionState, hasMajority } from "../src/core/election.js";

describe("ElectionState basics", () => {
  it("starts at term 0", () => {
    const s = new ElectionState("a");
    assert.equal(s.term, 0);
  });

  it("startElection() advances the term and returns it", () => {
    const s = new ElectionState("a");
    assert.equal(s.startElection(), 1);
    assert.equal(s.term, 1);
    assert.equal(s.startElection(), 2);
    assert.equal(s.term, 2);
  });

  it("grants a vote for a new term it hasn't seen before", () => {
    const s = new ElectionState("a");
    const result = s.requestVote(1, "b");
    assert.equal(result.voteGranted, true);
    assert.equal(result.term, 1);
  });

  it("grants a repeat vote for the same candidate in the same term", () => {
    const s = new ElectionState("a");
    s.requestVote(1, "b");
    const again = s.requestVote(1, "b");
    assert.equal(again.voteGranted, true);
  });

  it("refuses a second, different candidate in the same term", () => {
    const s = new ElectionState("a");
    assert.equal(s.requestVote(1, "b").voteGranted, true);
    assert.equal(s.requestVote(1, "c").voteGranted, false);
  });

  it("refuses a vote request for an older term than it has already seen", () => {
    const s = new ElectionState("a");
    s.requestVote(5, "b");
    const stale = s.requestVote(3, "c");
    assert.equal(stale.voteGranted, false);
    assert.equal(stale.term, 5);
  });

  it("a higher term resets the vote lock, even for a candidate already refused this term", () => {
    const s = new ElectionState("a");
    s.requestVote(1, "b");
    assert.equal(s.requestVote(1, "c").voteGranted, false);
    // "c" campaigns again in a genuinely new term -- should now succeed.
    assert.equal(s.requestVote(2, "c").voteGranted, true);
  });

  it("startElection() locks in its own vote -- a peer's request in that same term is refused", () => {
    const s = new ElectionState("a");
    s.startElection(); // term 1, voted for self ("a")
    assert.equal(s.requestVote(1, "other-candidate").voteGranted, false);
  });

  it("observeTerm() adopts a higher term without granting anything", () => {
    const s = new ElectionState("a");
    s.observeTerm(5, "leader-x");
    assert.equal(s.term, 5);
    // The term is now current, so a same-term vote request for a
    // *different* candidate than what observeTerm recorded is refused --
    // observeTerm's candidateId argument sets the vote lock too.
    assert.equal(s.requestVote(5, "someone-else").voteGranted, false);
  });

  it("observeTerm() ignores a term that isn't actually higher", () => {
    const s = new ElectionState("a");
    s.startElection(); // term 1
    s.observeTerm(1, "irrelevant");
    assert.equal(s.term, 1);
    // Original self-vote lock from startElection() is untouched.
    assert.equal(s.requestVote(1, "other").voteGranted, false);
  });
});

describe("ElectionState safety property: at most one candidate wins a vote per term", () => {
  it("across many randomized concurrent-looking candidacies in the same term, no voter ever grants two different candidates", () => {
    // Simulates N voters (a fixed peer set) each fielding vote requests
    // from several competing candidates for the *same* term, in random
    // order -- the real-world shape of two replicas racing to promote
    // at once. Every single voter must end up having granted at most
    // one distinct candidate for that term.
    const voters = Array.from({ length: 7 }, (_, i) => new ElectionState(`voter-${i}`));
    const candidates = ["candidate-a", "candidate-b", "candidate-c"];
    const term = 1;

    const grantedTo = new Map<ElectionState, string>();
    // Interleave requests across all (voter, candidate) pairs in a
    // shuffled order to simulate real network-timing nondeterminism.
    const pairs: Array<[ElectionState, string]> = [];
    for (const voter of voters) {
      for (const candidate of candidates) pairs.push([voter, candidate]);
    }
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pairs[i], pairs[j]] = [pairs[j]!, pairs[i]!];
    }

    for (const [voter, candidate] of pairs) {
      const { voteGranted } = voter.requestVote(term, candidate);
      if (voteGranted) {
        const already = grantedTo.get(voter);
        assert.ok(
          already === undefined || already === candidate,
          `voter granted votes to two different candidates (${already} and ${candidate}) in the same term`,
        );
        grantedTo.set(voter, candidate);
      }
    }

    // With a fixed 7-voter pool and majority = 4, it's structurally
    // impossible for two candidates to each collect 4+ of the same 7
    // votes (4+4 > 7) -- confirm that held in this run, not just that
    // no single voter double-granted.
    const countsByCandidate = new Map<string, number>();
    for (const c of grantedTo.values()) {
      countsByCandidate.set(c, (countsByCandidate.get(c) ?? 0) + 1);
    }
    const winners = [...countsByCandidate.entries()].filter(([, count]) =>
      hasMajority(count, voters.length),
    );
    assert.ok(winners.length <= 1, `more than one candidate achieved a majority: ${winners}`);
  });
});

describe("hasMajority()", () => {
  it("requires strictly more than half", () => {
    assert.equal(hasMajority(2, 5), false);
    assert.equal(hasMajority(3, 5), true);
  });

  it("a tie is not a majority", () => {
    assert.equal(hasMajority(2, 4), false);
    assert.equal(hasMajority(3, 4), true);
  });

  it("a single-node cluster: one vote (itself) is a majority", () => {
    assert.equal(hasMajority(1, 1), true);
  });

  it("zero votes out of zero nodes is not a majority (no election to win)", () => {
    assert.equal(hasMajority(0, 0), false);
  });
});
