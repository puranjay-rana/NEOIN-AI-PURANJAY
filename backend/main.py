from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import socket
import traceback
import uuid
from typing import Dict, List

import pdfplumber
import mysql.connector
import edge_tts

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Response,
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
# TEXT-TO-SPEECH (edge-tts -- free access to Azure's Neural voices,
# no API key or account needed)
# ============================================================

# Maps our frontend's BCP-47 language codes to a specific Azure Neural
# voice name. edge-tts exposes Microsoft Edge's online read-aloud
# service, which uses the same Neural voice catalog as paid Azure
# Cognitive Speech -- meaning these sound dramatically more natural than
# gTTS, and cover languages (like Odia) that gTTS doesn't support at all.
EDGE_TTS_VOICE_MAP = {
    "en-US": "en-US-AriaNeural",
    "hi-IN": "hi-IN-SwaraNeural",
    "es-ES": "es-ES-ElviraNeural",
    "fr-FR": "fr-FR-DeniseNeural",
    "de-DE": "de-DE-KatjaNeural",
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "ja-JP": "ja-JP-NanamiNeural",
    "ar-SA": "ar-SA-ZariyahNeural",
    "pt-BR": "pt-BR-FranciscaNeural",
    "ru-RU": "ru-RU-SvetlanaNeural",
    "ta-IN": "ta-IN-PallaviNeural",
    "te-IN": "te-IN-ShrutiNeural",
    "kn-IN": "kn-IN-SapnaNeural",
    "bn-IN": "bn-IN-TanishaaNeural",
    "or-IN": "or-IN-SubhasiniNeural",
}


def _is_dns_failure(exc: Exception) -> bool:
    """True if `exc` looks like a DNS/network-unreachable failure rather
    than a transient handshake blip. edge-tts calls out to
    speech.platform.bing.com over the network; if DNS can't resolve that
    host at all (aiohttp.ClientConnectorDNSError wrapping a
    socket.gaierror), retrying half a second later will fail again for
    the exact same reason -- it just adds latency and makes it more
    likely the client gives up waiting. Fail fast instead."""
    if isinstance(exc, socket.gaierror):
        return True
    cause = exc.__cause__
    if isinstance(cause, socket.gaierror):
        return True
    return "DNSError" in type(exc).__name__ or "getaddrinfo failed" in str(exc)


async def synthesize_question_audio(text: str, language_code: str) -> str:
    """Generates MP3 speech for `text` in the given language via edge-tts
    and returns it as a base64 string. Returns "" on any failure -- this
    calls out to Microsoft's online service over the network, so an
    outage (or an unmapped language_code / unsupported voice) must never
    block the interview; the frontend falls back to the browser's
    built-in speechSynthesis voice whenever audio_b64 comes back empty.

    Retries once with a short backoff for transient handshake failures
    (edge-tts, an unofficial client of Microsoft's Edge read-aloud
    service, occasionally drops the websocket mid-handshake even for a
    valid voice). But if the failure is a DNS/network-unreachable error,
    we skip the retry and fail immediately -- that kind of failure won't
    resolve itself in 0.5 seconds, and retrying just delays the fallback
    response to the client.
    """
    if not text or not text.strip():
        return ""

    voice = EDGE_TTS_VOICE_MAP.get(language_code, "en-US-AriaNeural")

    last_error: Exception | None = None

    for attempt in range(2):
        try:
            communicate = edge_tts.Communicate(text, voice)
            buffer = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buffer.write(chunk["data"])
            audio_bytes = buffer.getvalue()
            if audio_bytes:
                return base64.b64encode(audio_bytes).decode("utf-8")
            print(
                f"⚠️ edge-tts returned no audio (attempt {attempt + 1}/2, "
                f"lang={language_code}, voice={voice})"
            )
        except Exception as e:
            last_error = e
            print(
                f"⚠️ edge-tts synthesis failed (attempt {attempt + 1}/2, "
                f"lang={language_code}, voice={voice}): {e!r}"
            )

            if _is_dns_failure(e):
                print(
                    "⚠️ That looks like a DNS/network failure reaching "
                    "speech.platform.bing.com, not a transient blip -- "
                    "skipping retry. Check this server's internet/DNS "
                    "access (try `nslookup speech.platform.bing.com`)."
                )
                break

        if attempt == 0:
            await asyncio.sleep(0.5)

    if last_error is not None:
        print(
            f"⚠️ edge-tts gave up (lang={language_code}, voice={voice}): "
            f"{last_error!r}"
        )

    return ""


# ============================================================
# DATABASE
# ============================================================

MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_USER = os.environ.get("MYSQL_USER", "root")
# BUGFIX: never hardcode a real password as the fallback default here --
# it ends up committed to source control, baked into Docker images, and
# visible to anyone with read access to this file. MYSQL_PASSWORD must
# now be set via environment variable (e.g. a .env file that is NOT
# checked into git); we fail fast at startup instead of silently
# connecting with a stale/leaked credential.
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD")
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "interviews_db")

if not MYSQL_PASSWORD:
    raise RuntimeError(
        "MYSQL_PASSWORD environment variable is not set. "
        "Set it (e.g. in a .env file that is gitignored) before starting the server."
    )


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

CHEAT_PENALTIES = {
    "tab_switches": 5,
    "copy_events": 10,
    "paste_events": 10,
    "fullscreen_exits": 5,
    "multiple_faces_events": 15,
}


def calculate_integrity_score(cheat_counts: dict) -> int:
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
        "http://localhost:3000",
        "http://127.0.0.1:3000",
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
HEARTBEAT_INTERVAL_SECONDS = 4


async def safe_send_json(websocket: WebSocket, payload: dict) -> bool:
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
cheat_events: Dict[str, Dict[str, int]] = {}


# ============================================================
# MODEL WARM-UP
# ============================================================

@app.on_event("startup")
async def warm_up_models():

    try:
        ensure_database_exists()
        init_db()
        print("✅ Database initialization completed")
    except Exception as e:
        print("⚠️ Database initialization failed:", repr(e))

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
# HEALTH
# ============================================================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI Mock Interview"}


# ============================================================
# FAVICON
# ============================================================

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    # This API serves no favicon file. Returning 204 here (instead of
    # letting the request fall through to FastAPI's default 404)
    # stops routine browser favicon requests from showing up as
    # errors in the server logs.
    return Response(status_code=204)


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


@app.get("/interview/upload-resume")
async def upload_resume_info():
    """
    GET is not a valid way to upload a resume -- this route only accepts
    POST with a multipart PDF file (see `upload_resume` above). This
    handler exists so a stray GET (someone navigating to the URL
    directly, a health-check hitting the wrong method, etc.) gets a
    clean, informative 200 response instead of a 405 cluttering the
    server logs.
    """
    return {
        "success": False,
        "message": "This endpoint only accepts POST requests with a PDF file upload.",
    }


# ============================================================
# EXTRACT LANGGRAPH EVENT
# ============================================================

async def extract_event(result):
    """Builds the message sent to the frontend after each graph.invoke().

    Generates the spoken-question audio (via edge-tts, in whatever
    language the candidate picked at start) and attaches it as
    `audio_b64`. The frontend plays this file directly instead of relying
    on the browser's own speechSynthesis voice -- edge-tts gives us
    genuine Azure Neural voices (far more natural than a browser voice,
    and with real coverage of languages like Odia that many browsers
    don't ship a decent voice for at all), and we can also mix this audio
    into the full-session recording.

    If edge-tts fails for any reason, audio_b64 comes back as "" and the
    frontend already knows to fall back to speechSynthesis in that case --
    so a TTS outage never blocks the interview.
    """

    interrupts = result.get("__interrupt__")

    if interrupts:
        interrupt_obj = interrupts[0]
        value = interrupt_obj.value

        if isinstance(value, dict):
            question_text = value.get("question", "No question generated.")
            language_code = result.get("language_code", "en-US")

            return {
                "type": "question",
                "question": question_text,
                "question_number": value.get("question_number", 1),
                "audio_b64": await synthesize_question_audio(question_text, language_code),
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

            if websocket.client_state != WebSocketState.CONNECTED:
                print(f"🔌 Socket no longer connected, exiting loop: {session_id}")
                break

            try:
                raw = await websocket.receive_text()
            except (WebSocketDisconnect, RuntimeError) as e:
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
                print("Language:", msg.get("language_code"), msg.get("language_name"))

            print("========================================")

            if action == "video_frame":
                frame = msg.get("frame_b64", "")

                if frame:
                    video_frames[session_id].append(frame)

                    # Only ~12 evenly-spaced frames are ever actually
                    # analyzed per answer (see MAX_FRAMES_FORWARDED /
                    # vision_agent's MAX_FRAMES_TO_ANALYZE) -- holding
                    # hundreds of raw base64 JPEGs per session for the
                    # full duration of a long answer just for that is
                    # wasted memory. Lowered from 300 to 90 (still 5x more
                    # than we'll ever sample down to).
                    MAX_BUFFERED_FRAMES = 90
                    if len(video_frames[session_id]) > MAX_BUFFERED_FRAMES:
                        video_frames[session_id] = video_frames[session_id][-MAX_BUFFERED_FRAMES:]

                continue

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
                    # Candidate-selected interview language. Defaults to
                    # English so an older frontend build (or any client
                    # that never sends these) still works unchanged.
                    "language_code": msg.get("language_code", "en-US"),
                    "language_name": msg.get("language_name", "English"),
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
                    "candidate_name": msg.get("candidate_name"),
                    "applied_role": msg.get("applied_role"),
                }

                print("🚀 Starting LangGraph interview")

                try:
                    result = await invoke_graph(initial_state, config, websocket)
                    event = await extract_event(result)

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

                # BUGFIX: previously forwarded the ENTIRE buffered frame
                # list (up to 300 raw base64 JPEGs) into graph state via
                # Command(resume=...). For a multi-minute answer that's
                # 100+ frames -- tens of MB -- and LangGraph's MemorySaver
                # checkpoints the full state after every node transition
                # for the rest of the turn (and keeps checkpoint history
                # for the whole session). That memory/serialization spike
                # is the most likely cause of the server crashing
                # (WebSocket code 1011) specifically on longer answers.
                # vision_agent only ever samples MAX_FRAMES_TO_ANALYZE (12)
                # evenly-spaced frames anyway -- pre-sample down to that
                # same count here, before any of this touches graph state.
                MAX_FRAMES_FORWARDED = 12
                if len(frames_b64) > MAX_FRAMES_FORWARDED:
                    step = len(frames_b64) / MAX_FRAMES_FORWARDED
                    frames_b64 = [
                        frames_b64[int(i * step)] for i in range(MAX_FRAMES_FORWARDED)
                    ]
                    print(f"🎥 Downsampled to {len(frames_b64)} frames before sending to graph")

                payload = {
                    "audio_b64": audio_b64,
                    "frames_b64": frames_b64,
                    "text": text,
                }

                video_frames[session_id] = []
                try:
                    result = await invoke_graph(Command(resume=payload), config, websocket)

                    scores = extract_scores(result)
                    counts = cheat_events.get(session_id, _empty_cheat_counts())
                    scores.update(counts)
                    scores["integrity_score"] = calculate_integrity_score(counts)

                    transcript = result.get("transcript", [])

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
                    event = await extract_event(result)
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

            print("⚠️ Unknown action:", action)

            await safe_send_json(
                websocket, {"type": "error", "message": f"Unknown action: {action}"}
            )

    except WebSocketDisconnect:
        print(f"❌ WebSocket disconnected: {session_id}")

    except RuntimeError as e:
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
        print(f"🧹 Session cleaned: {session_id}")