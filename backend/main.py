

from __future__ import annotations

import asyncio
import io
import json
import os
import traceback
import uuid
from typing import Dict, List, Any

import pdfplumber
import cv2
import mysql.connector

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)

from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

from langgraph.types import Command

from src.agents.interview_graph_live import (
    build_live_graph,
)

from src.config import MAX_QUESTIONS

from src.db import init_db, save_interview


# ============================================================
# DATABASE
# ============================================================

MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "root")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "Tapu@7321")
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "interviews_db")


def ensure_database_exists():
    """
    Create the MySQL database if it does not already exist.

    IMPORTANT:
    We connect WITHOUT selecting interviews_db first.
    This fixes:
        1049 Unknown database 'interviews_db'
    """

    conn = None
    cursor = None

    try:
        conn = mysql.connector.connect(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
        )

        cursor = conn.cursor()

        cursor.execute(
            f"""
            CREATE DATABASE IF NOT EXISTS `{MYSQL_DATABASE}`
            CHARACTER SET utf8mb4
            COLLATE utf8mb4_unicode_ci
            """
        )

        conn.commit()

        print(f"✅ MySQL database ready: {MYSQL_DATABASE}")

    except mysql.connector.Error as e:
        print("❌ MySQL database creation failed:", repr(e))
        raise

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def make_json_safe(value):
    """
    Convert NumPy / other non-JSON-native values into
    normal Python values.

    This is important because LangGraph checkpointing
    can fail with:

        TypeError:
        Type is not msgpack serializable: numpy.float64
    """

    if value is None:
        return None

    if isinstance(value, dict):
        return {str(k): make_json_safe(v) for k, v in value.items()}

    if isinstance(value, list):
        return [make_json_safe(v) for v in value]

    if isinstance(value, tuple):
        return [make_json_safe(v) for v in value]

    # NumPy scalar types
    try:
        import numpy as np

        if isinstance(value, np.generic):
            return value.item()

        if isinstance(value, np.ndarray):
            return value.tolist()

    except Exception:
        pass

    # Primitive values
    if isinstance(value, (str, int, float, bool)):
        return value

    # Fallback
    return str(value)


# ============================================================
# ANTI-CHEATING / PROCTORING
# ============================================================

# Point deduction applied per cheat event when computing the final
# integrity_score. Keys match the counters tracked per session below.
CHEAT_PENALTIES = {
    "tab_switches": 5,
    "copy_events": 10,
    "paste_events": 10,
    "fullscreen_exits": 5,
    "multiple_faces_events": 15,
}


def calculate_integrity_score(cheat_counts: dict) -> int:
    """100 minus weighted deductions for each proctoring event, clamped
    to the [0, 100] range."""
    score = 100
    for key, penalty in CHEAT_PENALTIES.items():
        score -= cheat_counts.get(key, 0) * penalty
    return max(0, min(100, score))


def _empty_cheat_counts() -> dict:
    return {key: 0 for key in CHEAT_PENALTIES}


def save_interview_to_database(
    session_id: str,
    state: dict,
    scores: dict,
    report: str,
    ended_early: bool = False,
):
    """
    Save final interview information into MySQL.

    This function is intentionally kept outside the
    WebSocket code so the interview logic doesn't need
    to change.
    """

    try:
        safe_state = make_json_safe(state or {})
        safe_scores = make_json_safe(scores or {})

        transcript = safe_state.get("transcript", [])
        role_summary = safe_state.get("role_summary", "")
        job_description = safe_state.get("job_description", "")
        max_questions = safe_state.get("max_questions", MAX_QUESTIONS)
        candidate_name = safe_state.get("candidate_name")
        applied_role = safe_state.get("applied_role")

        save_interview(
            session_id=session_id,
            scores=safe_scores,
            transcript=transcript,
            final_report=report or "",
            role_summary=role_summary or "",
            job_description=job_description or "",
            max_questions=int(max_questions or MAX_QUESTIONS),
            ended_early=ended_early,
            candidate_name=candidate_name,
            applied_role=applied_role,
        )

        print(f"✅ Interview saved to database: {session_id}")

    except Exception as e:
        # Database failure should NOT crash the interview.
        print("❌ Failed to save interview to database:", repr(e))
        traceback.print_exc()


# ============================================================
# APP
# ============================================================

app = FastAPI(title="AI Mock Interview API", version="1.0.0")


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# GRAPH
# ============================================================

graph = build_live_graph()


GRAPH_INVOKE_TIMEOUT_SECONDS = 90

# FIX: heartbeat interval shortened from 8s -> 4s. The frontend was
# closing the socket (code 1011, "Connection lost. Please restart.")
# during long-running answer turns (Whisper transcription + LLM
# scoring, sometimes 30-40s+ when a Gemini call times out and falls
# back to a second instance) because it wasn't reliably being kept
# "alive" from its own point of view before its own timeout fired.
# A tighter heartbeat cadence gives the frontend more/faster signals
# to reset any client-side "still waiting" timer against. This is a
# mitigation on the backend side -- the frontend ALSO needs to listen
# for {"type": "processing"} messages and reset its own timeout on
# every message received (not just on the final "score_update"), or
# this change alone will not fully fix the disconnects.
HEARTBEAT_INTERVAL_SECONDS = 4


async def safe_send_json(websocket: WebSocket, payload: dict) -> bool:
    """
    Sends JSON to the client if (and only if) the socket is still
    connected. Returns True/False instead of raising, so callers never
    need their own try/except around every send.

    FIX: the old version always attempted websocket.send_json() and only
    caught the failure after the fact. Once Starlette has already torn
    down a socket, a second send raises RuntimeError('Cannot call "send"
    once a close message has been sent.') -- harmless on its own, but it
    was also a symptom of the deeper bug below: the outer receive loop
    kept calling receive_text() on a socket that was already gone.
    """
    if websocket.client_state != WebSocketState.CONNECTED:
        return False
    try:
        await websocket.send_json(payload)
        return True
    except Exception as e:
        print("⚠️ Could not send to client (socket likely closed):", repr(e))
        return False


async def invoke_graph(state_or_command, config, websocket: WebSocket | None = None):
    import time

    started = time.monotonic()

    # FIX: a single "answer" turn can legitimately take 40-50+s (Whisper
    # transcription alone took 44.6s in one observed session, and a
    # single Gemini call can eat 10-11s before failing with a 504 and
    # falling back to a second instance) with ZERO websocket traffic in
    # either direction while it runs. That silence is exactly what made
    # a real session drop mid-answer with WebSocket close code 1011
    # ("Internal Error") / the frontend's own "Connection lost (code
    # 1011). Please restart." message right as the backend finished --
    # many browsers/proxies/load balancers (and naive frontend timeout
    # logic) treat a long-idle websocket as dead and tear it down, even
    # though nothing had actually failed. Sending a lightweight
    # "processing" heartbeat every few seconds keeps the connection
    # visibly alive (and lets the frontend show real progress) for the
    # whole duration of a long invoke.
    heartbeat_task = None
    if websocket is not None:

        async def _heartbeat():
            elapsed = 0
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                elapsed += HEARTBEAT_INTERVAL_SECONDS
                if websocket.client_state != WebSocketState.CONNECTED:
                    return
                try:
                    await websocket.send_json(
                        {"type": "processing", "elapsed_seconds": elapsed}
                    )
                except Exception:
                    return

        heartbeat_task = asyncio.create_task(_heartbeat())

    try:
        result = await asyncio.wait_for(
            run_in_threadpool(graph.invoke, state_or_command, config),
            timeout=GRAPH_INVOKE_TIMEOUT_SECONDS,
        )

        print(f"⏱️ graph.invoke() took {time.monotonic() - started:.1f}s")

        return result

    except asyncio.TimeoutError:
        print(
            f"⏱️ graph.invoke() still running after "
            f"{time.monotonic() - started:.1f}s "
            f"(timeout={GRAPH_INVOKE_TIMEOUT_SECONDS}s)"
        )
        raise

    finally:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except (asyncio.CancelledError, Exception):
                pass


# ============================================================
# TEMPORARY VIDEO FRAME STORAGE
# ============================================================

video_frames: Dict[str, List[str]] = {}

# Per-session anti-cheating counters. Keyed by session_id, values are
# dicts shaped like _empty_cheat_counts().
cheat_events: Dict[str, Dict[str, int]] = {}


# ============================================================
# MODEL WARM-UP
# ============================================================

@app.on_event("startup")
async def warm_up_models():

    # --------------------------------------------------------
    # DATABASE INITIALIZATION
    # --------------------------------------------------------

    try:
        ensure_database_exists()
        init_db()
        print("✅ Database initialization completed")
    except Exception as e:
        print("⚠️ Database initialization failed:", repr(e))

    # --------------------------------------------------------
    # MODEL WARM-UP
    # --------------------------------------------------------

    def _warm():
        try:
            from src.agents.interview_graph_live import _get_audio_analyzer

            _get_audio_analyzer()
            print("✅ AudioAnalyzer (Whisper) warmed up")
        except Exception as e:
            print("⚠️ Could not warm up AudioAnalyzer:", repr(e))

        try:
            from src.agents.interview_graph_live import _get_visual_analyzer

            _get_visual_analyzer()
            print("✅ VisualAnalyzer warmed up")
        except Exception as e:
            print("⚠️ Could not warm up VisualAnalyzer:", repr(e))

        try:
            import numpy as np
            from deepface import DeepFace

            dummy = np.zeros((48, 48, 3), dtype="uint8")
            DeepFace.analyze(dummy, actions=["emotion"], enforce_detection=False)
            print("✅ DeepFace model warmed up")
        except Exception as e:
            print("⚠️ Could not warm up DeepFace:", repr(e))

        try:
            from src.agents.interview_graph_live import _get_face_cascade

            _get_face_cascade()
            print("✅ Multi-face detection cascade warmed up")
        except Exception as e:
            print("⚠️ Could not warm up face cascade:", repr(e))

    await run_in_threadpool(_warm)


# ============================================================
# SESSION LOCKS
# ============================================================

session_locks: Dict[str, asyncio.Lock] = {}


def get_session_lock(session_id: str) -> asyncio.Lock:
    if session_id not in session_locks:
        session_locks[session_id] = asyncio.Lock()
    return session_locks[session_id]


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI Mock Interview"}


# ============================================================
# PDF RESUME UPLOAD
# ============================================================

@app.post("/interview/upload-resume")
async def upload_resume(file: UploadFile = File(...)):

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected.")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    try:
        pdf_bytes = await file.read()

        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

        extracted_text = []

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    extracted_text.append(page_text)

        resume_text = "\n\n".join(extracted_text).strip()

        if not resume_text:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Could not extract text from this PDF. "
                    "The PDF may contain scanned images."
                ),
            )

        print(f"📄 Resume uploaded: {file.filename}")
        print(f"📝 Extracted characters: {len(resume_text)}")

        return {
            "success": True,
            "filename": file.filename,
            "resume_text": resume_text,
            "text_length": len(resume_text),
        }

    except HTTPException:
        raise

    except Exception as e:
        print("❌ Resume extraction error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail=f"Resume extraction failed: {str(e)}",
        )


# ============================================================
# EXTRACT LANGGRAPH EVENT
# ============================================================

def extract_event(result):

    interrupts = result.get("__interrupt__")

    if interrupts:
        interrupt_obj = interrupts[0]
        value = interrupt_obj.value

        if isinstance(value, dict):
            return {
                "type": "question",
                "question": value.get("question", "No question generated."),
                "question_number": value.get("question_number", 1),
            }

    return {
        "type": "final",
        "report": result.get("final_report", "Interview completed."),
    }


# ============================================================
# EXTRACT SCORES
# ============================================================

def _safe_score(value, default=None):
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def extract_scores(result):
    """
    Aggregate per-turn scores from the transcript into a single
    summary dict.

    interview_graph_live.py's decision_engine computes real visual-
    delivery and audio-delivery scores per turn via
    src.video_analysis.ScoreEngine (eye contact, posture, expression,
    fluency, grammar, pace, etc.) and stores them on each transcript
    item as "visual_score" and "audio_delivery_score" (both 0-100).

    This reads visual_score / audio_delivery_score directly, excludes
    turns where they're 0 (meaning no frames/audio were analyzed for
    that turn -- see vision_agent/decision_engine, e.g. a typed-only
    answer), and folds both into the overall score.
    """

    transcript = result.get("transcript") or []

    if not transcript:
        return {
            "technical": 0,
            "relevance": 0,
            "communication": 0,
            "confidence": 0,
            "video": 0,
            "audio_delivery": 0,
            "overall": 0,
        }

    technical_values = []
    relevance_values = []
    communication_values = []
    confidence_values = []
    visual_values = []
    audio_delivery_values = []

    for item in transcript:
        if not isinstance(item, dict):
            continue

        technical = _safe_score(item.get("eval_score"))
        relevance = _safe_score(item.get("relevance_score"))
        communication = _safe_score(item.get("communication_score"))
        confidence = _safe_score(item.get("confidence_score"))
        visual = _safe_score(item.get("visual_score"))
        audio_delivery = _safe_score(item.get("audio_delivery_score"))

        if technical is not None:
            technical_values.append(max(0.0, min(10.0, technical)))

        if relevance is not None:
            relevance_values.append(max(0.0, min(10.0, relevance)))

        if communication is not None:
            communication_values.append(max(0.0, min(10.0, communication)))

        if confidence is not None:
            confidence_values.append(max(0.0, min(1.0, confidence)))

        # visual_score / audio_delivery_score are 0 when decision_engine
        # had no visual_metrics / audio_metrics to blend for that turn
        # (e.g. no webcam frames, or Whisper had nothing to analyze).
        # Exclude those turns rather than let them drag the delivery
        # average toward 0 for reasons unrelated to actual delivery.
        if visual is not None and visual > 0:
            visual_values.append(max(0.0, min(100.0, visual)))

        if audio_delivery is not None and audio_delivery > 0:
            audio_delivery_values.append(max(0.0, min(100.0, audio_delivery)))

    def average(values):
        return sum(values) / len(values) if values else 0.0

    technical = average(technical_values)
    relevance = average(relevance_values)
    communication = average(communication_values)
    confidence = average(confidence_values)
    visual = average(visual_values)
    audio_delivery = average(audio_delivery_values)

    # Weighted overall, everything normalized to a 0-100 scale before
    # weighting. Content (technical/relevance/communication) still
    # dominates; confidence, visual delivery, and audio delivery each
    # contribute a smaller slice. Weights sum to 1.0.
    overall = (
        (technical * 10) * 0.40
        + (relevance * 10) * 0.15
        + (communication * 10) * 0.15
        + (confidence * 100) * 0.10
        + visual * 0.10
        + audio_delivery * 0.10
    )

    scores = {
        "technical": round(technical * 10, 1),
        "relevance": round(relevance * 10, 1),
        "communication": round(communication * 10, 1),
        "confidence": round(confidence * 100, 1),
        "video": round(visual, 1),
        "audio_delivery": round(audio_delivery, 1),
        "overall": round(overall, 1),
    }

    print("📊 SCORE EXTRACTION")
    print("  Answers:", len(transcript))
    print("  Technical:", technical_values)
    print("  Relevance:", relevance_values)
    print("  Communication:", communication_values)
    print("  Confidence:", confidence_values)
    print("  Visual delivery (>0 only):", visual_values)
    print("  Audio delivery (>0 only):", audio_delivery_values)
    print("  Final (0-100 scale):", scores)

    return make_json_safe(scores)


# ============================================================
# WEBSOCKET
# ============================================================

@app.websocket("/ws/interview")
async def interview_websocket(websocket: WebSocket):

    await websocket.accept()

    session_id = str(uuid.uuid4())

    video_frames[session_id] = []
    cheat_events[session_id] = _empty_cheat_counts()

    config = {"configurable": {"thread_id": session_id}}

    print(f"✅ WebSocket connected: {session_id}")

    try:

        while True:

            # =================================================
            # FIX: bail out of the receive loop the moment the
            # socket is no longer connected, instead of calling
            # receive_text() again and letting Starlette raise a
            # bare RuntimeError that the except blocks below don't
            # recognize as a normal disconnect.
            #
            # This is what your traceback was hitting:
            #   RuntimeError: WebSocket is not connected. Need to
            #   call "accept" first.
            # It happened because a long graph.invoke() (42.5s in
            # your log) let the client disappear mid-processing;
            # every safe_send_json() after that correctly failed
            # quietly, but the loop still looped back around to
            # receive_text() on a socket Starlette had already
            # closed out from under us.
            # =================================================
            if websocket.client_state != WebSocketState.CONNECTED:
                print(f"🔌 Socket no longer connected, exiting loop: {session_id}")
                break

            # =================================================
            # RECEIVE
            # =================================================

            try:
                raw = await websocket.receive_text()
            except (WebSocketDisconnect, RuntimeError) as e:
                # Normal disconnect, or the "not connected" RuntimeError
                # Starlette raises on a second receive after a close --
                # both mean the same thing here: the client is gone.
                print(f"❌ WebSocket disconnected: {session_id} ({e!r})")
                break

            print(f"📥 RAW: {raw[:200]}")

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await safe_send_json(
                    websocket, {"type": "error", "message": "Invalid JSON"}
                )
                continue

            action = msg.get("action") or msg.get("type")

            print(f"📥 ACTION: {action}")
            print("========== FRONTEND → BACKEND ==========")
            print("Action:", action)
            print("Keys:", list(msg.keys()))

            if action == "answer":
                print("Text:", msg.get("text", ""))
                print("Has audio:", bool(msg.get("audio_b64")))
                print("Audio length:", len(msg.get("audio_b64", "")))
                print("Frames:", len(msg.get("frames_b64", [])))

            elif action in ("start", "start_interview"):
                print("Resume length:", len(msg.get("resume_text", "")))
                print("JD length:", len(msg.get("job_description", "")))
                print("Max questions:", msg.get("max_questions"))

            print("========================================")

            # =================================================
            # VIDEO FRAME
            # =================================================

            if action == "video_frame":
                frame = msg.get("frame_b64", "")

                if frame:
                    video_frames[session_id].append(frame)

                    if len(video_frames[session_id]) > 300:
                        video_frames[session_id] = video_frames[session_id][-300:]

                continue

            # =================================================
            # ANTI-CHEATING EVENTS
            # =================================================

            if action in (
                "tab_switch",
                "copy_detected",
                "paste_detected",
                "fullscreen_exit",
            ):

                counter_key = {
                    "tab_switch": "tab_switches",
                    "copy_detected": "copy_events",
                    "paste_detected": "paste_events",
                    "fullscreen_exit": "fullscreen_exits",
                }[action]

                counts = cheat_events.setdefault(session_id, _empty_cheat_counts())
                counts[counter_key] += 1

                print(
                    f"🚨 Cheat event '{action}' "
                    f"(session {session_id}) -> {counts[counter_key]}"
                )

                await safe_send_json(
                    websocket,
                    {
                        "type": "cheat_event_ack",
                        "event": action,
                        "counts": counts,
                        "integrity_score": calculate_integrity_score(counts),
                    },
                )

                continue

            # =================================================
            # START INTERVIEW
            # =================================================

            if action in ("start", "start_interview"):

                resume_text = msg.get("resume_text", "")
                job_description = msg.get("job_description", "")
                max_questions = msg.get("max_questions", MAX_QUESTIONS)

                if not resume_text.strip():
                    await safe_send_json(
                        websocket,
                        {"type": "error", "message": "Resume text is empty."},
                    )
                    continue

                if not job_description.strip():
                    await safe_send_json(
                        websocket,
                        {"type": "error", "message": "Job description is empty."},
                    )
                    continue

                initial_state = {
                    "resume_text": resume_text,
                    "job_description": job_description,
                    "skills": [],
                    "role_summary": "",
                    "difficulty": "medium",
                    "questions_asked": 0,
                    "max_questions": int(max_questions),
                    "current_question": "",
                    "current_audio_b64": "",
                    "current_frames_b64": [],
                    "current_answer_text": "",
                    "current_confidence_score": 0.0,
                    "current_eval_score": 0.0,
                    "current_relevance_score": 0.0,
                    "current_communication_score": 0.0,
                    "current_eval_feedback": "",
                    "transcript": [],
                    "final_report": "",
                    # DATABASE FIELDS
                    "candidate_name": msg.get("candidate_name"),
                    "applied_role": msg.get("applied_role"),
                }

                print("🚀 Starting LangGraph interview")

                try:
                    result = await invoke_graph(initial_state, config, websocket)
                    event = extract_event(result)

                    print("📤 Sending:", event["type"])

                    await safe_send_json(websocket, event)

                except asyncio.TimeoutError:
                    print(
                        f"❌ START TIMEOUT after {GRAPH_INVOKE_TIMEOUT_SECONDS}s"
                    )
                    await safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "message": (
                                "Timed out generating the first question. "
                                "Please check the server's LLM configuration."
                            ),
                        },
                    )

                except Exception as e:
                    print("❌ START ERROR:", repr(e))
                    traceback.print_exc()
                    await safe_send_json(
                        websocket, {"type": "error", "message": str(e)}
                    )

                continue

            # =================================================
            # ANSWER
            # =================================================

            if action == "answer":

                audio_b64 = msg.get("audio_b64", "")
                text = msg.get("text", "")

                print("🎤 Answer received")
                print("Audio:", bool(audio_b64))
                print("Text length:", len(text))

                frames_b64 = video_frames.get(session_id, [])

                print("🎥 Video frames:", len(frames_b64))

                payload = {
                    "audio_b64": audio_b64,
                    "frames_b64": frames_b64,
                    "text": text,
                }

                video_frames[session_id] = []

                try:
                    result = await invoke_graph(Command(resume=payload), config, websocket)

                    scores = extract_scores(result)

                    # Merge in proctoring counts + integrity score.
                    counts = cheat_events.get(session_id, _empty_cheat_counts())
                    scores.update(counts)
                    scores["integrity_score"] = calculate_integrity_score(counts)

                    transcript = result.get("transcript", [])

                    # Fold vision_agent's multi-face flag for this turn
                    # into the session's proctoring counters.
                    if transcript:
                        last_turn = transcript[-1]
                        if isinstance(last_turn, dict) and last_turn.get(
                            "multiple_faces_detected"
                        ):
                            counts["multiple_faces_events"] += 1
                            scores["multiple_faces_events"] = counts[
                                "multiple_faces_events"
                            ]
                            scores["integrity_score"] = calculate_integrity_score(
                                counts
                            )
                            print(
                                f"🚨 Multiple faces detected "
                                f"(session {session_id}) -> "
                                f"{counts['multiple_faces_events']}"
                            )

                    feedback = ""

                    if transcript:
                        feedback = transcript[-1].get("feedback", "")

                    sent = await safe_send_json(
                        websocket,
                        {
                            "type": "score_update",
                            "technical_score": scores["technical"],
                            "relevance_score": scores["relevance"],
                            "communication_score": scores["communication"],
                            "video_score": scores["video"],
                            "audio_delivery_score": scores["audio_delivery"],
                            "confidence_score": scores["confidence"],
                            "overall_score": scores["overall"],
                            "integrity_score": scores["integrity_score"],
                            "tab_switches": scores["tab_switches"],
                            "copy_events": scores["copy_events"],
                            "paste_events": scores["paste_events"],
                            "fullscreen_exits": scores["fullscreen_exits"],
                            "multiple_faces_events": scores[
                                "multiple_faces_events"
                            ],
                            "feedback": feedback,
                        },
                    )

                    if not sent:
                        # Client is gone -- no point continuing to try to
                        # send more messages or process further input on
                        # this socket. Let the outer loop's connection
                        # check end the session cleanly.
                        print(
                            f"🔌 Client disconnected mid-answer, "
                            f"ending session: {session_id}"
                        )
                        break

                    await safe_send_json(
                        websocket,
                        {
                            "type": "transcript_update",
                            "transcript": make_json_safe(transcript),
                        },
                    )

                    event = extract_event(result)

                    if event["type"] == "question":
                        await safe_send_json(
                            websocket,
                            {"type": "answer_received", "message": "Answer processed."},
                        )
                        await safe_send_json(websocket, event)

                    else:
                        report = event.get("report", "")
                        safe_result = make_json_safe(result)
                        safe_scores = make_json_safe(scores)

                        # SAVE NORMAL COMPLETION TO DATABASE
                        save_interview_to_database(
                            session_id=session_id,
                            state=safe_result,
                            scores=safe_scores,
                            report=report,
                            ended_early=False,
                        )

                        await safe_send_json(
                            websocket,
                            {
                                "type": "final_report",
                                "report": report,
                                "scores": safe_scores,
                            },
                        )

                        await safe_send_json(
                            websocket,
                            {
                                "type": "interview_complete",
                                "report": report,
                                "scores": safe_scores,
                            },
                        )

                        print("🏁 Interview completed")

                        break

                except asyncio.TimeoutError:
                    print(
                        f"❌ ANSWER TIMEOUT after {GRAPH_INVOKE_TIMEOUT_SECONDS}s"
                    )
                    await safe_send_json(
                        websocket,
                        {
                            "type": "error",
                            "message": (
                                "Timed out scoring your answer. "
                                "Please try again."
                            ),
                        },
                    )

                except Exception as e:
                    print("❌ ANSWER ERROR:", repr(e))
                    traceback.print_exc()
                    await safe_send_json(
                        websocket, {"type": "error", "message": str(e)}
                    )

                continue

            # =================================================
            # END INTERVIEW
            # =================================================

            if action in ("end", "finish_interview"):

                print("🛑 Interview ended by user")

                try:
                    snapshot = await run_in_threadpool(graph.get_state, config)

                    state = (
                        snapshot.values if snapshot and snapshot.values else {}
                    )

                    state = make_json_safe(state)

                    transcript = state.get("transcript", [])

                    scores = extract_scores(state)

                    counts = cheat_events.get(session_id, _empty_cheat_counts())
                    scores.update(counts)
                    scores["integrity_score"] = calculate_integrity_score(counts)

                    print("========== FINAL EARLY SCORE ==========")
                    print("Questions answered:", len(transcript))
                    print("Scores:", scores)
                    print("Transcript:", transcript)
                    print("======================================")

                    questions_answered = len(transcript)
                    max_q = state.get("max_questions", MAX_QUESTIONS)

                    if questions_answered == 0:
                        report = (
                            "The interview was ended before any questions "
                            "were answered, so there is no performance "
                            "data to report."
                        )
                    else:
                        report = (
                            f"Interview ended early by the candidate after "
                            f"{questions_answered} of {max_q} questions. "
                            f"The scores below reflect the "
                            f"{questions_answered} completed answer(s)."
                        )

                    # SAVE EARLY INTERVIEW TO DATABASE
                    save_interview_to_database(
                        session_id=session_id,
                        state=state,
                        scores=scores,
                        report=report,
                        ended_early=True,
                    )

                    await safe_send_json(
                        websocket,
                        {"type": "final_report", "report": report, "scores": scores},
                    )

                    await safe_send_json(
                        websocket,
                        {
                            "type": "interview_complete",
                            "report": report,
                            "scores": scores,
                        },
                    )

                    print(
                        f"📤 Sent final_report (early finish, "
                        f"{questions_answered}/{max_q} answered)"
                    )

                except Exception as e:
                    print("❌ FINISH ERROR:", repr(e))
                    traceback.print_exc()
                    await safe_send_json(
                        websocket,
                        {
                            "type": "ended",
                            "message": (
                                "Interview ended, but the report could "
                                f"not be generated: {e}"
                            ),
                        },
                    )

                break

            # =================================================
            # UNKNOWN
            # =================================================

            print("⚠️ Unknown action:", action)

            await safe_send_json(
                websocket, {"type": "error", "message": f"Unknown action: {action}"}
            )

    except WebSocketDisconnect:
        print(f"❌ WebSocket disconnected: {session_id}")

    except RuntimeError as e:
        # FIX: this is the same class of error your traceback showed --
        # a receive/send attempted after Starlette already tore the
        # socket down. Treat it the same as a normal disconnect instead
        # of letting it fall through to the generic handler below and
        # print a scary (but harmless) traceback every time a client
        # closes the tab mid-request.
        print(f"🔌 WebSocket already closed for session {session_id}: {e!r}")

    except Exception as e:
        print(f"❌ WebSocket error: {type(e).__name__}: {e}")
        traceback.print_exc()

        try:
            await safe_send_json(websocket, {"type": "error", "message": str(e)})
        except Exception:
            pass

    finally:
        video_frames.pop(session_id, None)
        cheat_events.pop(session_id, None)
        session_locks.pop(session_id, None)
        print(f"🧹 Session cleaned: {session_id}")