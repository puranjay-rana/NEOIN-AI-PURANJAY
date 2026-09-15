
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
    """Create the interviews table if it doesn't exist yet, and run column
    migrations if new columns are missing. Safe to call every startup."""
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
                overall_score       FLOAT DEFAULT 0.0,
                technical_score     FLOAT DEFAULT 0.0,
                relevance_score     FLOAT DEFAULT 0.0,
                communication_score FLOAT DEFAULT 0.0,
                confidence_score    FLOAT DEFAULT 0.0,
                video_score         FLOAT DEFAULT 0.0,
                audio_delivery_score FLOAT DEFAULT 0.0,
                integrity_score     INT DEFAULT 100,
                scores_json         LONGTEXT NOT NULL,
                transcript_json     LONGTEXT NOT NULL,
                final_report        LONGTEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """
        )
        conn.commit()

        # Migration: Add missing score columns to existing table if needed
        columns_to_add = [
            ("overall_score", "FLOAT DEFAULT 0.0"),
            ("technical_score", "FLOAT DEFAULT 0.0"),
            ("relevance_score", "FLOAT DEFAULT 0.0"),
            ("communication_score", "FLOAT DEFAULT 0.0"),
            ("confidence_score", "FLOAT DEFAULT 0.0"),
            ("video_score", "FLOAT DEFAULT 0.0"),
            ("audio_delivery_score", "FLOAT DEFAULT 0.0"),
            ("integrity_score", "INT DEFAULT 100"),
        ]
        for col_name, col_type in columns_to_add:
            try:
                cur.execute(
                    f"ALTER TABLE interviews ADD COLUMN {col_name} {col_type}"
                )
                conn.commit()
                print(f"[DB] Added column '{col_name}' to interviews table")
            except Exception:
                pass

        # Backfill explicit score columns from scores_json for older records
        try:
            cur.execute("SELECT id, scores_json FROM interviews WHERE video_score = 0.0 OR overall_score = 0.0")
            rows = cur.fetchall()
            for row_id, s_json in rows:
                if not s_json:
                    continue
                try:
                    s_data = json.loads(s_json)
                    cur.execute(
                        """
                        UPDATE interviews SET
                            overall_score = %s,
                            technical_score = %s,
                            relevance_score = %s,
                            communication_score = %s,
                            confidence_score = %s,
                            video_score = %s,
                            audio_delivery_score = %s,
                            integrity_score = %s
                        WHERE id = %s
                        """,
                        (
                            float(s_data.get("overall", 0.0)),
                            float(s_data.get("technical", 0.0)),
                            float(s_data.get("relevance", 0.0)),
                            float(s_data.get("communication", 0.0)),
                            float(s_data.get("confidence", 0.0)),
                            float(s_data.get("video", s_data.get("video_score", 0.0))),
                            float(s_data.get("audio_delivery", s_data.get("audio_delivery_score", 0.0))),
                            int(s_data.get("integrity_score", 100)),
                            row_id,
                        ),
                    )
                except Exception:
                    pass
            conn.commit()
        except Exception as e:
            print("[DB] Migration backfill note:", e)

        cur.close()
    print(f"[DB] MySQL interview DB ready ({_POOL_CONFIG['database']}@{_POOL_CONFIG['host']})")


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
    """Insert one completed interview's final results, storing individual score
    columns (including video_score and delivery) and the complete JSON payloads."""
    overall_score = float(scores.get("overall", 0.0) or 0.0)
    technical_score = float(scores.get("technical", 0.0) or 0.0)
    relevance_score = float(scores.get("relevance", 0.0) or 0.0)
    communication_score = float(scores.get("communication", 0.0) or 0.0)
    confidence_score = float(scores.get("confidence", 0.0) or 0.0)
    video_score = float(scores.get("video", scores.get("video_score", 0.0)) or 0.0)
    audio_delivery_score = float(scores.get("audio_delivery", scores.get("audio_delivery_score", 0.0)) or 0.0)
    integrity_score = int(scores.get("integrity_score", 100) or 100)

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
        overall_score,
        technical_score,
        relevance_score,
        communication_score,
        confidence_score,
        video_score,
        audio_delivery_score,
        integrity_score,
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
                ended_early, overall_score, technical_score, relevance_score,
                communication_score, confidence_score, video_score,
                audio_delivery_score, integrity_score,
                scores_json, transcript_json, final_report
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                created_at=VALUES(created_at),
                candidate_name=VALUES(candidate_name),
                applied_role=VALUES(applied_role),
                role_summary=VALUES(role_summary),
                job_description=VALUES(job_description),
                max_questions=VALUES(max_questions),
                questions_answered=VALUES(questions_answered),
                ended_early=VALUES(ended_early),
                overall_score=VALUES(overall_score),
                technical_score=VALUES(technical_score),
                relevance_score=VALUES(relevance_score),
                communication_score=VALUES(communication_score),
                confidence_score=VALUES(confidence_score),
                video_score=VALUES(video_score),
                audio_delivery_score=VALUES(audio_delivery_score),
                integrity_score=VALUES(integrity_score),
                scores_json=VALUES(scores_json),
                transcript_json=VALUES(transcript_json),
                final_report=VALUES(final_report)
            """,
            row,
        )
        conn.commit()
        cur.close()
    print(f"[DB] Saved interview {session_id} to MySQL (video_score={video_score}, {len(transcript)} answers)")


def list_interviews(limit: int = 50) -> List[Dict[str, Any]]:
    """Summary rows for the history list view."""
    with _connect() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, created_at, candidate_name, applied_role, role_summary,
                   max_questions, questions_answered, ended_early,
                   overall_score, technical_score, relevance_score, communication_score,
                   confidence_score, video_score, audio_delivery_score, integrity_score,
                   scores_json
            FROM interviews
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
        cur.close()
    result = []
    for r in rows:
        try:
            scores_obj = json.loads(r["scores_json"]) if r["scores_json"] else {}
        except Exception:
            scores_obj = {}
        
        if "video" not in scores_obj and r.get("video_score") is not None:
            scores_obj["video"] = float(r["video_score"])
        if "confidence" not in scores_obj and r.get("confidence_score") is not None:
            scores_obj["confidence"] = float(r["confidence_score"])
        if "overall" not in scores_obj and r.get("overall_score") is not None:
            scores_obj["overall"] = float(r["overall_score"])

        result.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "candidate_name": r["candidate_name"] or "Candidate",
            "applied_role": r["applied_role"] or "Target Role",
            "role_summary": r["role_summary"],
            "max_questions": r["max_questions"],
            "questions_answered": r["questions_answered"],
            "ended_early": bool(r["ended_early"]),
            "overall_score": r.get("overall_score", scores_obj.get("overall", 0.0)),
            "video_score": r.get("video_score", scores_obj.get("video", 0.0)),
            "confidence_score": r.get("confidence_score", scores_obj.get("confidence", 0.0)),
            "technical_score": r.get("technical_score", scores_obj.get("technical", 0.0)),
            "scores": scores_obj,
        })
    return result


def get_interview(session_id: str) -> Optional[Dict[str, Any]]:
    """Full detail (including transcript + report) for one interview."""
    with _connect() as conn:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM interviews WHERE id = %s", (session_id,))
        r = cur.fetchone()
        cur.close()
    if r is None:
        return None
    
    try:
        scores_obj = json.loads(r["scores_json"]) if r["scores_json"] else {}
    except Exception:
        scores_obj = {}

    try:
        transcript_obj = json.loads(r["transcript_json"]) if r["transcript_json"] else []
    except Exception:
        transcript_obj = []

    return {
        "id": r["id"],
        "created_at": r["created_at"],
        "candidate_name": r["candidate_name"] or "Candidate",
        "applied_role": r["applied_role"] or "Target Role",
        "role_summary": r["role_summary"],
        "job_description": r["job_description"],
        "max_questions": r["max_questions"],
        "questions_answered": r["questions_answered"],
        "ended_early": bool(r["ended_early"]),
        "overall_score": r.get("overall_score", scores_obj.get("overall", 0.0)),
        "video_score": r.get("video_score", scores_obj.get("video", 0.0)),
        "confidence_score": r.get("confidence_score", scores_obj.get("confidence", 0.0)),
        "scores": scores_obj,
        "transcript": transcript_obj,
        "final_report": r["final_report"] or "",
    }


def delete_interview(session_id: str) -> bool:
    """Delete a single interview by id."""
    with _connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM interviews WHERE id = %s", (session_id,))
        deleted = cur.rowcount > 0
        conn.commit()
        cur.close()
    return deleted


def clear_all_interviews() -> int:
    """Delete all stored interviews from the database."""
    with _connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM interviews")
        count = cur.rowcount
        conn.commit()
        cur.close()
    return count