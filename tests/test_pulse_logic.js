#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "PulseLogic.js"), "utf8")
  .replace(/^\.pragma library\s*/, "");
const Pulse = { Math, Date, Number, String, Array, Object, JSON, isFinite, console };
vm.createContext(Pulse);
vm.runInContext(src, Pulse);

function liveSnapshot(overrides) {
  const snap = Pulse.parseSnapshot(JSON.stringify({
    present: true,
    busy: false,
    sessions: [],
    totals: { sessionCount: 2, tokens: 150, active: 0, actualCostUsd: 0.01, estimatedCostUsd: 0.75 },
    totalsWindow: "last 24h",
    profileCount: 1
  }));
  return Object.assign(snap, overrides || {});
}

assert.strictEqual(Pulse.barLabel(Pulse.demoSnapshot()), "DEMO");
assert.strictEqual(Pulse.barMode(Pulse.demoSnapshot()), "demo");

const err = Pulse.errorSnapshot("unreadable state.db");
assert.strictEqual(Pulse.barLabel(err), "ERR");
assert.strictEqual(Pulse.statusLine(err).startsWith("Error · "), true);

const live = liveSnapshot({ busy: true });
assert.strictEqual(Pulse.barLabel(live), "");
assert.strictEqual(Pulse.barMode(live), "live");
assert.strictEqual(Pulse.statusLine(live), "Busy · Hermes activity");

const stale = Pulse.markStale(live, "probe failed");
assert.strictEqual(Pulse.barLabel(stale), "STALE");
assert.strictEqual(stale.busy, false);
assert.strictEqual(Pulse.statusLine(stale), "Stale · last probe failed");

assert.strictEqual(Pulse.parseSnapshot("").error, "empty probe");
assert.strictEqual(Pulse.barLabel(Pulse.parseSnapshot("{not json")), "ERR");
assert.strictEqual(Pulse.parseSnapshot('{"present":false}').demo, true);
assert.strictEqual(Pulse.parseSnapshot(JSON.stringify({
  present: false,
  error: "unreadable state.db"
})).error, "unreadable state.db");

const mergedStale = Pulse.mergeProbe(live, "");
assert.strictEqual(Pulse.barLabel(mergedStale), "STALE");
assert.strictEqual(mergedStale.totals.tokens, 150);

const kept = Pulse.mergeProbe(mergedStale, "");
assert.strictEqual(kept.totals.tokens, 150);
assert.strictEqual(Pulse.barLabel(kept), "STALE");

const fromDemoToErr = Pulse.mergeProbe(Pulse.demoSnapshot(), "");
assert.strictEqual(Pulse.barLabel(fromDemoToErr), "ERR");

assert.strictEqual(
  Pulse.knownCostUsd(live),
  "$0.0100 actual · ~$0.75 est"
);
assert.strictEqual(
  Pulse.headerTotalsLine(live),
  "last 24h · 150 tokens · $0.0100 actual · ~$0.75 est · 2 sessions"
);

const estimatedOnly = liveSnapshot({
  totals: { sessionCount: 1, tokens: 10, active: 0, estimatedCostUsd: 1.5 }
});
assert.strictEqual(Pulse.knownCostUsd(estimatedOnly), "~$1.50");

const ghost = { active: true, endedAt: null, messageCount: 0, inputTokens: 0, outputTokens: 0 };
assert.strictEqual(Pulse.isGhost(ghost), true);
assert.strictEqual(Pulse.sessionStatus(ghost), "ghost");

const quietOpen = { active: true, endedAt: null, messageCount: 3, inputTokens: 4 };
assert.strictEqual(Pulse.sessionStatus(quietOpen), "active");

const pythonSaidEnded = { active: false, endedAt: null, messageCount: 1, endReason: "" };
assert.strictEqual(Pulse.sessionStatus(pythonSaidEnded), "ended");

assert.strictEqual(
  Pulse.sessionHeading({ title: "Work chat", profile: "work" }, 2),
  "[work] Work chat"
);
assert.strictEqual(
  Pulse.sessionHeading({ title: "Work chat", profile: "work" }, 1),
  "Work chat"
);

const idle = Pulse.sampleAt(0, false, 0.9);
const busy = Pulse.sampleAt(0, true, 0.9);
assert.ok(idle < 0.4, "idle breath stays quiet");
assert.ok(busy > idle, "busy amplitude is higher than idle");

assert.ok(!src.includes("pgrep"));
assert.ok(!src.includes("recently_active"));
assert.strictEqual(Pulse.BUSY_WINDOW_SEC, 30);

console.log("ok - PulseLogic helpers");
