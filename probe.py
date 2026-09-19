#!/usr/bin/env python3
"""Read-only Hermes state.db probe for Neural Pulse.

Busy is a recency window on real session activity (last_activity_at, latest
message time, started_at) — never pgrep or WAL/state.db mtime. Ghost open
stubs (ended_at IS NULL with no messages and no tokens) are filtered.
present requires an opened state.db, not merely a directory.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path

BUSY_WINDOW_SEC = 30
TOTALS_WINDOW_SEC = 24 * 3600
DISPLAY_LIMIT = 8
TOKEN_COLUMNS = (
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
)


def num(value):
    try:
        n = float(value)
        return n if n > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def token_sum(row):
    total = 0.0
    for key in TOKEN_COLUMNS:
        try:
            total += max(0.0, float(row[key] or 0))
        except (TypeError, ValueError, KeyError, IndexError):
            pass
    return int(total)


def epoch(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def cost_payload(actual, estimated):
    out = {}
    a = num(actual)
    e = num(estimated)
    if a > 0:
        out["actualCostUsd"] = a
    if e > 0:
        out["estimatedCostUsd"] = e
    return out


def columns(conn, table):
    try:
        return {str(row[1]) for row in conn.execute('PRAGMA table_info("%s")' % table)}
    except sqlite3.Error:
        return set()


def col(cols, name, fallback):
    return '"%s"' % name if name in cols else fallback


def user_home(environ):
    raw = environ.get("HOME")
    if raw:
        return Path(raw)
    return Path.home()


def hermes_home(environ):
    raw = environ.get("HERMES_HOME")
    if raw:
        return Path(raw)
    return user_home(environ) / ".hermes"


def profile_label(path):
    try:
        parts = Path(path).resolve().parts
    except OSError:
        parts = Path(path).parts
    if len(parts) >= 3 and parts[-1] == "state.db" and parts[-3] == "profiles":
        return parts[-2]
    return "default"


def state_paths(environ=None):
    environ = environ or os.environ
    home = hermes_home(environ)
    default_root = user_home(environ) / ".hermes"
    seen = set()
    paths = []

    def add(path):
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        if resolved in seen or not path.is_file():
            return
        seen.add(resolved)
        paths.append(path)

    add(home / "state.db")
    add(default_root / "state.db")
    for root in (home, default_root):
        profiles = root / "profiles"
        if not profiles.is_dir():
            continue
        try:
            children = sorted(profiles.iterdir())
        except OSError:
            children = []
        for child in children:
            if child.is_dir():
                add(child / "state.db")
    return home, paths


def is_ghost(ended_at, message_count, tokens):
    if ended_at is not None:
        return False
    return int(message_count or 0) <= 0 and int(tokens or 0) <= 0


def recency_of(last_activity_at, message_last, started_at):
    candidates = []
    for value in (last_activity_at, message_last, started_at):
        parsed = epoch(value)
        if parsed is not None:
            candidates.append(parsed)
    return max(candidates) if candidates else 0.0


def empty_totals():
    return {"sessionCount": 0, "tokens": 0, "active": 0}


def demo_snapshot(home=""):
    return {
        "present": False,
        "demo": True,
        "busy": False,
        "error": "",
        "stale": False,
        "home": str(home or ""),
        "sessions": [],
        "totals": empty_totals(),
        "totalsWindow": "last 24h",
        "profileCount": 0,
        "probedAt": 0,
    }


def error_snapshot(message, home=""):
    out = demo_snapshot(home)
    out["demo"] = False
    out["error"] = message or "unreadable state.db"
    return out


def _open_readonly(path):
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=1.5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def _row_get(row, key, default=None):
    try:
        return row[key]
    except (KeyError, IndexError):
        return default


def scan(path, now, profile):
    """Return (sessions, window_rows, opened, error)."""
    sessions = []
    window_rows = []
    try:
        conn = _open_readonly(path)
    except (OSError, sqlite3.Error) as exc:
        return sessions, window_rows, False, "unreadable state.db (%s)" % exc.__class__.__name__

    try:
        cols = columns(conn, "sessions")
        if not {"id", "started_at"}.issubset(cols):
            return sessions, window_rows, False, "state.db missing sessions table"
        msg_cols = columns(conn, "messages")
        has_messages = "timestamp" in msg_cols and "session_id" in msg_cols
        query = (
            'SELECT "id" AS id, '
            + col(cols, "title", "NULL") + " AS title, "
            + col(cols, "source", "''") + " AS source, "
            + col(cols, "model", "NULL") + " AS model, "
            + '"started_at" AS started_at, '
            + col(cols, "ended_at", "NULL") + " AS ended_at, "
            + col(cols, "end_reason", "NULL") + " AS end_reason, "
            + col(cols, "input_tokens", "0") + " AS input_tokens, "
            + col(cols, "output_tokens", "0") + " AS output_tokens, "
            + col(cols, "cache_read_tokens", "0") + " AS cache_read_tokens, "
            + col(cols, "cache_write_tokens", "0") + " AS cache_write_tokens, "
            + col(cols, "reasoning_tokens", "0") + " AS reasoning_tokens, "
            + col(cols, "estimated_cost_usd", "NULL") + " AS estimated_cost_usd, "
            + col(cols, "actual_cost_usd", "NULL") + " AS actual_cost_usd, "
            + col(cols, "message_count", "0") + " AS message_count, "
            + col(cols, "last_activity_at", "NULL") + " AS last_activity_at, "
            + col(cols, "profile_name", "NULL") + " AS profile_name, "
            + col(cols, "archived", "0") + " AS archived "
            + "FROM sessions"
        )
        try:
            rows = list(conn.execute(query))
        except sqlite3.Error as exc:
            return sessions, window_rows, False, "sessions query failed (%s)" % exc.__class__.__name__

        message_last = {}
        if has_messages:
            try:
                for item in conn.execute(
                    "SELECT session_id, MAX(timestamp) AS ts FROM messages GROUP BY session_id"
                ):
                    message_last[str(item["session_id"] or "")] = epoch(item["ts"])
            except sqlite3.Error:
                message_last = {}

        for row in rows:
            archived = int(num(_row_get(row, "archived", 0)))
            if archived:
                continue
            ended = epoch(_row_get(row, "ended_at"))
            tokens = token_sum(row)
            messages = int(num(_row_get(row, "message_count", 0)))
            if is_ghost(ended, messages, tokens):
                continue
            started = epoch(_row_get(row, "started_at")) or 0.0
            last_activity = recency_of(
                _row_get(row, "last_activity_at"),
                message_last.get(str(_row_get(row, "id") or "")),
                started,
            )
            named = str(_row_get(row, "profile_name") or "").strip() or profile
            active = ended is None
            payload = {
                "id": str(_row_get(row, "id") or ""),
                "title": _row_get(row, "title") or "",
                "source": _row_get(row, "source") or "",
                "model": _row_get(row, "model") or "",
                "startedAt": started,
                "endedAt": ended,
                "endReason": _row_get(row, "end_reason") or "",
                "inputTokens": int(num(_row_get(row, "input_tokens"))),
                "outputTokens": int(num(_row_get(row, "output_tokens"))),
                "cacheReadTokens": int(num(_row_get(row, "cache_read_tokens"))),
                "cacheWriteTokens": int(num(_row_get(row, "cache_write_tokens"))),
                "reasoningTokens": int(num(_row_get(row, "reasoning_tokens"))),
                "messageCount": messages,
                "active": active,
                "lastActivityAt": last_activity,
                "profile": named,
            }
            payload.update(cost_payload(_row_get(row, "actual_cost_usd"), _row_get(row, "estimated_cost_usd")))
            sessions.append(payload)
            if last_activity >= now - TOTALS_WINDOW_SEC:
                window_rows.append(payload)
        return sessions, window_rows, True, ""
    finally:
        conn.close()


def _sum_window(rows):
    totals = empty_totals()
    actual_sum = 0.0
    estimated_sum = 0.0
    totals["sessionCount"] = len(rows)
    for row in rows:
        totals["tokens"] += token_sum({
            "input_tokens": row.get("inputTokens"),
            "output_tokens": row.get("outputTokens"),
            "cache_read_tokens": row.get("cacheReadTokens"),
            "cache_write_tokens": row.get("cacheWriteTokens"),
            "reasoning_tokens": row.get("reasoningTokens"),
        })
        if row.get("active"):
            totals["active"] += 1
        actual_sum += num(row.get("actualCostUsd"))
        estimated_sum += num(row.get("estimatedCostUsd"))
    if actual_sum > 0:
        totals["actualCostUsd"] = actual_sum
    if estimated_sum > 0:
        totals["estimatedCostUsd"] = estimated_sum
    return totals


def build_snapshot(now=None, environ=None):
    environ = environ or os.environ
    now = time.time() if now is None else float(now)
    home, paths = state_paths(environ)
    if not paths:
        return demo_snapshot(home)

    all_sessions = []
    window_rows = []
    opened = 0
    errors = []
    profiles = set()
    busy = False

    for path in paths:
        label = profile_label(path)
        sessions, part_window, ok, err = scan(path, now, label)
        if not ok:
            errors.append(err or "unreadable state.db")
            continue
        opened += 1
        profiles.add(label)
        all_sessions.extend(sessions)
        window_rows.extend(part_window)
        for row in sessions:
            if recency_of(row.get("lastActivityAt"), None, row.get("startedAt")) >= now - BUSY_WINDOW_SEC:
                busy = True

    if opened == 0:
        message = errors[0] if errors else "unreadable state.db"
        return error_snapshot(message, home)

    all_sessions.sort(key=lambda item: item.get("lastActivityAt") or item.get("startedAt") or 0, reverse=True)
    out = {
        "present": True,
        "demo": False,
        "busy": busy,
        "error": "",
        "stale": False,
        "home": str(home),
        "sessions": all_sessions[:DISPLAY_LIMIT],
        "totals": _sum_window(window_rows),
        "totalsWindow": "last 24h",
        "profileCount": len(profiles),
        "probedAt": now,
    }
    if len(errors) > 0:
        out["warning"] = errors[0]
    return out


def main():
    print(json.dumps(build_snapshot(), separators=(",", ":")))


if __name__ == "__main__":
    main()
