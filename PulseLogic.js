.pragma library

// Neural Pulse helpers. Cost is never estimated here: USD is shown only
// when Hermes stored actual_cost_usd or estimated_cost_usd on a session.

var SAMPLE_COUNT = 48
var POLL_MS = 4000
var FRAME_MS = 46
var BUSY_WINDOW_SEC = 180

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value))
}

function number(value) {
  var n = Number(value)
  return isFinite(n) ? n : 0
}

function demoSnapshot() {
  return {
    present: false,
    demo: true,
    busy: false,
    home: "",
    sessions: [],
    totals: {
      sessionCount: 0,
      tokens: 0,
      active: 0
    }
  }
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
  try {
    var parsed = JSON.parse(String(text || ""))
    if (!parsed || typeof parsed !== "object" || parsed.present !== true)
      return demoSnapshot()
    if (!Array.isArray(parsed.sessions))
      parsed.sessions = []
    if (!parsed.totals || typeof parsed.totals !== "object") {
      parsed.totals = { sessionCount: parsed.sessions.length, tokens: 0, active: 0 }
    }
    parsed.demo = false
    parsed.busy = parsed.busy === true
    return parsed
  } catch (e) {
    return demoSnapshot()
  }
}

function activityFrom(snapshot) {
  if (!snapshot || snapshot.present !== true)
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
  if (actual !== "")
    return actual
  return formatUsd(session.estimatedCostUsd, true)
}

function knownCostUsd(snapshot) {
  if (!snapshot || !snapshot.totals)
    return ""
  var actual = formatUsd(snapshot.totals.actualCostUsd, false)
  if (actual !== "")
    return actual
  return formatUsd(snapshot.totals.estimatedCostUsd, true)
}

function sessionStatus(session) {
  if (!session)
    return "unknown"
  if (session.active === true || session.endedAt == null || session.endedAt === "")
    return "active"
  var reason = String(session.endReason || "").trim()
  if (reason !== "")
    return reason
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

function statusLine(snapshot) {
  if (!snapshot || snapshot.present !== true)
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

function probeSource() {
  return [
    "import json, os, sqlite3, time",
    "from pathlib import Path",
    "",
    "BUSY_WINDOW = 180",
    "",
    "def num(value):",
    "    try:",
    "        n = float(value)",
    "        return n if n > 0 else 0.0",
    "    except (TypeError, ValueError):",
    "        return 0.0",
    "",
    "def token_sum(row):",
    "    total = 0.0",
    "    for key in ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'reasoning_tokens'):",
    "        try:",
    "            total += max(0.0, float(row[key] or 0))",
    "        except (TypeError, ValueError):",
    "            pass",
    "    return int(total)",
    "",
    "def cost_payload(actual, estimated):",
    "    out = {}",
    "    a = num(actual)",
    "    e = num(estimated)",
    "    if a > 0:",
    "        out['actualCostUsd'] = a",
    "    if e > 0:",
    "        out['estimatedCostUsd'] = e",
    "    return out",
    "",
    "def columns(conn, table):",
    "    try:",
    "        return {str(row[1]) for row in conn.execute('PRAGMA table_info(\"%s\")' % table)}",
    "    except sqlite3.Error:",
    "        return set()",
    "",
    "def col(cols, name, fallback):",
    "    return '\"%s\"' % name if name in cols else fallback",
    "",
    "def state_paths():",
    "    home = Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))",
    "    seen = set()",
    "    paths = []",
    "    def add(path):",
    "        try:",
    "            resolved = path.resolve()",
    "        except OSError:",
    "            resolved = path",
    "        if resolved in seen or not path.is_file():",
    "            return",
    "        seen.add(resolved)",
    "        paths.append(path)",
    "    add(home / 'state.db')",
    "    add(Path.home() / '.hermes' / 'state.db')",
    "    profiles = Path.home() / '.hermes' / 'profiles'",
    "    if profiles.is_dir():",
    "        for child in sorted(profiles.iterdir()):",
    "            if child.is_dir():",
    "                add(child / 'state.db')",
    "    return home, paths",
    "",
    "def recently_active(path, now):",
    "    for candidate in (path, Path(str(path) + '-wal')):",
    "        try:",
    "            if 0 <= now - candidate.stat().st_mtime <= BUSY_WINDOW:",
    "                return True",
    "        except OSError:",
    "            pass",
    "    return False",
    "",
    "def scan(path, now):",
    "    sessions = []",
    "    totals = {'sessionCount': 0, 'tokens': 0, 'active': 0}",
    "    actual_sum = 0.0",
    "    estimated_sum = 0.0",
    "    busy = recently_active(path, now)",
    "    try:",
    "        conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=1.5)",
    "    except (OSError, sqlite3.Error):",
    "        return sessions, totals, busy, actual_sum, estimated_sum",
    "    conn.row_factory = sqlite3.Row",
    "    try:",
    "        conn.execute('PRAGMA query_only = ON')",
    "        cols = columns(conn, 'sessions')",
    "        if not {'id', 'started_at'}.issubset(cols):",
    "            return sessions, totals, busy, actual_sum, estimated_sum",
    "        query = (",
    "            'SELECT \"id\" AS id, '",
    "            + col(cols, 'title', 'NULL') + ' AS title, '",
    "            + col(cols, 'source', \"''\") + ' AS source, '",
    "            + col(cols, 'model', 'NULL') + ' AS model, '",
    "            + '\"started_at\" AS started_at, '",
    "            + col(cols, 'ended_at', 'NULL') + ' AS ended_at, '",
    "            + col(cols, 'end_reason', 'NULL') + ' AS end_reason, '",
    "            + col(cols, 'input_tokens', '0') + ' AS input_tokens, '",
    "            + col(cols, 'output_tokens', '0') + ' AS output_tokens, '",
    "            + col(cols, 'cache_read_tokens', '0') + ' AS cache_read_tokens, '",
    "            + col(cols, 'cache_write_tokens', '0') + ' AS cache_write_tokens, '",
    "            + col(cols, 'reasoning_tokens', '0') + ' AS reasoning_tokens, '",
    "            + col(cols, 'estimated_cost_usd', 'NULL') + ' AS estimated_cost_usd, '",
    "            + col(cols, 'actual_cost_usd', 'NULL') + ' AS actual_cost_usd, '",
    "            + col(cols, 'cost_status', 'NULL') + ' AS cost_status, '",
    "            + col(cols, 'message_count', '0') + ' AS message_count '",
    "            + 'FROM sessions ORDER BY started_at DESC LIMIT 24'",
    "        )",
    "        rows = list(conn.execute(query))",
    "        totals['sessionCount'] = len(rows)",
    "        try:",
    "            totals['sessionCount'] = int(conn.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] or 0)",
    "        except sqlite3.Error:",
    "            pass",
    "        for row in rows[:8]:",
    "            ended = row['ended_at']",
    "            active = ended is None",
    "            if active:",
    "                busy = True",
    "                totals['active'] += 1",
    "            payload = {",
    "                'id': str(row['id'] or ''),",
    "                'title': row['title'] or '',",
    "                'source': row['source'] or '',",
    "                'model': row['model'] or '',",
    "                'startedAt': float(row['started_at'] or 0),",
    "                'endedAt': None if ended is None else float(ended),",
    "                'endReason': row['end_reason'] or '',",
    "                'inputTokens': int(num(row['input_tokens'])),",
    "                'outputTokens': int(num(row['output_tokens'])),",
    "                'cacheReadTokens': int(num(row['cache_read_tokens'])),",
    "                'cacheWriteTokens': int(num(row['cache_write_tokens'])),",
    "                'reasoningTokens': int(num(row['reasoning_tokens'])),",
    "                'messageCount': int(num(row['message_count'])),",
    "                'active': active,",
    "            }",
    "            payload.update(cost_payload(row['actual_cost_usd'], row['estimated_cost_usd']))",
    "            totals['tokens'] += token_sum(row)",
    "            actual_sum += num(row['actual_cost_usd'])",
    "            estimated_sum += num(row['estimated_cost_usd'])",
    "            sessions.append(payload)",
    "        extra = rows[8:]",
    "        for row in extra:",
    "            if row['ended_at'] is None:",
    "                busy = True",
    "                totals['active'] += 1",
    "            totals['tokens'] += token_sum(row)",
    "            actual_sum += num(row['actual_cost_usd'])",
    "            estimated_sum += num(row['estimated_cost_usd'])",
    "    except sqlite3.Error:",
    "        pass",
    "    finally:",
    "        conn.close()",
    "    return sessions, totals, busy, actual_sum, estimated_sum",
    "",
    "home, paths = state_paths()",
    "present = home.is_dir() or len(paths) > 0",
    "out = {",
    "    'present': present,",
    "    'demo': not present,",
    "    'busy': False,",
    "    'home': str(home),",
    "    'sessions': [],",
    "    'totals': {'sessionCount': 0, 'tokens': 0, 'active': 0},",
    "}",
    "if not present:",
    "    print(json.dumps(out, separators=(',', ':')))",
    "    raise SystemExit(0)",
    "now = time.time()",
    "all_sessions = []",
    "totals = {'sessionCount': 0, 'tokens': 0, 'active': 0}",
    "actual_sum = 0.0",
    "estimated_sum = 0.0",
    "busy = False",
    "for path in paths:",
    "    sessions, part, part_busy, a, e = scan(path, now)",
    "    all_sessions.extend(sessions)",
    "    totals['sessionCount'] += part['sessionCount']",
    "    totals['tokens'] += part['tokens']",
    "    totals['active'] += part['active']",
    "    actual_sum += a",
    "    estimated_sum += e",
    "    busy = busy or part_busy",
    "all_sessions.sort(key=lambda item: item.get('startedAt') or 0, reverse=True)",
    "out['sessions'] = all_sessions[:8]",
    "out['busy'] = busy",
    "out['totals'] = totals",
    "if actual_sum > 0:",
    "    out['totals']['actualCostUsd'] = actual_sum",
    "if estimated_sum > 0:",
    "    out['totals']['estimatedCostUsd'] = estimated_sum",
    "print(json.dumps(out, separators=(',', ':')))"
  ].join("\n")
}
