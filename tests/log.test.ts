import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clearLog, getEvents, logEvent } from "../src/dashboard/src/lib/log.js";

describe("log store", () => {
  beforeEach(() => clearLog());

  it("appends events in order", () => {
    logEvent("set", "a");
    logEvent("hit", "b");
    const events = getEvents();
    assert.deepEqual(
      events.map((e) => e.text),
      ["a", "b"],
    );
    assert.equal(events[0]!.kind, "set");
    assert.equal(events[1]!.kind, "hit");
  });

  it("assigns increasing ids so React keys stay stable across re-renders", () => {
    logEvent("set", "a");
    logEvent("set", "b");
    const [first, second] = getEvents();
    assert.ok(second!.id > first!.id);
  });

  it("caps the ring at 200 events, keeping the most recent", () => {
    for (let i = 0; i < 250; i++) logEvent("set", `event-${i}`);
    const events = getEvents();
    assert.equal(events.length, 200);
    assert.equal(events[0]!.text, "event-50");
    assert.equal(events[events.length - 1]!.text, "event-249");
  });

  it("clearLog empties the store", () => {
    logEvent("set", "a");
    clearLog();
    assert.deepEqual(getEvents(), []);
  });
});
