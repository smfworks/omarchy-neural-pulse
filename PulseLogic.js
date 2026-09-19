.pragma library

// Neural Pulse helpers. Cost is never estimated here: USD is shown only
// when Hermes stored actual_cost_usd or estimated_cost_usd on a session.

var SAMPLE_COUNT = 48
var POLL_MS = 4000
var FRAME_MS = 46
var BUSY_WINDOW_SEC = 30

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function number(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

function emptyTotals() {
  return {
    sessionCount: 0,
    tokens: 0,
    active: 0
  }
}

function demoSnapshot() {
  return {
    present: false,
    demo: true,
    busy: false,
    error: "",
    stale: false,
    home: "",
    sessions: [],
    totals: emptyTotals(),
    totalsWindow: "last 24h",
    profileCount: 0
  }
}

function errorSnapshot(message) {
  var snap = demoSnapshot()
  snap.demo = false
  snap.error = message || "probe failed"
  return snap
}

function copySnapshot(snapshot) {
  var next = demoSnapshot()
  if (!snapshot || typeof snapshot !== "object")
    return next
  var key
  for (key in snapshot) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key))
      next[key] = snapshot[key]
  }
  if (!Array.isArray(next.sessions))
    next.sessions = []
  if (!next.totals || typeof next.totals !== "object")
    next.totals = emptyTotals()
  return next
}

function markStale(snapshot, message) {
  var next = copySnapshot(snapshot)
  next.stale = true
  next.busy = false
  next.error = message || next.error || "probe failed"
  return next
}

function emptyBuffer() {
  var buffer = []
  for (var i = 0; i < SAMPLE_COUNT; i++)
    buffer.push(0.22)
  return buffer
}

function sampleAt(t, busy, activity) {
  var breath = 0.5 + 0.5 * Math.sin(t * 1.12)
  var level = clamp(number(activity), 0, 1)
  if (!busy) {
    return 0.18 + 0.14 * breath + 0.04 * Math.sin(t * 2.4 + 0.7)
  }
  var neural = Math.sin(t * 7.4) * 0.28
    + Math.sin(t * 13.05 + 0.4) * 0.2
    + Math.sin(t * 3.35 + 1.1) * 0.16
  var spark = Math.sin(t * 31.0) > 0.94 ? 0.22 : 0
  return clamp(0.4 + level * 0.35 + neural + spark + breath * 0.1, 0.08, 1)
}

function pushSample(buffer, value) {
  var next = buffer && buffer.length ? buffer.slice() : emptyBuffer()
  next.push(clamp(number(value), 0, 1))
  while (next.length > SAMPLE_COUNT)
    next.shift()
  return next
}

function parseSnapshot(text) {
  var raw = String(text || "").trim()
  if (raw === "")
    return errorSnapshot("empty probe")
  try {
    var parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object")
      return errorSnapshot("invalid snapshot")
    parsed = copySnapshot(parsed)
    parsed.error = parsed.error ? String(parsed.error) : ""
    parsed.stale = parsed.stale === true
    parsed.busy = parsed.busy === true
    parsed.profileCount = number(parsed.profileCount)
    if (!parsed.totalsWindow)
      parsed.totalsWindow = "last 24h"
    if (parsed.error && parsed.present !== true) {
      parsed.demo = false
      parsed.present = false
      parsed.busy = false
      return parsed
    }
    if (parsed.present !== true) {
      var demo = demoSnapshot()
      demo.home = parsed.home || ""
      return demo
    }
    parsed.demo = false
    parsed.present = true
    return parsed
  } catch (e) {
    return errorSnapshot("invalid snapshot")
  }
}

function mergeProbe(current, text) {
  var next = parseSnapshot(text)
  var live = current && current.present === true && current.stale !== true
  if (next && next.present === true)
    return next
  if (next && next.demo === true && !next.error)
    return next
  if (live)
    return markStale(current, next && next.error ? next.error : "probe failed")
  if (current && current.stale === true && current.present === true)
    return current
  if (current && current.error && current.present !== true)
    return current
  return next && next.error ? next : errorSnapshot("probe failed")
}

function barMode(snapshot) {
  if (!snapshot)
    return "demo"
  if (snapshot.stale === true)
    return "stale"
  if (snapshot.error)
    return "err"
  if (snapshot.present !== true)
    return "demo"
  return "live"
}

function barLabel(snapshot) {
  var mode = barMode(snapshot)
  if (mode === "err")
    return "ERR"
  if (mode === "stale")
    return "STALE"
  if (mode === "demo")
    return "DEMO"
  return ""
}

function activityFrom(snapshot) {
  if (!snapshot || snapshot.present !== true || snapshot.stale === true)
    return 0
  if (snapshot.busy)
    return 0.88
  var active = number(snapshot.totals && snapshot.totals.active)
  if (active > 0)
    return 0.72
  var tokens = number(snapshot.totals && snapshot.totals.tokens)
  if (tokens > 0)
    return clamp(0.16 + Math.log(tokens + 1) / 14, 0.16, 0.55)
  return 0.12
}

function formatTokens(value) {
  var n = Math.round(number(value))
  if (n <= 0)
    return "0"
  if (n < 1000)
    return String(n)
  if (n < 1000000) {
    var k = n / 1000
    return (k >= 10 ? k.toFixed(0) : k.toFixed(1)) + "k"
  }
  var m = n / 1000000
  return (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + "m"
}

function sessionTokens(session) {
  if (!session)
    return 0
  return Math.max(0, Math.round(
    number(session.inputTokens)
    + number(session.outputTokens)
    + number(session.cacheReadTokens)
    + number(session.cacheWriteTokens)
    + number(session.reasoningTokens)
  ))
}

function isGhost(session) {
  if (!session)
    return false
  var ended = session.endedAt
  var open = session.active === true || ended == null || ended === ""
  if (!open)
    return false
  return number(session.messageCount) <= 0 && sessionTokens(session) <= 0
}

function formatUsd(amount, estimated) {
  if (typeof amount !== "number" || !isFinite(amount) || amount <= 0)
    return ""
  var digits = amount >= 0.1 ? 2 : 4
  return (estimated ? "~$" : "$") + amount.toFixed(digits)
}

function formatCost(session) {
  if (!session)
    return ""
  var actual = formatUsd(session.actualCostUsd, false)
  var estimated = formatUsd(session.estimatedCostUsd, true)
  if (actual !== "" && estimated !== "")
    return actual + " actual · " + estimated + " est"
  if (actual !== "")
    return actual
  return estimated
}

function knownCostUsd(snapshot) {
  if (!snapshot || !snapshot.totals)
    return ""
  var actual = formatUsd(snapshot.totals.actualCostUsd, false)
  var estimated = formatUsd(snapshot.totals.estimatedCostUsd, true)
  if (actual !== "" && estimated !== "")
    return actual + " actual · " + estimated + " est"
  if (actual !== "")
    return actual
  return estimated
}

function headerTotalsLine(snapshot) {
  if (!snapshot || snapshot.present !== true || !snapshot.totals)
    return ""
  var bits = []
  var windowLabel = String(snapshot.totalsWindow || "").trim()
  if (windowLabel !== "")
    bits.push(windowLabel)
  bits.push(formatTokens(snapshot.totals.tokens) + " tokens")
  var cost = knownCostUsd(snapshot)
  if (cost !== "")
    bits.push(cost)
  var count = number(snapshot.totals.sessionCount)
  bits.push(count + " session" + (count === 1 ? "" : "s"))
  var profiles = number(snapshot.profileCount)
  if (profiles > 1)
    bits.push(profiles + " profiles")
  return bits.join(" · ")
}

function sessionStatus(session) {
  if (!session)
    return "unknown"
  if (isGhost(session))
    return "ghost"
  if (session.active === true)
    return "active"
  var reason = String(session.endReason || "").trim()
  if (reason !== "")
    return reason
  if (session.endedAt == null || session.endedAt === "")
    return "ended"
  return "ended"
}

function relativeTime(epochSec, nowSec) {
  var ts = number(epochSec)
  if (ts <= 0)
    return ""
  var now = number(nowSec) || (Date.now() / 1000)
  var delta = Math.max(0, now - ts)
  if (delta < 60)
    return "just now"
  if (delta < 3600)
    return Math.floor(delta / 60) + "m ago"
  if (delta < 86400)
    return Math.floor(delta / 3600) + "h ago"
  return Math.floor(delta / 86400) + "d ago"
}

function sessionTitle(session) {
  if (!session)
    return "Session"
  var title = String(session.title || "").trim()
  if (title !== "")
    return title
  var model = String(session.model || "").trim()
  if (model !== "")
    return model
  var id = String(session.id || "")
  if (id.length > 10)
    return id.substring(0, 8)
  return id || "Untitled session"
}

function sessionHeading(session, profileCount) {
  var title = sessionTitle(session)
  if (number(profileCount) > 1 && session && session.profile)
    return "[" + String(session.profile) + "] " + title
  return title
}

function statusLine(snapshot) {
  if (!snapshot)
    return "Demo idle · ~/.hermes not found"
  var mode = barMode(snapshot)
  if (mode === "stale")
    return "Stale · last probe failed"
  if (mode === "err")
    return "Error · " + (snapshot.error || "probe failed")
  if (mode === "demo")
    return "Demo idle · ~/.hermes not found"
  if (snapshot.busy)
    return "Busy · Hermes activity"
  var active = number(snapshot.totals && snapshot.totals.active)
  if (active > 0)
    return active === 1 ? "1 live session" : active + " live sessions"
  var count = number(snapshot.totals && snapshot.totals.sessionCount)
  if (count > 0)
    return "Idle · " + count + " logged session" + (count === 1 ? "" : "s")
  return "Idle · no sessions yet"
}
