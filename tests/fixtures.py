import sqlite3
from pathlib import Path

SESSION_SCHEMA = """
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'cli',
  model TEXT,
  title TEXT,
  started_at REAL NOT NULL,
  ended_at REAL,
  end_reason TEXT,
  message_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL,
  actual_cost_usd REAL,
  last_activity_at REAL,
  profile_name TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  content TEXT,
  timestamp REAL NOT NULL
);
"""


def write_state_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(SESSION_SCHEMA)
    return conn


def add_session(
    conn: sqlite3.Connection,
    *,
    session_id: str,
    started_at: float,
    ended_at=None,
    message_count: int = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    estimated_cost_usd=None,
    actual_cost_usd=None,
    last_activity_at=None,
    title: str = "",
    source: str = "cli",
    model: str = "test-model",
    archived: int = 0,
    profile_name: str = "",
    end_reason: str = "",
    messages=None,
):
    conn.execute(
        """
        INSERT INTO sessions (
          id, source, model, title, started_at, ended_at, end_reason,
          message_count, input_tokens, output_tokens, cache_read_tokens,
          estimated_cost_usd, actual_cost_usd, last_activity_at,
          profile_name, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            source,
            model,
            title or session_id,
            started_at,
            ended_at,
            end_reason,
            message_count,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            estimated_cost_usd,
            actual_cost_usd,
            last_activity_at,
            profile_name,
            archived,
        ),
    )
    for ts in messages or []:
        conn.execute(
            "INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', 'hi', ?)",
            (session_id, ts),
        )
