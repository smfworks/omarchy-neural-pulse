import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import probe  # noqa: E402
from fixtures import add_session, write_state_db  # noqa: E402

NOW = 1_700_000_000


def env_for(home: Path) -> dict:
    hermes = home / ".hermes"
    hermes.mkdir(parents=True, exist_ok=True)
    return {"HOME": str(home), "HERMES_HOME": str(hermes)}


def snapshot_for(home: Path, now=NOW):
    return probe.build_snapshot(now=now, environ=env_for(home))


def test_empty_home_is_demo(tmp_path):
    snap = snapshot_for(tmp_path)
    assert snap["present"] is False
    assert snap["demo"] is True
    assert snap["busy"] is False
    assert snap["error"] == ""
    assert snap["sessions"] == []


def test_empty_dir_is_not_present(tmp_path):
    env = env_for(tmp_path)
    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["present"] is False
    assert snap["demo"] is True


def test_ghost_open_stub_is_filtered_and_not_busy(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    add_session(
        conn,
        session_id="ghost",
        started_at=NOW - 5,
        ended_at=None,
        message_count=0,
        last_activity_at=NOW - 1,
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["present"] is True
    assert snap["busy"] is False
    assert snap["totals"]["sessionCount"] == 0
    assert snap["totals"]["active"] == 0
    assert snap["sessions"] == []


def test_busy_from_recency_not_mtime(tmp_path):
    env = env_for(tmp_path)
    db = Path(env["HERMES_HOME"]) / "state.db"
    conn = write_state_db(db)
    add_session(
        conn,
        session_id="live",
        started_at=NOW - 120,
        ended_at=None,
        message_count=3,
        input_tokens=40,
        last_activity_at=NOW - 10,
        messages=[NOW - 10],
    )
    conn.commit()
    conn.close()
    os.utime(db, (NOW + 10_000, NOW + 10_000))

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["busy"] is True
    assert snap["totals"]["active"] == 1


def test_busy_false_after_quiet(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    add_session(
        conn,
        session_id="quiet",
        started_at=NOW - 600,
        ended_at=None,
        message_count=4,
        input_tokens=20,
        last_activity_at=NOW - 45,
        messages=[NOW - 45],
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["present"] is True
    assert snap["busy"] is False
    assert snap["totals"]["active"] == 1
    assert snap["sessions"][0]["id"] == "quiet"


def test_message_timestamp_can_mark_busy_without_last_activity(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    add_session(
        conn,
        session_id="msg",
        started_at=NOW - 90,
        ended_at=None,
        message_count=2,
        last_activity_at=None,
        messages=[NOW - 5],
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["busy"] is True


def test_recent_message_beats_stale_last_activity_heartbeat(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    add_session(
        conn,
        session_id="lag",
        started_at=NOW - 120,
        ended_at=None,
        message_count=2,
        last_activity_at=NOW - 90,
        messages=[NOW - 4],
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["busy"] is True


def test_totals_match_last_24h_population_not_lifetime(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    for i in range(100):
        add_session(
            conn,
            session_id="old-%03d" % i,
            started_at=NOW - 3 * 86400 - i,
            ended_at=NOW - 3 * 86400,
            message_count=2,
            input_tokens=1000,
            estimated_cost_usd=1.0,
            last_activity_at=NOW - 3 * 86400,
        )
    add_session(
        conn,
        session_id="recent-a",
        started_at=NOW - 3600,
        ended_at=NOW - 3500,
        message_count=2,
        input_tokens=100,
        output_tokens=20,
        actual_cost_usd=0.01,
        estimated_cost_usd=0.50,
        last_activity_at=NOW - 3500,
    )
    add_session(
        conn,
        session_id="recent-b",
        started_at=NOW - 120,
        ended_at=NOW - 100,
        message_count=1,
        input_tokens=30,
        estimated_cost_usd=0.25,
        last_activity_at=NOW - 100,
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    totals = snap["totals"]
    assert totals["sessionCount"] == 2
    assert totals["tokens"] == 150
    assert totals["actualCostUsd"] == pytest.approx(0.01)
    assert totals["estimatedCostUsd"] == pytest.approx(0.75)
    assert snap["totalsWindow"] == "last 24h"


def test_archived_and_blank_ended_at(tmp_path):
    env = env_for(tmp_path)
    conn = write_state_db(Path(env["HERMES_HOME"]) / "state.db")
    add_session(
        conn,
        session_id="archived",
        started_at=NOW - 10,
        ended_at=NOW - 9,
        message_count=4,
        input_tokens=99,
        last_activity_at=NOW - 9,
        archived=1,
    )
    conn.execute(
        "INSERT INTO sessions (id, source, started_at, ended_at, message_count, input_tokens, last_activity_at) "
        "VALUES ('blank-end', 'cli', ?, '', 2, 11, ?)",
        (NOW - 80, NOW - 80),
    )
    conn.commit()
    conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    ids = [row["id"] for row in snap["sessions"]]
    assert "archived" not in ids
    assert "blank-end" in ids
    assert snap["busy"] is False


def test_unreadable_db_is_error(tmp_path):
    env = env_for(tmp_path)
    db = Path(env["HERMES_HOME"]) / "state.db"
    db.write_text("not a sqlite database", encoding="utf-8")
    db.chmod(stat.S_IRUSR)

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["present"] is False
    assert snap["demo"] is False
    assert snap["error"]
    assert "unreadable" in snap["error"] or "failed" in snap["error"]


def test_chmod_zero_db_is_error(tmp_path):
    env = env_for(tmp_path)
    db = Path(env["HERMES_HOME"]) / "state.db"
    conn = write_state_db(db)
    add_session(conn, session_id="x", started_at=NOW - 10, message_count=1, last_activity_at=NOW - 10)
    conn.commit()
    conn.close()
    db.chmod(0)
    try:
        snap = probe.build_snapshot(now=NOW, environ=env)
        assert snap["present"] is False
        assert snap["demo"] is False
        assert snap["error"]
    finally:
        db.chmod(0o644)


def test_two_profiles_are_labeled(tmp_path):
    env = env_for(tmp_path)
    default_db = Path(env["HERMES_HOME"]) / "state.db"
    work_db = Path(env["HERMES_HOME"]) / "profiles" / "work" / "state.db"
    default_conn = write_state_db(default_db)
    add_session(
        default_conn,
        session_id="home-sess",
        started_at=NOW - 200,
        ended_at=NOW - 180,
        message_count=1,
        input_tokens=5,
        last_activity_at=NOW - 180,
        title="Home chat",
    )
    default_conn.commit()
    default_conn.close()
    work_conn = write_state_db(work_db)
    add_session(
        work_conn,
        session_id="work-sess",
        started_at=NOW - 90,
        ended_at=NOW - 80,
        message_count=1,
        input_tokens=7,
        last_activity_at=NOW - 80,
        title="Work chat",
        profile_name="work",
    )
    work_conn.commit()
    work_conn.close()

    snap = probe.build_snapshot(now=NOW, environ=env)
    assert snap["profileCount"] == 2
    profiles = {row["id"]: row["profile"] for row in snap["sessions"]}
    assert profiles["home-sess"] == "default"
    assert profiles["work-sess"] == "work"
    assert snap["totals"]["sessionCount"] == 2
