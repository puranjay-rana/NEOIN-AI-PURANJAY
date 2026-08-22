
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import mysql.connector
from mysql.connector import pooling

from dotenv import load_dotenv
load_dotenv()
# --------------------------------------------------------------------------
# Connection pool
# --------------------------------------------------------------------------
# mysql-connector's pooling.MySQLConnectionPool is thread-safe on its own,
# so unlike the SQLite version we don't need a global threading.Lock --
# each request just checks out its own connection from the pool and
# returns it when the `with` block exits.

_POOL_CONFIG = dict(
    pool_name="interview_pool",
    pool_size=5,
    host=os.environ.get("MYSQL_HOST", "localhost"),
    port=int(os.environ.get("MYSQL_PORT", "3306")),
    user=os.environ.get("MYSQL_USER", "root"),
    password=os.environ.get("MYSQL_PASSWORD", "Tapu@7321"),
    database=os.environ.get("MYSQL_DATABASE", "interviews_db"),
    autocommit=False,
)

_pool: Optional[pooling.MySQLConnectionPool] = None


def _get_pool() -> pooling.MySQLConnectionPool:
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(**_POOL_CONFIG)
    return _pool


@contextmanager
def _connect():
    conn = _get_pool().get_connection()
    try:
        yield conn
    finally:
        conn.close()  # returns the connection to the pool, doesn't actually close it


def init_db() -> None:
    """Create the interviews table if it doesn't exist yet. Safe to call
    every startup -- CREATE TABLE IF NOT EXISTS is a no-op after the first
    run. Assumes the database itself already exists (see module docstring)."""
    with _connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS interviews (
                id                  VARCHAR(64) PRIMARY KEY,
                created_at          VARCHAR(64) NOT NULL,
                candidate_name      VARCHAR(255),
                applied_role        VARCHAR(255),
                role_summary        TEXT,
                job_description     LONGTEXT,
                max_questions       INT,
                questions_answered  INT,
                ended_early         TINYINT(1) NOT NULL DEFAULT 0,
                scores_json         LONGTEXT NOT NULL,
                transcript_json     LONGTEXT NOT NULL,
                final_report        LONGTEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        conn.commit()
        cur.close()
    print(f"🗄️  MySQL interview DB ready ({_POOL_CONFIG['database']}@{_POOL_CONFIG['host']})")


def save_interview(
    session_id: str,
    *,
    scores: Dict[str, Any],
    transcript: List[Dict[str, Any]],
    final_report: str,
    role_summary: str = "",
    job_description: str = "",
    max_questions: int = 0,
    ended_early: bool = False,
    candidate_name: Optional[str] = None,
    applied_role: Optional[str] = None,
) -> None:
    """Insert one completed interview's final results. If called twice for
    the same session_id (e.g. "end" fires after "answer" already saved it),
    the second call overwrites the first via ON DUPLICATE KEY UPDATE."""
    row = (
        session_id,
        datetime.now(timezone.utc).isoformat(),
        candidate_name,
        applied_role,
        role_summary,
        job_description,
        max_questions,
        len(transcript),
        1 if ended_early else 0,
        json.dumps(scores),
        json.dumps(transcript),
        final_report,
    )
    with _connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO interviews (
                id, created_at, candidate_name, applied_role, role_summary,
                job_description, max_questions, questions_answered,
                ended_early, scores_json, transcript_json, final_report
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                created_at=VALUES(created_at),
                candidate_name=VALUES(candidate_name),
                applied_role=VALUES(applied_role),
                role_summary=VALUES(role_summary),
                job_description=VALUES(job_description),
                max_questions=VALUES(max_questions),
                questions_answered=VALUES(questions_answered),
                ended_early=VALUES(ended_early),
                scores_json=VALUES(scores_json),
                transcript_json=VALUES(transcript_json),
                final_report=VALUES(final_report)
            """,
            row,
        )
        conn.commit()
        cur.close()
    print(f"🗄️  Saved interview {session_id} to MySQL ({len(transcript)} answers)")


def list_interviews(limit: int = 50) -> List[Dict[str, Any]]:
    """Summary rows (no transcript/report body) for a recruiter list view."""
    with _connect() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, created_at, candidate_name, applied_role, role_summary,
                   max_questions, questions_answered, ended_early, scores_json
            FROM interviews
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()
    return [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "candidate_name": r["candidate_name"],
            "applied_role": r["applied_role"],
            "role_summary": r["role_summary"],
            "max_questions": r["max_questions"],
            "questions_answered": r["questions_answered"],
            "ended_early": bool(r["ended_early"]),
            "scores": json.loads(r["scores_json"]),
        }
        for r in rows
    ]


def get_interview(session_id: str) -> Optional[Dict[str, Any]]:
    """Full detail (including transcript + report) for one interview."""
    with _connect() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM interviews WHERE id = %s", (session_id,))
        r = cur.fetchone()
        cur.close()
    if r is None:
        return None
    return {
        "id": r["id"],
        "created_at": r["created_at"],
        "candidate_name": r["candidate_name"],
        "applied_role": r["applied_role"],
        "role_summary": r["role_summary"],
        "job_description": r["job_description"],
        "max_questions": r["max_questions"],
        "questions_answered": r["questions_answered"],
        "ended_early": bool(r["ended_early"]),
        "scores": json.loads(r["scores_json"]),
        "transcript": json.loads(r["transcript_json"]),
        "final_report": r["final_report"],
    }