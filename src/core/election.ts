/**
 * Leader-election term/vote bookkeeping (safe multi-replica automatic
 * promotion, part 1). This is deliberately *just* Raft's RequestVote
 * subset -- term numbers and a per-term vote lock -- not a full Raft
 * implementation. InkCache doesn't need a replicated log via this
 * mechanism; primary-to-replica data replication already exists
 * (replication.ts's forwardToReplicas/syncFromPrimary). What was
 * missing was purely the "at most one node wins leadership in a given
 * term" guarantee, and that's what a term + majority vote count gives
 * you on its own, without log replication attached.
 *
 * The core safety property, and the only one that actually matters
 * here: within a single term, this state grants a "yes" vote to at
 * most one distinct candidate. Two candidates campaigning in the same
 * term can't both collect a majority of the same fixed peer set's
 * votes, because "majority" already implies overlap -- any two
 * majorities of the same set share at least one member, and that
 * shared member can only have voted for one of them. That overlap
 * argument is *why* a majority requirement prevents split-brain, not
 * just a rule stated by convention.
 */

export interface VoteResult {
  voteGranted: boolean;
  term: number;
}

export class ElectionState {
  private currentTerm = 0;
  private votedFor: string | undefined;

  constructor(private readonly selfId: string) {}

  get term(): number {
    return this.currentTerm;
  }

  /** Advances to a new term and votes for `candidateId`. Newer terms
      always supersede older ones and start a fresh vote lock -- unlike
      requestVote() below, this never rejects, since a node observing a
      higher term always adopts it (standard Raft term-comparison
      rule). */
  observeTerm(term: number, candidateId?: string): void {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = candidateId;
    }
  }

  /** Starts this node's own candidacy: advances to the next term and
      votes for itself. Returns the new term to campaign with. */
  startElection(): number {
    this.currentTerm++;
    this.votedFor = this.selfId;
    return this.currentTerm;
  }

  /** Decides whether to grant a vote to `candidateId` for `term`,
      per Raft's RequestVote rule: reject anything from an older term
      outright; a newer term always resets the per-term vote lock (this
      node hasn't voted in it yet); within the *current* term, grant at
      most one distinct candidate a "yes" -- a repeat request from the
      same already-voted-for candidate still grants (safe to retry a
      dropped response), but a different candidate in the same term is
      refused. This per-term lock is the entire safety mechanism: it's
      what makes two majorities in the same term mutually exclusive. */
  requestVote(term: number, candidateId: string): VoteResult {
    if (term < this.currentTerm) {
      return { voteGranted: false, term: this.currentTerm };
    }
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = undefined;
    }
    if (this.votedFor === undefined || this.votedFor === candidateId) {
      this.votedFor = candidateId;
      return { voteGranted: true, term: this.currentTerm };
    }
    return { voteGranted: false, term: this.currentTerm };
  }
}

/** True once `votes` (including the candidate's own vote for itself)
    is more than half of `totalNodes` (the candidate plus its peers).
    Pulled out as its own function because "majority" is easy to get
    subtly wrong at the boundary (a tie is not a majority) and this is
    exactly the kind of one-line logic worth a dedicated test rather
    than inlined and trusted. */
export function hasMajority(votes: number, totalNodes: number): boolean {
  return votes > totalNodes / 2;
}
