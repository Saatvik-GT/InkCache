import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AccessPredictor } from "../src/core/access-predictor.js";

describe("AccessPredictor basics", () => {
  it("predicts nothing for a key that's never been seen", () => {
    const p = new AccessPredictor();
    assert.deepEqual(p.predict("never-seen"), []);
  });

  it("predicts nothing for the very first key recorded -- no predecessor to link from", () => {
    const p = new AccessPredictor();
    p.record("a");
    assert.deepEqual(p.predict("a"), []);
  });

  it("learns a single transition and predicts it back", () => {
    const p = new AccessPredictor();
    p.record("a");
    p.record("b");
    const predictions = p.predict("a");
    assert.equal(predictions.length, 1);
    assert.equal(predictions[0]!.key, "b");
    assert.equal(predictions[0]!.count, 1);
    assert.equal(predictions[0]!.probability, 1);
  });

  it("does not record a self-transition (a key immediately followed by itself)", () => {
    const p = new AccessPredictor();
    p.record("a");
    p.record("a");
    p.record("a");
    assert.deepEqual(p.predict("a"), []);
  });

  it("counts repeated transitions and ranks the most frequent first", () => {
    const p = new AccessPredictor();
    // a -> b three times, a -> c once
    for (let i = 0; i < 3; i++) {
      p.record("a");
      p.record("b");
    }
    p.record("a");
    p.record("c");

    const predictions = p.predict("a");
    assert.equal(predictions[0]!.key, "b");
    assert.equal(predictions[0]!.count, 3);
    assert.equal(predictions[1]!.key, "c");
    assert.equal(predictions[1]!.count, 1);
  });

  it("reports probability as a share of all observed transitions from that key", () => {
    const p = new AccessPredictor();
    for (let i = 0; i < 3; i++) {
      p.record("a");
      p.record("b");
    }
    p.record("a");
    p.record("c");

    const predictions = p.predict("a");
    const b = predictions.find((x) => x.key === "b")!;
    const c = predictions.find((x) => x.key === "c")!;
    assert.equal(b.probability, 0.75);
    assert.equal(c.probability, 0.25);
  });

  it("honours topN, returning only the N most frequent candidates", () => {
    const p = new AccessPredictor();
    for (const next of ["b", "c", "d"]) {
      p.record("a");
      p.record(next);
    }
    // b, c, d each observed once -- topN=2 should return exactly 2.
    assert.equal(p.predict("a", 2).length, 2);
    assert.equal(p.predict("a", 100).length, 3);
  });

  it("tracks transitions independently per source key", () => {
    const p = new AccessPredictor();
    p.record("a");
    p.record("x");
    p.record("b");
    p.record("y");

    assert.deepEqual(
      p.predict("a").map((x) => x.key),
      ["x"],
    );
    assert.deepEqual(
      p.predict("b").map((x) => x.key),
      ["y"],
    );
  });

  it("exposes size as the number of distinct source keys tracked", () => {
    const p = new AccessPredictor();
    assert.equal(p.size, 0);
    p.record("a");
    p.record("b");
    assert.equal(p.size, 1);
    p.record("c");
    assert.equal(p.size, 2);
  });
});

describe("AccessPredictor bounded memory", () => {
  it("evicts the oldest source key once maxTrackedKeys is exceeded", () => {
    // record() links every consecutive call in one global chain, so
    // a,x,b,y,c,z records the transitions a->x, x->b, b->y, y->c, c->z
    // (not just the "a->x, b->y, c->z" pairs one might read from the
    // sequence at a glance) -- five distinct "from" keys in insertion
    // order a,x,b,y,c. With a cap of 2, each new "from" key evicts the
    // oldest still-tracked one: inserting b's entry evicts a, inserting
    // c's entry evicts x, inserting z's owner (c) evicts b. What
    // survives at the end is whichever two "from" keys were inserted
    // last: y and c.
    const p = new AccessPredictor(2, 20);
    p.record("a");
    p.record("x");
    p.record("b");
    p.record("y");
    p.record("c");
    p.record("z");

    assert.equal(p.size, 2);
    assert.deepEqual(p.predict("a"), []);
    assert.deepEqual(p.predict("b"), []);
    assert.deepEqual(
      p.predict("y").map((x) => x.key),
      ["c"],
    );
    assert.deepEqual(
      p.predict("c").map((x) => x.key),
      ["z"],
    );
  });

  it("evicts the least-observed candidate once maxCandidatesPerKey is exceeded for one source key", () => {
    const p = new AccessPredictor(100, 2);
    // "a" followed by "x" 5 times, "y" 3 times, "z" once.
    for (let i = 0; i < 5; i++) {
      p.record("a");
      p.record("x");
    }
    for (let i = 0; i < 3; i++) {
      p.record("a");
      p.record("y");
    }
    p.record("a");
    p.record("z"); // pushes candidate count for "a" to 3, over the cap of 2

    const predictions = p.predict("a", 10);
    const keys = predictions.map((pr) => pr.key);
    // "z" (count 1) should have been evicted as the least-observed --
    // "x" and "y" (the two most-observed) survive.
    assert.ok(keys.includes("x"));
    assert.ok(keys.includes("y"));
    assert.ok(!keys.includes("z"));
    assert.equal(predictions.length, 2);
  });
});
