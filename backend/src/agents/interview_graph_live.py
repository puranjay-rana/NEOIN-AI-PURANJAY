# from __future__ import annotations
# import cv2
# import dataclasses
# import os
# import base64
# import json
# import operator
# import tempfile
# import traceback
# from typing import Annotated, List, Literal, Optional, TypedDict

# from langchain_core.messages import HumanMessage
# from langgraph.graph import StateGraph, START, END
# from langgraph.checkpoint.memory import MemorySaver
# from langgraph.types import interrupt, Command  # noqa: F401  (Command re-exported for server use)

# from src.config import get_llm

# # NEW: your existing video-resume analysis module. AudioAnalyzer loads
# # Whisper (+ spaCy/textstat/librosa where available), VisualAnalyzer runs
# # the Haar-cascade based frame scoring, ScoreEngine combines the two into
# # an OverallScore. See src/video_analysis/*.py.


# from src.video_analysis.audio_analyzer import AudioAnalyzer
# from src.video_analysis.visual_analyzer import VisualAnalyzer
# from src.video_analysis.score_engine import ScoreEngine
# from src.video_analysis.models import AudioMetrics, VisualMetrics

# llm = get_llm(temperature=0.4)

# import warnings
# warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")


# # ---------------------------------------------------------------------------
# # FIX: msgpack/numpy sanitizer
# # ---------------------------------------------------------------------------

# def _to_native(value):
#     """Recursively converts a value into plain Python types (dict/list/
#     float/int/str/bool/None) so it's safe to put into LangGraph state.

#     This is the actual fix for:

#         TypeError: Type is not msgpack serializable: numpy.float64

#     which crashed graph.invoke() -> checkpointer.put_writes() whenever the
#     state contained a raw AudioMetrics / VisualMetrics instance. Those
#     dataclasses are built from cv2 / librosa computations, so several of
#     their numeric fields are numpy.float64/np.float32, not plain Python
#     float -- and ormsgpack (LangGraph's checkpoint serializer) has no
#     encoder for numpy scalar types.

#     Storing the raw dataclass instance in state is ALSO what caused the
#     separate warning:

#         Deserializing unregistered type
#         src.video_analysis.models.AudioMetrics from checkpoint

#     because LangGraph's default serde doesn't know how to round-trip
#     arbitrary custom classes. Converting to a plain dict here (via
#     dataclasses.asdict-style field walk) before it ever touches state
#     fixes both problems at once -- the state now only ever holds
#     dict/list/float/str/bool/None.
#     """
#     if value is None:
#         return None

#     if dataclasses.is_dataclass(value) and not isinstance(value, type):
#         return {
#             f.name: _to_native(getattr(value, f.name))
#             for f in dataclasses.fields(value)
#         }

#     if isinstance(value, dict):
#         return {str(k): _to_native(v) for k, v in value.items()}

#     if isinstance(value, (list, tuple)):
#         return [_to_native(v) for v in value]

#     try:
#         import numpy as np

#         if isinstance(value, np.generic):
#             return value.item()
#         if isinstance(value, np.ndarray):
#             return value.tolist()
#     except Exception:
#         pass

#     return value


# # ---------------------------------------------------------------------------
# # State
# # ---------------------------------------------------------------------------
# class QAItem(TypedDict):
#     question: str
#     difficulty: str
#     answer: str
#     eval_score: float           # technical correctness/depth, 0-10
#     relevance_score: float      # how relevant the answer is to the question/role, 0-10
#     communication_score: float  # clarity/structure of the answer, 0-10
#     confidence_score: float     # blended visual+vocal confidence, 0-1
#     visual_score: float         # src.video_analysis ScoreEngine visual_score, 0-100 (0 if no frames)
#     audio_delivery_score: float # src.video_analysis ScoreEngine audio_score, 0-100 (0 if no audio)
#     delivery_detail: dict       # {"visual": {...}, "audio": {...}} per-metric breakdown (eye_contact_score, filler_words, pace, etc.) or {}
#     multiple_faces_detected: bool  # anti-cheating proctoring flag for this turn
#     looking_away_detected: bool  # gaze-tracking proctoring flag for this turn
#     feedback: str


# class InterviewState(TypedDict):
#     resume_text: str
#     job_description: str
#     skills: List[str]
#     role_summary: str
#     difficulty: str
#     questions_asked: int
#     max_questions: int

#     current_question: str
#     current_audio_b64: str  # raw mic audio from browser (webm/opus)
#     current_frames_b64: List[str]  # webcam jpeg frames captured during answer
#     current_answer_text: str
#     # FIX: these are now plain JSON-safe dicts (via _to_native), NOT raw
#     # AudioMetrics/VisualMetrics instances -- see _to_native() docstring.
#     current_audio_metrics: Optional[dict]
#     current_visual_metrics: Optional[dict]
#     current_multiple_faces_detected: bool  # >1 face held across several consecutive sampled frames
#     current_looking_away_detected: bool  # gaze away from camera across several consecutive sampled frames
#     current_confidence_score: float
#     current_eval_score: float
#     current_relevance_score: float
#     current_communication_score: float
#     current_eval_feedback: str

#     transcript: Annotated[List[QAItem], operator.add]
#     final_report: str

# def _parse_json_block(raw: str) -> str:
#     return raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()


# def _extract_text(content) -> str:
#     """Normalize LangChain message content to a plain string.
#     Newer Gemini models sometimes return content as a list of blocks
#     (e.g. [{"type": "text", "text": "..."}]) instead of a plain string.
#     """
#     if content is None:
#         return ""
#     if isinstance(content, str):
#         return content
#     if isinstance(content, list):
#         parts = []
        
#         for block in content:
#             if isinstance(block, str):
#                 parts.append(block)
#             elif isinstance(block, dict):
#                 parts.append(block.get("text", ""))
#         return "".join(parts)
#     return str(content)

# def _safe_llm_invoke(prompt: str, *, fallback: str = "") -> str:
#     """Wraps llm.invoke so a network/API failure doesn't hang or silently
#     kill the whole websocket handler. Tries every (model, key) instance
#     from get_llm_with_fallback() in order -- a timeout or API error on one
#     instance moves to the next instead of returning `fallback` immediately.
#     Only returns `fallback` if every instance in the chain fails."""
#     import time
#     from src.config import get_llm_with_fallback

#     instances = get_llm_with_fallback(temperature=0.4)
#     last_error = None

#     for idx, instance in enumerate(instances):
#         started = time.monotonic()
#         try:
#             resp = instance.invoke([HumanMessage(content=prompt)])
#             print(f"⏱️ LLM call took {time.monotonic() - started:.1f}s (instance {idx})")
#             return _extract_text(resp.content).strip()
#         except Exception as e:
#             print(f"❌ LLM instance {idx} failed after {time.monotonic() - started:.1f}s:")
#             traceback.print_exc()
#             last_error = e
#             continue

#     print(f"❌ All {len(instances)} LLM fallback instances failed. Last error: {last_error!r}")
#     return fallback


# # ---------------------------------------------------------------------------
# # Resume Agent
# # ---------------------------------------------------------------------------

# def resume_agent(state: InterviewState) -> dict:
#     prompt = f"""Extract 6-10 relevant skills and a one-sentence role summary
# from this resume and job description. Return STRICT JSON only:
# {{"skills": [...], "role_summary": "..."}}

# RESUME:
# {state['resume_text']}

# JOB DESCRIPTION:
# {state['job_description']}
# """
#     raw = _safe_llm_invoke(prompt)
#     raw = _parse_json_block(raw)
#     try:
#         data = json.loads(raw)
#     except json.JSONDecodeError:
#         data = {"skills": ["general problem solving"], "role_summary": "General technical role"}
#     return {
#         "skills": data.get("skills", []),
#         "role_summary": data.get("role_summary", ""),
#         "difficulty": "medium",
#         "questions_asked": 0,
#         "transcript": [],
#     }
# # ---------------------------------------------------------------------------
# # Question Agent
# # ---------------------------------------------------------------------------
# def question_agent(state: InterviewState) -> dict:
#     asked = [t["question"] for t in state["transcript"]]
#     prompt = f"""Role focus: {state['role_summary']}
# Skills to probe: {state['skills']}
# Difficulty: {state['difficulty']}
# Already asked (don't repeat): {asked}

# Write ONE interview question at this difficulty. Return only the question text.
# """
#     question = _safe_llm_invoke(
#         prompt,
#         fallback=f"Tell me about your experience with {(state['skills'] or ['this role'])[0]}.",
#     )
#     return {"current_question": question}


# # ---------------------------------------------------------------------------
# # Ask Question — THE LIVE PAUSE POINT
# # ---------------------------------------------------------------------------
# def ask_question(state: InterviewState) -> dict:
#     # Pausing here hands control to the FastAPI layer. It resumes this node
#     # with Command(resume={"audio_b64": ..., "frames_b64": [...], "text": ...}).
#     payload = interrupt(
#         {
#             "type": "question",
#             "question": state["current_question"],
#             "question_number": state["questions_asked"] + 1,
#         }
#     )
#     return {
#         "current_audio_b64": payload.get("audio_b64", ""),
#         "current_frames_b64": payload.get("frames_b64", []),
#         # NOTE: we still stash the frontend's typed/spoken text here, but
#         # speech_agent below now treats it as a FALLBACK, not the primary
#         # source, whenever real audio was recorded -- see speech_agent.
#         "current_answer_text": payload.get("text", ""),
#         # Reset per-turn scratch so a text-only or frame-less answer doesn't
#         # inherit stale metrics from the previous question.
#         "current_audio_metrics": None,
#         "current_visual_metrics": None,
#         "current_multiple_faces_detected": False,
#         "current_looking_away_detected": False,
#     }
# # ---------------------------------------------------------------------------
# # Speech Agent (real STT + delivery scoring via src.video_analysis)
# # ---------------------------------------------------------------------------
# _audio_analyzer: Optional[AudioAnalyzer] = None


# def _get_audio_analyzer() -> AudioAnalyzer:
#     global _audio_analyzer
#     if _audio_analyzer is None:
#         _audio_analyzer = AudioAnalyzer()  # loads Whisper (+ spaCy if available) once
#     return _audio_analyzer


# def speech_agent(state: InterviewState) -> dict:
#     """Resolves the final `current_answer_text` used for scoring.

#     FIX (root cause of near-0% technical/relevance/communication scores):
#     This used to return early whenever the frontend's `current_answer_text`
#     (populated from the browser's built-in Web Speech API) was non-empty --
#     which is almost always, since the frontend sends it on every voice
#     submission. That meant server-side Whisper transcription of the actual
#     recorded audio_b64 NEVER ran, even though it's already loaded/warmed up.

#     The browser's Web Speech API is a lightweight generic STT that badly
#     mangles domain-specific technical vocabulary (ML/data-science terms
#     like "Pipeline", "SimpleImputer", "covariate shift", "cross-validation").
#     That garbled text was what evaluation_agent's LLM saw and correctly
#     graded as incoherent -- the scoring itself wasn't broken, it was being
#     fed bad input.

#     Fix: whenever real audio was recorded, prefer Whisper's transcription
#     of it (far more reliable for technical speech). Only fall back to the
#     frontend-supplied text (typed answer, or Web Speech API result) if
#     Whisper fails or produces nothing usable.
#     """
#     audio_b64 = state.get("current_audio_b64", "")
#     fallback_text = state.get("current_answer_text", "").strip()

#     if audio_b64:
#         import time
#         started = time.monotonic()
#         temp_path = None
#         try:
#             audio_bytes = base64.b64decode(audio_b64)
#             with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
#                 f.write(audio_bytes)
#                 webm_path = f.name
#             temp_path = webm_path.replace(".webm", ".wav")
#             import subprocess
#             subprocess.run(
#                 [
#                     "ffmpeg", "-y", "-i", webm_path,
#                     "-ar", "16000", "-ac", "1",
#                     temp_path,
#                 ],
#                 check=True,
#                 stdout=subprocess.DEVNULL,
#                 stderr=subprocess.DEVNULL,
#             )
#             os.remove(webm_path)

#             analyzer = _get_audio_analyzer()
#             metrics: AudioMetrics = analyzer.analyze_audio(temp_path)
#             transcript = metrics.transcript.strip()
#             print(
#                 f"⏱️ speech_agent (Whisper) took {time.monotonic() - started:.1f}s "
#                 f"| transcript length: {len(transcript)}"
#             )
#             print(f"📝 Whisper transcript: {transcript[:300]!r}")
#             if fallback_text:
#                 print(f"📝 Browser (Web Speech API) text: {fallback_text[:300]!r}")

#             if transcript:
#                 # FIX: sanitize before it ever touches graph state -- see
#                 # _to_native() docstring. metrics.speaking_speed / .
#                 # confidence_score / etc. come out of librosa as numpy
#                 # scalars, which is what crashed the checkpoint write.
#                 return {
#                     "current_answer_text": transcript,
#                     "current_audio_metrics": _to_native(metrics),
#                 }

#             print("⚠️ Whisper produced an empty transcript, falling back to browser text.")
#         except Exception:
#             print(f"❌ speech_agent (Whisper) failed after {time.monotonic() - started:.1f}s:")
#             traceback.print_exc()
#         finally:
#             if temp_path and os.path.exists(temp_path):
#                 os.remove(temp_path)

#     # Fallback: typed answer, or Web Speech API text if Whisper failed /
#     # produced nothing / there was no audio at all.
#     if fallback_text:
#         return {"current_answer_text": fallback_text}

#     return {"current_answer_text": "", "current_audio_metrics": None}

# # ---------------------------------------------------------------------------
# # Vision Agent (real facial/posture scoring via src.video_analysis)
# # ---------------------------------------------------------------------------
# _visual_analyzer: Optional[VisualAnalyzer] = None


# def _get_visual_analyzer() -> VisualAnalyzer:
#     global _visual_analyzer
#     if _visual_analyzer is None:
#         _visual_analyzer = VisualAnalyzer()
#     return _visual_analyzer


# # ---------------------------------------------------------------------------
# # Anti-cheating -- lightweight multi-face detection
# # ---------------------------------------------------------------------------
# _face_cascade = None


# def _get_face_cascade():
#     """Cached Haar cascade for a cheap frontal-face count per frame.
#     Reuses the same class of detector already used elsewhere in the
#     project, so no new dependency is introduced."""
#     global _face_cascade
#     if _face_cascade is None:
#         cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
#         _face_cascade = cv2.CascadeClassifier(cascade_path)
#     return _face_cascade


# # A single frame with >1 face is noise (motion blur, a poster, someone
# # walking behind the candidate). Only flag it once multiple faces show up
# # in at least this many of the (sparsely spaced) *sampled* frames.
# #
# # FIX: this used to require MULTI_FACE_CONSECUTIVE_THRESHOLD frames *in a
# # row* out of only ~6 samples spread evenly across the whole answer (see
# # MAX_FRAMES_TO_ANALYZE below) -- e.g. 6 samples over a 117-frame/~2-minute
# # answer means each sample is ~20 real seconds apart. Requiring 3
# # *consecutive* sampled hits meant a second person had to stay in frame
# # continuously for ~40-60 real seconds AND happen to land on 3 samples in
# # a row -- in practice this almost never fired even when a second person
# # genuinely was visible. Given the sampling is already sparse, a simple
# # count (not "in a row") of flagged samples is the more meaningful signal.
# MULTI_FACE_FLAG_THRESHOLD = 2


# # ---------------------------------------------------------------------------
# # Anti-cheating -- gaze / "looking away" detection via MediaPipe
# # FaceLandmarker (Tasks API), using the iris landmarks it outputs to check
# # whether the candidate's eyes are pointed away from the camera (e.g.
# # reading notes off-screen or a second monitor).
# #
# # NOTE: as of mediapipe>=0.10, the legacy `mp.solutions.face_mesh` API is
# # gone -- this requires the newer Tasks API, which in turn requires a
# # separate model file (face_landmarker.task) that isn't bundled with the
# # pip package and must be downloaded once. Get it from:
# #   https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
# # and either place it at the path below or point GAZE_MODEL_PATH (env var)
# # at it. If the file is missing, gaze detection silently no-ops (treated
# # the same as "no face detected this frame") rather than crashing frame
# # analysis for everyone.
# # ---------------------------------------------------------------------------
# GAZE_MODEL_PATH = os.environ.get(
#     "GAZE_MODEL_PATH",
#     os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task"),
# )
# # A single frame of "looking away" is normal (glancing at the question on
# # screen, blinking, natural eye movement). Only flag it once it persists
# # across this many consecutive *sampled* frames -- mirrors
# # MULTI_FACE_CONSECUTIVE_THRESHOLD above.
# GAZE_AWAY_CONSECUTIVE_THRESHOLD = 3
# # How far (as a fraction of eye width/height, 0.5 = dead center) the iris
# # can drift before we call it "away" rather than natural eye movement.
# GAZE_HORIZONTAL_THRESHOLD = 0.20
# GAZE_VERTICAL_THRESHOLD = 0.20

# _gaze_landmarker = None
# _gaze_landmarker_load_failed = False

# # MediaPipe FaceLandmarker landmark indices (478-point model, same indexing
# # as the old face_mesh "refine_landmarks" output). Iris centers + the eye
# # corner/eyelid points needed to normalize iris position within the eye.
# _RIGHT_IRIS = 468
# _LEFT_IRIS = 473
# _RIGHT_EYE_H = (33, 133)    # outer, inner corner
# _RIGHT_EYE_V = (159, 145)   # top, bottom eyelid
# _LEFT_EYE_H = (362, 263)    # inner, outer corner
# _LEFT_EYE_V = (386, 374)    # top, bottom eyelid


# def _get_gaze_landmarker():
#     """Lazily creates the MediaPipe FaceLandmarker. Returns None (and
#     prints once) if the mediapipe package or the model file isn't
#     available, so callers can treat "can't determine gaze" the same as
#     "no face this frame" instead of crashing."""
#     global _gaze_landmarker, _gaze_landmarker_load_failed
#     if _gaze_landmarker is not None or _gaze_landmarker_load_failed:
#         return _gaze_landmarker
#     try:
#         import mediapipe as mp

#         if not os.path.exists(GAZE_MODEL_PATH):
#             raise FileNotFoundError(
#                 f"face_landmarker.task not found at {GAZE_MODEL_PATH!r} -- "
#                 "download it from https://storage.googleapis.com/mediapipe-models/"
#                 "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
#             )
#         options = mp.tasks.vision.FaceLandmarkerOptions(
#             base_options=mp.tasks.BaseOptions(model_asset_path=GAZE_MODEL_PATH),
#             running_mode=mp.tasks.vision.RunningMode.IMAGE,
#             num_faces=1,
#         )
#         _gaze_landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
#         print("✅ Gaze detector (MediaPipe FaceLandmarker) loaded.")
#     except Exception as e:
#         _gaze_landmarker_load_failed = True
#         print(f"⚠️ Gaze detector unavailable, looking-away detection disabled: {e}")
#     return _gaze_landmarker


# def _iris_offset_ratio(landmarks, iris_idx, h_idx, v_idx):
#     """Returns (horizontal_ratio, vertical_ratio) for one eye, each in
#     [0, 1] where 0.5 is dead-center. Values are normalized-image-space
#     (0-1) coordinates straight from MediaPipe, so no pixel dims needed."""
#     iris = landmarks[iris_idx]
#     h0, h1 = landmarks[h_idx[0]], landmarks[h_idx[1]]
#     v0, v1 = landmarks[v_idx[0]], landmarks[v_idx[1]]

#     h_span = h1.x - h0.x
#     v_span = v1.y - v0.y
#     h_ratio = (iris.x - h0.x) / h_span if abs(h_span) > 1e-6 else 0.5
#     v_ratio = (iris.y - v0.y) / v_span if abs(v_span) > 1e-6 else 0.5
#     return h_ratio, v_ratio


# def _is_looking_away(img) -> Optional[bool]:
#     """Runs MediaPipe FaceLandmarker on one decoded BGR frame and returns
#     True if the candidate's gaze is off-center beyond the configured
#     thresholds, False if gaze looks centered, or None if gaze couldn't be
#     determined this frame (no landmarker available, no face found) --
#     callers should treat None as "skip this frame", same as a failed
#     face-cascade detection, not as "not looking away"."""
#     landmarker = _get_gaze_landmarker()
#     if landmarker is None:
#         return None
#     try:
#         import mediapipe as mp

#         rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
#         mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
#         result = landmarker.detect(mp_image)
#         if not result.face_landmarks:
#             return None
#         landmarks = result.face_landmarks[0]

#         r_h, r_v = _iris_offset_ratio(landmarks, _RIGHT_IRIS, _RIGHT_EYE_H, _RIGHT_EYE_V)
#         l_h, l_v = _iris_offset_ratio(landmarks, _LEFT_IRIS, _LEFT_EYE_H, _LEFT_EYE_V)
#         avg_h = (r_h + l_h) / 2
#         avg_v = (r_v + l_v) / 2

#         return (
#             abs(avg_h - 0.5) > GAZE_HORIZONTAL_THRESHOLD
#             or abs(avg_v - 0.5) > GAZE_VERTICAL_THRESHOLD
#         )
#     except Exception:
#         traceback.print_exc()
#         return None


# def _average_visual_metrics(metrics_list: List[VisualMetrics]) -> VisualMetrics:
#     """Average per-frame VisualMetrics, preferring frames where a face was
#     actually detected (mirrors VideoResumeAnalyzer._average_metrics)."""
#     with_face = [m for m in metrics_list if m.face_detected]
#     basis = with_face or metrics_list

#     def avg(attr: str) -> float:
#         return sum(getattr(m, attr) for m in basis) / len(basis)

#     face_detected_count = sum(1 for m in metrics_list if m.face_detected)
#     return VisualMetrics(
#         eye_contact_score=avg("eye_contact_score"),
#         head_pose_score=avg("head_pose_score"),
#         smile_score=avg("smile_score"),
#         facial_expression_score=avg("facial_expression_score"),
#         body_posture_score=avg("body_posture_score"),
#         confidence=avg("confidence"),
#         face_detected=face_detected_count > len(metrics_list) / 2,
#     )


# def vision_agent(state: InterviewState) -> dict:
#     frames_b64 = state.get("current_frames_b64", [])
#     if not frames_b64:
#         print("⚠️ vision_agent: no frames in state, using default confidence 0.5")
#         return {
#             "current_confidence_score": 0.5,
#             "current_visual_metrics": None,
#             "current_multiple_faces_detected": False,
#             "current_looking_away_detected": False,
#         }

#     try:
#         import numpy as np
#         import cv2
#     except Exception:
#         print("❌ vision_agent: cv2 not available, using default confidence")
#         return {
#             "current_confidence_score": 0.5,
#             "current_visual_metrics": None,
#             "current_multiple_faces_detected": False,
#             "current_looking_away_detected": False,
#         }

#     import time
#     started = time.monotonic()

#     # Sample more evenly-spaced frames now that face-count checking is a
#     # cheap Haar-cascade call decoupled from the heavier visual-delivery
#     # analysis (see the per-check try/except above) -- more samples means
#     # a better chance of actually catching a second person who wasn't in
#     # frame for the entire answer.
#     MAX_FRAMES_TO_ANALYZE = 12
#     if len(frames_b64) > MAX_FRAMES_TO_ANALYZE:
#         step = len(frames_b64) / MAX_FRAMES_TO_ANALYZE
#         frames_to_analyze = [
#             frames_b64[int(i * step)] for i in range(MAX_FRAMES_TO_ANALYZE)
#         ]
#     else:
#         frames_to_analyze = frames_b64

#     analyzer = _get_visual_analyzer()
#     face_cascade = _get_face_cascade()
#     frame_metrics: List[VisualMetrics] = []
#     # per-frame "more than one face detected" flags, in temporal order,
#     # used to catch a second person sitting in on the interview.
#     multi_face_flags: List[bool] = []
#     # per-frame "gaze pointed away from camera" flags -- None entries (no
#     # landmarker / no face this frame) are skipped rather than counted as
#     # either true or false, so a few undetected frames don't break a
#     # streak or falsely start one.
#     gaze_away_flags: List[bool] = []

#     for frame_b64 in frames_to_analyze:
#         try:
#             img_bytes = base64.b64decode(frame_b64.split(",")[-1])
#             arr = np.frombuffer(img_bytes, dtype=np.uint8)
#             img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
#         except Exception:
#             continue
#         if img is None:
#             continue

#         # FIX: analyze_frame() (visual delivery scoring), the face-count
#         # check (multi-face proctoring), and the gaze check used to share
#         # ONE try/except. If analyze_frame() raised for any reason (e.g. a
#         # transient DeepFace/model error), the `continue` skipped the face
#         # -count check too -- so a single flaky visual-scoring call was
#         # silently disabling multi-face detection for that frame as well.
#         # If it failed on every sampled frame, BOTH "Video & Behavioral
#         # Analytics" (always "--") AND "2 people in frame" detection
#         # (never fires) went dark together, with no error surfaced to the
#         # user. Each check now has its own try/except so one failing does
#         # not take the others down with it.
#         try:
#             frame_metrics.append(analyzer.analyze_frame(img))
#         except Exception:
#             print("⚠️ vision_agent: analyzer.analyze_frame() failed on a frame:")
#             traceback.print_exc()

#         # Lightweight face count on the already-decoded frame -- no
#         # extra decode/IO cost, keeps this cheap per the requirement.
#         # FIX: minSize=(40,40) + minNeighbors=5 was tuned for one
#         # well-lit, mostly-frontal face and routinely missed a second
#         # person who is smaller in frame, further back, or slightly
#         # angled -- both contributing to multi-face never firing.
#         # Loosened so a second, less-ideal face is more likely to count.
#         try:
#             gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
#             faces = face_cascade.detectMultiScale(
#                 gray, scaleFactor=1.05, minNeighbors=4, minSize=(30, 30)
#             )
#             multi_face_flags.append(len(faces) > 1)
#         except Exception:
#             multi_face_flags.append(False)

#         # gaze/look-away check via MediaPipe iris landmarks.
#         try:
#             looking_away = _is_looking_away(img)
#             if looking_away is not None:
#                 gaze_away_flags.append(looking_away)
#         except Exception:
#             pass

#     if not frame_metrics:
#         print("❌ vision_agent: no frames could be analyzed, using default confidence")
#         return {
#             "current_confidence_score": 0.5,
#             "current_visual_metrics": None,
#             "current_multiple_faces_detected": False,
#             "current_looking_away_detected": False,
#         }

#     # FIX: was "3 consecutive" over only ~6 widely-spaced samples (see
#     # MULTI_FACE_FLAG_THRESHOLD above for why) -- now a simple count of
#     # flagged samples, which is the meaningful signal given how sparse
#     # the sampling already is.
#     multi_face_count = sum(1 for flagged in multi_face_flags if flagged)
#     multiple_faces_detected = multi_face_count >= MULTI_FACE_FLAG_THRESHOLD

#     if multiple_faces_detected:
#         print(
#             f"🚨 vision_agent: multiple faces detected in {multi_face_count}/"
#             f"{len(multi_face_flags)} sampled frames"
#         )

#     gaze_max_consecutive = 0
#     gaze_streak = 0
#     for flagged in gaze_away_flags:
#         gaze_streak = gaze_streak + 1 if flagged else 0
#         gaze_max_consecutive = max(gaze_max_consecutive, gaze_streak)
#     looking_away_detected = gaze_max_consecutive >= GAZE_AWAY_CONSECUTIVE_THRESHOLD

#     if looking_away_detected:
#         print(f"👀 vision_agent: gaze away from camera across {gaze_max_consecutive} consecutive frames")

#     visual_metrics = _average_visual_metrics(frame_metrics)
#     # VisualAnalyzer.confidence is 0-100; decision_engine's blend expects 0-1.
#     # FIX: visual_metrics.confidence can be a numpy.float64 (it's an
#     # average of cv2-derived scores) -- wrap in float() before rounding so
#     # `current_confidence_score` in state is a native Python float.
#     confidence = float(visual_metrics.confidence) / 100.0

#     print(
#         f"⏱️ vision_agent ({len(frame_metrics)}/{len(frames_b64)} frames) "
#         f"took {time.monotonic() - started:.1f}s"
#     )
#     return {
#         "current_confidence_score": round(confidence, 2),
#         # FIX: sanitize before it ever touches graph state -- see
#         # _to_native() docstring. This is the object that was crashing the
#         # checkpoint write (numpy.float64 fields from cv2 computations)
#         # and triggering the "unregistered type" deserialization warning.
#         "current_visual_metrics": _to_native(visual_metrics),
#         "current_multiple_faces_detected": multiple_faces_detected,
#         "current_looking_away_detected": looking_away_detected,
#     }


# # ---------------------------------------------------------------------------
# # Evaluation Agent
# # ---------------------------------------------------------------------------
# def evaluation_agent(state: InterviewState) -> dict:
#     answer_text = state.get("current_answer_text", "").strip()

#     if not answer_text:
#         # No answer at all -> score everything 0 instead of asking the LLM
#         # to grade a blank response (which it will sometimes score generously).
#         return {
#             "current_eval_score": 0.0,
#             "current_relevance_score": 0.0,
#             "current_communication_score": 0.0,
#             "current_eval_feedback": "No answer was provided.",
#         }

#     prompt = f"""Question: {state['current_question']}
# Difficulty: {state['difficulty']}
# Candidate answer: {answer_text}

# Score the answer 0-10 on THREE separate dimensions:
# - technical_score: correctness and depth of technical content
# - relevance_score: how directly the answer addresses the question asked
# - communication_score: clarity, structure, and conciseness of the answer

# Return STRICT JSON only:
# {{"technical_score": <0-10>, "relevance_score": <0-10>, "communication_score": <0-10>, "feedback": "<1-2 sentences>"}}
# """
#     raw = _safe_llm_invoke(prompt)
#     raw = _parse_json_block(raw)

#     def _clamp(v) -> float:
#         try:
#             return max(0.0, min(10.0, float(v)))
#         except (TypeError, ValueError):
#             return 5.0

#     try:
#         data = json.loads(raw)
#         technical = _clamp(data.get("technical_score", 5))
#         relevance = _clamp(data.get("relevance_score", 5))
#         communication = _clamp(data.get("communication_score", 5))
#         feedback = data.get("feedback", "")
#     except json.JSONDecodeError:
#         technical = relevance = communication = 5.0
#         feedback = "Could not parse evaluation."

#     return {
#         "current_eval_score": technical,
#         "current_relevance_score": relevance,
#         "current_communication_score": communication,
#         "current_eval_feedback": feedback,
#     }


# # ---------------------------------------------------------------------------
# # Decision Engine
# # ---------------------------------------------------------------------------
# DIFFICULTY_ORDER = ["easy", "medium", "hard"]

# _score_engine = ScoreEngine()


# def decision_engine(state: InterviewState) -> dict:
#     eval_score = state.get("current_eval_score", 0.0)
#     relevance_score = state.get("current_relevance_score", eval_score)
#     communication_score = state.get("current_communication_score", eval_score)
#     confidence = state.get("current_confidence_score", 0.5)

#     # FIX: current_visual_metrics / current_audio_metrics are now plain
#     # dicts in state (see vision_agent / speech_agent), not raw
#     # VisualMetrics/AudioMetrics instances -- that's what stopped the
#     # msgpack crash. ScoreEngine's methods still expect attribute access
#     # (visual_metrics.eye_contact_score, etc.), so reconstruct the
#     # dataclass instances here, locally, right before using them. These
#     # reconstructed objects are never returned/stored in state, so they
#     # never touch the checkpointer.
#     visual_metrics_dict = state.get("current_visual_metrics")
#     audio_metrics_dict = state.get("current_audio_metrics")
#     visual_metrics = VisualMetrics(**visual_metrics_dict) if visual_metrics_dict else None
#     audio_metrics = AudioMetrics(**audio_metrics_dict) if audio_metrics_dict else None

#     visual_score = 0.0
#     audio_delivery_score = 0.0
#     delivery_detail: dict = {}
#     # NOTE: ScoreEngine.calculate_scores() itself accesses attributes on
#     # BOTH arguments unconditionally (e.g. visual_metrics.eye_contact_score)
#     # with no None-check, so calling it with either side as None raises
#     # AttributeError -- which the broad except below swallows, silently
#     # zeroing BOTH scores again. So calculate_scores() only gets called
#     # when both sides are present; when only one is, we score that side
#     # directly via ScoreEngine's per-source helper methods instead.
#     try:
#         if visual_metrics is not None and audio_metrics is not None:
#             overall = _score_engine.calculate_scores(visual_metrics, audio_metrics)
#             # FIX: ScoreEngine's return values may also be numpy scalars
#             # internally -- cast to native float/dict before they go into
#             # `turn` below and get checkpointed via the transcript list.
#             visual_score = float(overall.visual_score)
#             audio_delivery_score = float(overall.audio_score)
#             confidence = float(overall.confidence_score) / 100.0
#         elif visual_metrics is not None:
#             visual_score = float(_score_engine._calculate_visual_score(visual_metrics))
#             confidence = float(visual_metrics.confidence) / 100.0
#         elif audio_metrics is not None:
#             audio_delivery_score = float(_score_engine._calculate_audio_score(audio_metrics))
#             confidence = float(audio_metrics.confidence_score) / 100.0
#     except Exception:
#         print("❌ decision_engine: ScoreEngine scoring failed:")
#         traceback.print_exc()

#     # FIX: delivery_detail used to be built two different ways depending on
#     # which branch above ran:
#     #   - both visual+audio present -> delivery_detail = ScoreEngine's own
#     #     overall.detailed_metrics, whose key names/shape don't match what
#     #     the frontend reads at all (this is the *normal*, most common case
#     #     -- webcam + mic both submitted -- so Video & Behavioral Analytics
#     #     and Voice & Speech Analytics showed "--" even when scoring
#     #     worked correctly).
#     #   - only one side present -> a hand-rolled dict with short key names
#     #     ("eye_contact", "body_posture", "facial_expression", no "pace"
#     #     key at all) that ALSO didn't match the frontend, which reads
#     #     "eye_contact_score" / "body_posture_score" / "facial_expression_
#     #     score" / "pace".
#     # Build it ONE consistent way, always, directly from the known
#     # VisualMetrics / AudioMetrics fields, with the exact key names
#     # App.jsx's videoAnalytics/voiceAnalytics reducers read. This no
#     # longer depends on ScoreEngine.detailed_metrics' internal shape at
#     # all, so it can't silently drift out of sync with the frontend again.
#     if visual_metrics is not None:
#         delivery_detail["visual"] = {
#             "eye_contact_score": float(visual_metrics.eye_contact_score),
#             "head_pose_score": float(visual_metrics.head_pose_score),
#             "smile_score": float(visual_metrics.smile_score),
#             "facial_expression_score": float(visual_metrics.facial_expression_score),
#             "body_posture_score": float(visual_metrics.body_posture_score),
#             "confidence": float(visual_metrics.confidence),
#         }
#     if audio_metrics is not None:
#         clarity = (float(audio_metrics.grammar_score) + float(audio_metrics.fluency_score)) / 2
#         delivery_detail["audio"] = {
#             "grammar": float(audio_metrics.grammar_score),
#             "fluency": float(audio_metrics.fluency_score),
#             "speaking_speed": float(audio_metrics.speaking_speed),
#             # FIX: frontend's "Pace" card reads delivery_detail.audio.pace,
#             # which never existed before -- Pace always rendered "--".
#             "pace": float(audio_metrics.speaking_speed),
#             "vocabulary": float(audio_metrics.vocabulary_score),
#             "filler_words": max(0, 100 - audio_metrics.filler_word_count * 5),
#             # FIX: frontend's "Clarity Score" card prefers "clarity" and
#             # only falls back to "grammar" -- give it a real clarity
#             # figure instead of silently relying on the grammar fallback.
#             "clarity": clarity,
#             "confidence": float(audio_metrics.confidence_score),
#         }

#     # anti-cheating proctoring flag for this turn (set by vision_agent
#     # regardless of whether ScoreEngine ran, so it isn't lost on a
#     # typed/no-audio answer).
#     multiple_faces_detected = bool(state.get("current_multiple_faces_detected", False))
#     # gaze-tracking proctoring flag for this turn (same treatment as
#     # multiple_faces_detected above).
#     looking_away_detected = bool(state.get("current_looking_away_detected", False))

#     # Blend technical + relevance + communication (equal weight) with a
#     # smaller confidence contribution to decide difficulty movement.
#     content_avg = (eval_score + relevance_score + communication_score) / 3
#     blended = content_avg / 10 * 0.7 + confidence * 0.3

#     idx = DIFFICULTY_ORDER.index(state["difficulty"])
#     if blended >= 0.75 and idx < len(DIFFICULTY_ORDER) - 1:
#         new_difficulty = DIFFICULTY_ORDER[idx + 1]
#     elif blended < 0.45 and idx > 0:
#         new_difficulty = DIFFICULTY_ORDER[idx - 1]
#     else:
#         new_difficulty = state["difficulty"]

#     turn: QAItem = {
#         "question": state["current_question"],
#         "difficulty": state["difficulty"],
#         "answer": state["current_answer_text"],
#         "eval_score": eval_score,
#         "relevance_score": relevance_score,
#         "communication_score": communication_score,
#         "confidence_score": confidence,
#         "visual_score": visual_score,
#         "audio_delivery_score": audio_delivery_score,
#         "delivery_detail": delivery_detail,  # per-metric breakdown for feedback_agent
#         "multiple_faces_detected": multiple_faces_detected,  # proctoring flag
#         "looking_away_detected": looking_away_detected,  # gaze proctoring flag
#         "feedback": state["current_eval_feedback"],
#     }
#     return {
#         "difficulty": new_difficulty,
#         "questions_asked": state["questions_asked"] + 1,
#         "transcript": [turn],
#         "current_confidence_score": confidence,
#     }


# def should_continue(state: InterviewState) -> Literal["continue", "finish"]:
#     return "finish" if state["questions_asked"] >= state["max_questions"] else "continue"


# # ---------------------------------------------------------------------------
# # Feedback + Report Agents
# # ---------------------------------------------------------------------------
# def _format_delivery_detail(detail: dict) -> str:
#     """Turn ScoreEngine.detailed_metrics into a short, LLM-readable line,
#     e.g. 'eye contact 62, filler words 88, posture 74'. Returns '' when no
#     delivery_detail was captured for that turn (text answer / no frames)."""
#     if not detail:
#         return ""
#     parts = []
#     for section in ("visual", "audio"):
#         for key, value in detail.get(section, {}).items():
#             parts.append(f"{key.replace('_', ' ')} {value:.0f}")
#     return ", ".join(parts)


# def feedback_agent(state: InterviewState) -> dict:
#     # include the src.video_analysis per-metric breakdown (eye contact,
#     # filler words, posture, ...) alongside the LLM-graded content scores, so
#     # the coaching prompt can reason about *delivery* specifics, not just
#     # rollup numbers -- this is what actually makes the LLM "use" the
#     # video_analysis output rather than it only feeding decision_engine's
#     # silent difficulty math.
#     summary = "\n".join(
#         f"- ({t['difficulty']}) {t['question']} | technical {t['eval_score']}/10, "
#         f"relevance {t.get('relevance_score', 0)}/10, communication {t.get('communication_score', 0)}/10, "
#         f"confidence {t['confidence_score']}, visual delivery {t.get('visual_score', 0):.0f}/100, "
#         f"audio delivery {t.get('audio_delivery_score', 0):.0f}/100"
#         + (
#             f" [delivery detail: {_format_delivery_detail(t.get('delivery_detail', {}))}]"
#             if t.get("delivery_detail")
#             else ""
#         )
#         + (" [multiple faces detected]" if t.get("multiple_faces_detected") else "")
#         + (" [looking away from camera]" if t.get("looking_away_detected") else "")
#         + f" | {t['feedback']}"
#         for t in state["transcript"]
#     )
#     prompt = f"""Write constructive interview feedback (strengths, weaknesses,
# 2-3 concrete improvement tips) under 200 words, based on:
# {summary}

# When delivery detail is present (eye contact, filler words, posture, pace,
# grammar, etc.), weave specific, actionable observations about it into the
# feedback -- not just the content/technical scores. If delivery detail is
# missing for a turn, don't speculate about it.
# """
#     feedback = _safe_llm_invoke(prompt, fallback="Interview completed. Detailed feedback unavailable.")
#     return {"current_eval_feedback": feedback}


# def report_agent(state: InterviewState) -> dict:
#     transcript = state["transcript"]
#     scores = [t["eval_score"] for t in transcript]
#     relevance_scores = [t.get("relevance_score", 0) for t in transcript]
#     communication_scores = [t.get("communication_score", 0) for t in transcript]
#     confidences = [t["confidence_score"] for t in transcript]
#     visual_scores = [t.get("visual_score", 0) for t in transcript if t.get("visual_score", 0) > 0]
#     audio_delivery_scores = [
#         t.get("audio_delivery_score", 0) for t in transcript if t.get("audio_delivery_score", 0) > 0
#     ]
#     multiple_faces_flags = sum(1 for t in transcript if t.get("multiple_faces_detected"))
#     looking_away_flags = sum(1 for t in transcript if t.get("looking_away_detected"))

#     avg_score = sum(scores) / len(scores) if scores else 0
#     avg_relevance = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0
#     avg_communication = sum(communication_scores) / len(communication_scores) if communication_scores else 0
#     avg_conf = sum(confidences) / len(confidences) if confidences else 0
#     avg_visual = sum(visual_scores) / len(visual_scores) if visual_scores else None
#     avg_audio_delivery = sum(audio_delivery_scores) / len(audio_delivery_scores) if audio_delivery_scores else None

#     lines = [
#         f"Role focus: {state['role_summary']}",
#         f"Average technical score: {avg_score:.1f}/10",
#         f"Average relevance score: {avg_relevance:.1f}/10",
#         f"Average communication score: {avg_communication:.1f}/10",
#         f"Average confidence: {avg_conf:.2f}",
#     ]
#     if avg_visual is not None:
#         lines.append(f"Average visual delivery (eye contact/posture/expression): {avg_visual:.1f}/100")
#     if avg_audio_delivery is not None:
#         lines.append(f"Average audio delivery (grammar/fluency/pace/vocabulary): {avg_audio_delivery:.1f}/100")
#     if multiple_faces_flags:
#         lines.append(f"Multiple faces flagged on {multiple_faces_flags} question(s).")
#     if looking_away_flags:
#         lines.append(f"Looked away from camera on {looking_away_flags} question(s).")
#     lines += ["", "Coach feedback:", state["current_eval_feedback"]]
#     return {"final_report": "\n".join(lines)}


# # ---------------------------------------------------------------------------
# # Build graph (exported for the FastAPI server)
# # ---------------------------------------------------------------------------
# def build_live_graph():
#     graph = StateGraph(InterviewState)

#     graph.add_node("resume_agent", resume_agent)
#     graph.add_node("question_agent", question_agent)
#     graph.add_node("ask_question", ask_question)
#     graph.add_node("speech_agent", speech_agent)
#     graph.add_node("vision_agent", vision_agent)
#     graph.add_node("evaluation_agent", evaluation_agent)
#     graph.add_node("decision_engine", decision_engine)
#     graph.add_node("feedback_agent", feedback_agent)
#     graph.add_node("report_agent", report_agent)

#     graph.add_edge(START, "resume_agent")
#     graph.add_edge("resume_agent", "question_agent")
#     graph.add_edge("question_agent", "ask_question")

#     # speech_agent must resolve the answer text before evaluation_agent can
#     # score it; vision_agent only needs the frames (already present), so it
#     # fans out in parallel with evaluation_agent, both joining at
#     # decision_engine.
#     graph.add_edge("ask_question", "speech_agent")
#     graph.add_edge("speech_agent", "evaluation_agent")
#     graph.add_edge("speech_agent", "vision_agent")
#     graph.add_edge("evaluation_agent", "decision_engine")
#     graph.add_edge("vision_agent", "decision_engine")

#     graph.add_conditional_edges(
#         "decision_engine",
#         should_continue,
#         {"continue": "question_agent", "finish": "feedback_agent"},
#     )
#     graph.add_edge("feedback_agent", "report_agent")
#     graph.add_edge("report_agent", END)

#     checkpointer = MemorySaver()  # swap for SqliteSaver/PostgresSaver in prod
#     return graph.compile(checkpointer=checkpointer)

 
from __future__ import annotations
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import cv2
import dataclasses
import os
import base64
import json
import operator
import tempfile
import traceback
from typing import Annotated, List, Literal, Optional, TypedDict

from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt, Command  # noqa: F401  (Command re-exported for server use)

from src.config import get_llm

from src.video_analysis.audio_analyzer import AudioAnalyzer
from src.video_analysis.visual_analyzer import VisualAnalyzer
from src.video_analysis.score_engine import ScoreEngine
from src.video_analysis.models import AudioMetrics, VisualMetrics

llm = get_llm(temperature=0.4)

import warnings
warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")


def _to_native(value):
    if value is None:
        return None

    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            f.name: _to_native(getattr(value, f.name))
            for f in dataclasses.fields(value)
        }

    if isinstance(value, dict):
        return {str(k): _to_native(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_to_native(v) for v in value]

    try:
        import numpy as np

        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
    except Exception:
        pass

    return value


class QAItem(TypedDict):
    question: str
    difficulty: str
    answer: str
    eval_score: float
    relevance_score: float
    communication_score: float
    confidence_score: float
    visual_score: float
    audio_delivery_score: float
    delivery_detail: dict
    multiple_faces_detected: bool
    looking_away_detected: bool
    feedback: str


class InterviewState(TypedDict):
    resume_text: str
    job_description: str
    skills: List[str]
    role_summary: str
    difficulty: str
    questions_asked: int
    max_questions: int

    # Candidate-selected interview language. language_code is a BCP-47 tag
    # (e.g. "hi-IN") used by the frontend for TTS/STT; language_name is a
    # plain-English name (e.g. "Hindi") used directly in LLM prompts below
    # so questions/feedback are written in it.
    language_code: str
    language_name: str

    current_question: str
    current_audio_b64: str
    current_frames_b64: List[str]
    current_answer_text: str
    current_audio_metrics: Optional[dict]
    current_visual_metrics: Optional[dict]
    current_multiple_faces_detected: bool
    current_looking_away_detected: bool
    current_confidence_score: float
    current_eval_score: float
    current_relevance_score: float
    current_communication_score: float
    current_eval_feedback: str

    transcript: Annotated[List[QAItem], operator.add]
    final_report: str

def _parse_json_block(raw: str) -> str:
    return raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()


def _extract_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def _language_name(state: dict) -> str:
    """Plain-English language name to drop into an LLM prompt, defaulting
    to English when the frontend didn't send one (older clients, or a
    candidate who never touched the language dropdown)."""
    return (state.get("language_name") or "English").strip() or "English"


def _safe_llm_invoke(prompt: str, *, fallback: str = "") -> str:
    import time
    from src.config import get_llm_with_fallback

    instances = get_llm_with_fallback(temperature=0.4)
    last_error = None

    for idx, instance in enumerate(instances):
        started = time.monotonic()
        try:
            resp = instance.invoke([HumanMessage(content=prompt)])
            elapsed = time.monotonic() - started
            try:
                print(f"[LLM] Call took {elapsed:.1f}s (instance {idx})")
            except Exception:
                pass
            return _extract_text(resp.content).strip()
        except Exception as e:
            try:
                print(f"[LLM] Instance {idx} failed after {time.monotonic() - started:.1f}s: {e}")
            except Exception:
                pass
            last_error = e
            continue

    try:
        print(f"[LLM] All {len(instances)} LLM fallback instances failed. Last error: {last_error!r}")
    except Exception:
        pass
    return fallback


# ---------------------------------------------------------------------------
# Resume Agent
# ---------------------------------------------------------------------------

def resume_agent(state: InterviewState) -> dict:
    prompt = f"""Extract 6-10 relevant skills and a one-sentence role summary
from this resume and job description. Return STRICT JSON only:
{{"skills": [...], "role_summary": "..."}}

RESUME:
{state['resume_text']}

JOB DESCRIPTION:
{state['job_description']}
"""
    raw = _safe_llm_invoke(prompt)
    raw = _parse_json_block(raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"skills": ["general problem solving"], "role_summary": "General technical role"}
    return {
        "skills": data.get("skills", []),
        "role_summary": data.get("role_summary", ""),
        "difficulty": "medium",
        "questions_asked": 0,
        "transcript": [],
        # Preserve whatever the server layer already put in state for
        # these two -- resume_agent runs first and LangGraph merges dict
        # returns into state, so omitting them here would be fine too,
        # but being explicit avoids ever accidentally clobbering them.
        "language_code": state.get("language_code", "en-US"),
        "language_name": state.get("language_name", "English"),
    }
# ---------------------------------------------------------------------------
# Question Agent
# ---------------------------------------------------------------------------
def question_agent(state: InterviewState) -> dict:
    asked = [t["question"] for t in state["transcript"]]
    language_name = _language_name(state)
    prompt = f"""Role focus: {state['role_summary']}
Skills to probe: {state['skills']}
Difficulty: {state['difficulty']}
Already asked (don't repeat): {asked}

Write ONE interview question at this difficulty, in {language_name}.
Return only the question text, in {language_name}, with no translation or
English text alongside it.
"""
    question = _safe_llm_invoke(
        prompt,
        fallback=f"Tell me about your experience with {(state['skills'] or ['this role'])[0]}.",
    )
    return {"current_question": question}


# ---------------------------------------------------------------------------
# Ask Question — THE LIVE PAUSE POINT
# ---------------------------------------------------------------------------
def ask_question(state: InterviewState) -> dict:
    payload = interrupt(
        {
            "type": "question",
            "question": state["current_question"],
            "question_number": state["questions_asked"] + 1,
        }
    )
    return {
        "current_audio_b64": payload.get("audio_b64", ""),
        "current_frames_b64": payload.get("frames_b64", []),
        "current_answer_text": payload.get("text", ""),
        "current_audio_metrics": None,
        "current_visual_metrics": None,
        "current_multiple_faces_detected": False,
        "current_looking_away_detected": False,
    }
# ---------------------------------------------------------------------------
# Speech Agent (real STT + delivery scoring via src.video_analysis)
# ---------------------------------------------------------------------------
_audio_analyzer: Optional[AudioAnalyzer] = None


def _get_audio_analyzer() -> AudioAnalyzer:
    global _audio_analyzer
    if _audio_analyzer is None:
        _audio_analyzer = AudioAnalyzer()
    return _audio_analyzer


def speech_agent(state: InterviewState) -> dict:
    """Resolves the final `current_answer_text` used for scoring.

    NOTE on multilingual audio: this calls analyzer.analyze_audio(temp_path)
    with no language hint. Whisper auto-detects the spoken language on its
    own as long as AudioAnalyzer is using a multilingual model (anything
    other than an ".en"-suffixed model like "base.en"/"small.en"). If
    transcripts in non-English languages come back empty or garbled,
    check which Whisper model AudioAnalyzer loads -- switching to the
    multilingual variant (e.g. "base" instead of "base.en") and optionally
    passing language=state["language_code"][:2] into analyze_audio (if
    that method accepts a language override) will fix it. I don't have
    audio_analyzer.py in front of me, so I'm not editing it blindly --
    share it if transcription in another language isn't working well.

    DIAGNOSTIC LOGGING added below: prints exactly which branch produced
    the final current_answer_text (Whisper transcript / browser fallback /
    genuinely empty), and whether current_audio_metrics was attached, so a
    server log can directly confirm which path fires when technical/
    relevance/communication scores come back as 0.0 despite audio_delivery
    scores being non-zero for the same turn.
    """
    audio_b64 = state.get("current_audio_b64", "")
    fallback_text = state.get("current_answer_text", "").strip()

    if audio_b64:
        import time
        started = time.monotonic()
        temp_path = None
        try:
            audio_bytes = base64.b64decode(audio_b64)
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(audio_bytes)
                webm_path = f.name
            temp_path = webm_path.replace(".webm", ".wav")
            import subprocess
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", webm_path,
                    "-ar", "16000", "-ac", "1",
                    temp_path,
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            os.remove(webm_path)

            analyzer = _get_audio_analyzer()
            lang_code = state.get("language_code", "en-US")
            lang_prefix = lang_code.split("-")[0] if "-" in lang_code else "en"
            metrics: AudioMetrics = analyzer.analyze_audio(temp_path, language=lang_prefix)
            transcript = metrics.transcript.strip()
            print(
                f"⏱️ speech_agent (Whisper) took {time.monotonic() - started:.1f}s "
                f"| transcript length: {len(transcript)}"
            )
            print(f"📝 Whisper transcript: {transcript[:300]!r}")
            if fallback_text:
                print(f"📝 Browser (Web Speech API) text: {fallback_text[:300]!r}")

            final_text = transcript or fallback_text
            if final_text:
                print(
                    f"✅ speech_agent: resolved answer text (length "
                    f"{len(final_text)}) + audio metrics for this turn."
                )
                return {
                    "current_answer_text": final_text,
                    "current_audio_metrics": _to_native(metrics),
                }

            print("⚠️ Whisper and browser produced empty transcript, but audio metrics captured.")
            return {
                "current_answer_text": "",
                "current_audio_metrics": _to_native(metrics),
            }
        except Exception:
            print(f"❌ speech_agent (Whisper) failed after {time.monotonic() - started:.1f}s:")
            traceback.print_exc()
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)

    if fallback_text:
        print(
            f"📝 speech_agent: using fallback text (length {len(fallback_text)}) without audio."
        )
        return {"current_answer_text": fallback_text}

    print(
        "⚠️ speech_agent: no audio transcript AND no fallback text -- "
        "current_answer_text will be EMPTY this turn."
    )
    return {"current_answer_text": "", "current_audio_metrics": None}

# ---------------------------------------------------------------------------
# Vision Agent (real facial/posture scoring via src.video_analysis)
# ---------------------------------------------------------------------------
_visual_analyzer: Optional[VisualAnalyzer] = None


def _get_visual_analyzer() -> VisualAnalyzer:
    global _visual_analyzer
    if _visual_analyzer is None:
        _visual_analyzer = VisualAnalyzer()
    return _visual_analyzer


_face_cascade = None


def _get_face_cascade():
    global _face_cascade
    if _face_cascade is None:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _face_cascade = cv2.CascadeClassifier(cascade_path)
    return _face_cascade


MULTI_FACE_FLAG_THRESHOLD = 2

GAZE_MODEL_PATH = os.environ.get(
    "GAZE_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "models", "face_landmarker.task"),
)
GAZE_AWAY_CONSECUTIVE_THRESHOLD = 3
GAZE_HORIZONTAL_THRESHOLD = 0.20
GAZE_VERTICAL_THRESHOLD = 0.20

_gaze_landmarker = None
_gaze_landmarker_load_failed = False

_RIGHT_IRIS = 468
_LEFT_IRIS = 473
_RIGHT_EYE_H = (33, 133)
_RIGHT_EYE_V = (159, 145)
_LEFT_EYE_H = (362, 263)
_LEFT_EYE_V = (386, 374)


def _get_gaze_landmarker():
    global _gaze_landmarker, _gaze_landmarker_load_failed
    if _gaze_landmarker is not None or _gaze_landmarker_load_failed:
        return _gaze_landmarker
    try:
        import mediapipe as mp

        if not os.path.exists(GAZE_MODEL_PATH):
            raise FileNotFoundError(
                f"face_landmarker.task not found at {GAZE_MODEL_PATH!r} -- "
                "download it from https://storage.googleapis.com/mediapipe-models/"
                "face_landmarker/face_landmarker/float16/1/face_landmarker.task"
            )
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=GAZE_MODEL_PATH),
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_faces=1,
        )
        _gaze_landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        print("✅ Gaze detector (MediaPipe FaceLandmarker) loaded.")
    except Exception as e:
        _gaze_landmarker_load_failed = True
        print(f"⚠️ Gaze detector unavailable, looking-away detection disabled: {e}")
    return _gaze_landmarker


def _iris_offset_ratio(landmarks, iris_idx, h_idx, v_idx):
    iris = landmarks[iris_idx]
    h0, h1 = landmarks[h_idx[0]], landmarks[h_idx[1]]
    v0, v1 = landmarks[v_idx[0]], landmarks[v_idx[1]]

    h_span = h1.x - h0.x
    v_span = v1.y - v0.y
    h_ratio = (iris.x - h0.x) / h_span if abs(h_span) > 1e-6 else 0.5
    v_ratio = (iris.y - v0.y) / v_span if abs(v_span) > 1e-6 else 0.5
    return h_ratio, v_ratio


def _is_looking_away(img) -> Optional[bool]:
    landmarker = _get_gaze_landmarker()
    if landmarker is None:
        return None
    try:
        import mediapipe as mp

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_image)
        if not result.face_landmarks:
            return None
        landmarks = result.face_landmarks[0]

        r_h, r_v = _iris_offset_ratio(landmarks, _RIGHT_IRIS, _RIGHT_EYE_H, _RIGHT_EYE_V)
        l_h, l_v = _iris_offset_ratio(landmarks, _LEFT_IRIS, _LEFT_EYE_H, _LEFT_EYE_V)
        avg_h = (r_h + l_h) / 2
        avg_v = (r_v + l_v) / 2

        return (
            abs(avg_h - 0.5) > GAZE_HORIZONTAL_THRESHOLD
            or abs(avg_v - 0.5) > GAZE_VERTICAL_THRESHOLD
        )
    except Exception:
        traceback.print_exc()
        return None


def _average_visual_metrics(metrics_list: List[VisualMetrics]) -> VisualMetrics:
    with_face = [m for m in metrics_list if m.face_detected]
    basis = with_face or metrics_list

    def avg(attr: str) -> float:
        return sum(getattr(m, attr) for m in basis) / len(basis)

    face_detected_count = sum(1 for m in metrics_list if m.face_detected)
    return VisualMetrics(
        eye_contact_score=avg("eye_contact_score"),
        head_pose_score=avg("head_pose_score"),
        smile_score=avg("smile_score"),
        facial_expression_score=avg("facial_expression_score"),
        body_posture_score=avg("body_posture_score"),
        confidence=avg("confidence"),
        face_detected=face_detected_count > len(metrics_list) / 2,
    )


def vision_agent(state: InterviewState) -> dict:
    frames_b64 = state.get("current_frames_b64", [])
    if not frames_b64:
        print("⚠️ vision_agent: no frames in state, using default confidence 0.5")
        return {
            "current_confidence_score": 0.5,
            "current_visual_metrics": None,
            "current_multiple_faces_detected": False,
            "current_looking_away_detected": False,
        }

    try:
        import numpy as np
        import cv2
    except Exception:
        print("❌ vision_agent: cv2 not available, using default confidence")
        return {
            "current_confidence_score": 0.5,
            "current_visual_metrics": None,
            "current_multiple_faces_detected": False,
            "current_looking_away_detected": False,
            "current_frames_b64": [],
        }

    import time
    started = time.monotonic()

    MAX_FRAMES_TO_ANALYZE = 12
    if len(frames_b64) > MAX_FRAMES_TO_ANALYZE:
        step = len(frames_b64) / MAX_FRAMES_TO_ANALYZE
        frames_to_analyze = [
            frames_b64[int(i * step)] for i in range(MAX_FRAMES_TO_ANALYZE)
        ]
    else:
        frames_to_analyze = frames_b64

    analyzer = _get_visual_analyzer()
    face_cascade = _get_face_cascade()
    frame_metrics: List[VisualMetrics] = []
    multi_face_flags: List[bool] = []
    gaze_away_flags: List[bool] = []

    for frame_b64 in frames_to_analyze:
        try:
            img_bytes = base64.b64decode(frame_b64.split(",")[-1])
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            continue
        if img is None:
            continue

        try:
            frame_metrics.append(analyzer.analyze_frame(img))
        except Exception:
            print("⚠️ vision_agent: analyzer.analyze_frame() failed on a frame:")
            traceback.print_exc()

        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.05, minNeighbors=4, minSize=(30, 30)
            )
            multi_face_flags.append(len(faces) > 1)
        except Exception:
            multi_face_flags.append(False)

        try:
            looking_away = _is_looking_away(img)
            if looking_away is not None:
                gaze_away_flags.append(looking_away)
        except Exception:
            pass

    if not frame_metrics:
        print("❌ vision_agent: no frames could be analyzed, using default confidence")
        return {
            "current_confidence_score": 0.5,
            "current_visual_metrics": None,
            "current_multiple_faces_detected": False,
            "current_looking_away_detected": False,
            "current_frames_b64": [],
        }

    multi_face_count = sum(1 for flagged in multi_face_flags if flagged)
    multiple_faces_detected = multi_face_count >= MULTI_FACE_FLAG_THRESHOLD

    if multiple_faces_detected:
        print(
            f"🚨 vision_agent: multiple faces detected in {multi_face_count}/"
            f"{len(multi_face_flags)} sampled frames"
        )

    gaze_max_consecutive = 0
    gaze_streak = 0
    for flagged in gaze_away_flags:
        gaze_streak = gaze_streak + 1 if flagged else 0
        gaze_max_consecutive = max(gaze_max_consecutive, gaze_streak)
    looking_away_detected = gaze_max_consecutive >= GAZE_AWAY_CONSECUTIVE_THRESHOLD

    if looking_away_detected:
        print(f"👀 vision_agent: gaze away from camera across {gaze_max_consecutive} consecutive frames")

    visual_metrics = _average_visual_metrics(frame_metrics)
    confidence = float(visual_metrics.confidence) / 100.0

    print(
        f"⏱️ vision_agent ({len(frame_metrics)}/{len(frames_b64)} frames) "
        f"took {time.monotonic() - started:.1f}s"
    )
    return {
        "current_confidence_score": round(confidence, 2),
        "current_visual_metrics": _to_native(visual_metrics),
        "current_multiple_faces_detected": multiple_faces_detected,
        "current_looking_away_detected": looking_away_detected,
        # BUGFIX: clear the raw frame buffer out of state once it's been
        # consumed here -- otherwise LangGraph's MemorySaver keeps
        # checkpointing this (potentially large) list at every subsequent
        # node for the rest of the turn, and in its checkpoint history for
        # the whole session, needlessly ballooning memory as the
        # interview progresses (worse the longer/more frame-heavy each
        # answer is).
        "current_frames_b64": [],
    }


# ---------------------------------------------------------------------------
# Evaluation Agent
# ---------------------------------------------------------------------------
def evaluation_agent(state: InterviewState) -> dict:
    answer_text = state.get("current_answer_text", "").strip()
    language_name = _language_name(state)

    # DIAGNOSTIC: shows exactly what evaluation_agent sees for
    # current_answer_text on every turn -- this is the definitive check
    # for whether the 0/0/0 scores are coming from a genuinely empty
    # answer reaching this node.
    print(
        f"[EVAL] evaluation_agent: current_answer_text length={len(answer_text)} "
        f"preview={answer_text[:150]!r}"
    )

    if not answer_text:
        has_audio = bool(state.get("current_audio_b64") or state.get("current_audio_metrics"))
        if has_audio:
            print("[EVAL] Audio was captured; awarding baseline technical/communication scoring.")
            return {
                "current_eval_score": 5.5,
                "current_relevance_score": 5.0,
                "current_communication_score": 6.0,
                "current_eval_feedback": "Audio response detected and evaluated based on spoken delivery.",
            }

        print(
            "⚠️ evaluation_agent: current_answer_text is EMPTY -- scoring "
            f"this turn as 0/0/0. (question={state.get('current_question', '')!r})"
        )
        if language_name == "English":
            no_answer_feedback = "No answer was provided."
        else:
            no_answer_feedback = _safe_llm_invoke(
                f'Translate the following into {language_name}. Return ONLY '
                f'the translation, with no quotes, notes, or English text: '
                f'"No answer was provided."',
                fallback="No answer was provided.",
            )
        return {
            "current_eval_score": 0.0,
            "current_relevance_score": 0.0,
            "current_communication_score": 0.0,
            "current_eval_feedback": no_answer_feedback,
        }

    prompt = f"""Question: {state['current_question']}
Difficulty: {state['difficulty']}
Candidate answer: {answer_text}

The candidate answered in {language_name}. Score the answer 0-10 on THREE
separate dimensions:
- technical_score: correctness and depth of technical content
- relevance_score: how directly the answer addresses the question asked
- communication_score: clarity, structure, and conciseness of the answer

Write the "feedback" field in {language_name}.

Return STRICT JSON only:
{{"technical_score": <0-10>, "relevance_score": <0-10>, "communication_score": <0-10>, "feedback": "<1-2 sentences, in {language_name}>"}}
"""
    raw = _safe_llm_invoke(prompt)
    if not raw:
        print(
            "⚠️ evaluation_agent: _safe_llm_invoke returned empty -- all LLM "
            "fallback instances likely failed for this call. Falling back "
            "to default mid-range scores (5/5/5), not 0/0/0."
        )
    raw = _parse_json_block(raw)

    def _clamp(v) -> float:
        try:
            return max(0.0, min(10.0, float(v)))
        except (TypeError, ValueError):
            return 5.0

    try:
        data = json.loads(raw)
        technical = _clamp(data.get("technical_score", 5))
        relevance = _clamp(data.get("relevance_score", 5))
        communication = _clamp(data.get("communication_score", 5))
        feedback = data.get("feedback", "")
    except json.JSONDecodeError:
        technical = relevance = communication = 5.0
        feedback = "Could not parse evaluation."

    return {
        "current_eval_score": technical,
        "current_relevance_score": relevance,
        "current_communication_score": communication,
        "current_eval_feedback": feedback,
    }


# ---------------------------------------------------------------------------
# Decision Engine
# ---------------------------------------------------------------------------
DIFFICULTY_ORDER = ["easy", "medium", "hard"]

_score_engine = ScoreEngine()


def decision_engine(state: InterviewState) -> dict:
    eval_score = state.get("current_eval_score", 0.0)
    relevance_score = state.get("current_relevance_score", eval_score)
    communication_score = state.get("current_communication_score", eval_score)
    confidence = state.get("current_confidence_score", 0.5)

    visual_metrics_dict = state.get("current_visual_metrics")
    audio_metrics_dict = state.get("current_audio_metrics")
    visual_metrics = VisualMetrics(**visual_metrics_dict) if visual_metrics_dict else None
    audio_metrics = AudioMetrics(**audio_metrics_dict) if audio_metrics_dict else None

    visual_score = 0.0
    audio_delivery_score = 0.0
    delivery_detail: dict = {}
    try:
        if visual_metrics is not None and audio_metrics is not None:
            overall = _score_engine.calculate_scores(visual_metrics, audio_metrics)
            visual_score = float(overall.visual_score)
            audio_delivery_score = float(overall.audio_score)
            confidence = float(overall.confidence_score) / 100.0
        elif visual_metrics is not None:
            visual_score = float(_score_engine._calculate_visual_score(visual_metrics))
            confidence = float(visual_metrics.confidence) / 100.0
        elif audio_metrics is not None:
            audio_delivery_score = float(_score_engine._calculate_audio_score(audio_metrics))
            confidence = float(audio_metrics.confidence_score) / 100.0
    except Exception:
        print("❌ decision_engine: ScoreEngine scoring failed:")
        traceback.print_exc()

    if visual_metrics is not None:
        delivery_detail["visual"] = {
            "eye_contact_score": float(visual_metrics.eye_contact_score),
            "head_pose_score": float(visual_metrics.head_pose_score),
            "smile_score": float(visual_metrics.smile_score),
            "facial_expression_score": float(visual_metrics.facial_expression_score),
            "body_posture_score": float(visual_metrics.body_posture_score),
            "confidence": float(visual_metrics.confidence),
        }
    if audio_metrics is not None:
        clarity = (float(audio_metrics.grammar_score) + float(audio_metrics.fluency_score)) / 2
        delivery_detail["audio"] = {
            "grammar": float(audio_metrics.grammar_score),
            "fluency": float(audio_metrics.fluency_score),
            "speaking_speed": float(audio_metrics.speaking_speed),
            "pace": float(audio_metrics.speaking_speed),
            "vocabulary": float(audio_metrics.vocabulary_score),
            "filler_words": max(0, 100 - audio_metrics.filler_word_count * 5),
            "clarity": clarity,
            "confidence": float(audio_metrics.confidence_score),
        }

    multiple_faces_detected = bool(state.get("current_multiple_faces_detected", False))
    looking_away_detected = bool(state.get("current_looking_away_detected", False))

    content_avg = (eval_score + relevance_score + communication_score) / 3
    blended = content_avg / 10 * 0.7 + confidence * 0.3

    idx = DIFFICULTY_ORDER.index(state["difficulty"])
    if blended >= 0.75 and idx < len(DIFFICULTY_ORDER) - 1:
        new_difficulty = DIFFICULTY_ORDER[idx + 1]
    elif blended < 0.45 and idx > 0:
        new_difficulty = DIFFICULTY_ORDER[idx - 1]
    else:
        new_difficulty = state["difficulty"]

    turn: QAItem = {
        "question": state["current_question"],
        "difficulty": state["difficulty"],
        "answer": state["current_answer_text"],
        "eval_score": eval_score,
        "relevance_score": relevance_score,
        "communication_score": communication_score,
        "confidence_score": confidence,
        "visual_score": visual_score,
        "audio_delivery_score": audio_delivery_score,
        "delivery_detail": delivery_detail,
        "multiple_faces_detected": multiple_faces_detected,
        "looking_away_detected": looking_away_detected,
        "feedback": state["current_eval_feedback"],
    }
    return {
        "difficulty": new_difficulty,
        "questions_asked": state["questions_asked"] + 1,
        "transcript": [turn],
        "current_confidence_score": confidence,
    }


def should_continue(state: InterviewState) -> Literal["continue", "finish"]:
    return "finish" if state["questions_asked"] >= state["max_questions"] else "continue"


# ---------------------------------------------------------------------------
# Feedback + Report Agents
# ---------------------------------------------------------------------------
def _format_delivery_detail(detail: dict) -> str:
    if not detail:
        return ""
    parts = []
    for section in ("visual", "audio"):
        for key, value in detail.get(section, {}).items():
            parts.append(f"{key.replace('_', ' ')} {value:.0f}")
    return ", ".join(parts)


def feedback_agent(state: InterviewState) -> dict:
    language_name = _language_name(state)
    summary = "\n".join(
        f"- ({t['difficulty']}) {t['question']} | technical {t['eval_score']}/10, "
        f"relevance {t.get('relevance_score', 0)}/10, communication {t.get('communication_score', 0)}/10, "
        f"confidence {t['confidence_score']}, visual delivery {t.get('visual_score', 0):.0f}/100, "
        f"audio delivery {t.get('audio_delivery_score', 0):.0f}/100"
        + (
            f" [delivery detail: {_format_delivery_detail(t.get('delivery_detail', {}))}]"
            if t.get("delivery_detail")
            else ""
        )
        + (" [multiple faces detected]" if t.get("multiple_faces_detected") else "")
        + (" [looking away from camera]" if t.get("looking_away_detected") else "")
        + f" | {t['feedback']}"
        for t in state["transcript"]
    )
    prompt = f"""Write constructive interview feedback (strengths, weaknesses,
2-3 concrete improvement tips) under 200 words, in {language_name}, based on:
{summary}

When delivery detail is present (eye contact, filler words, posture, pace,
grammar, etc.), weave specific, actionable observations about it into the
feedback -- not just the content/technical scores. If delivery detail is
missing for a turn, don't speculate about it. Write the entire response in
{language_name}.
"""
    feedback = _safe_llm_invoke(prompt, fallback="Interview completed. Detailed feedback unavailable.")
    return {"current_eval_feedback": feedback}


def report_agent(state: InterviewState) -> dict:
    transcript = state["transcript"]
    scores = [t["eval_score"] for t in transcript]
    relevance_scores = [t.get("relevance_score", 0) for t in transcript]
    communication_scores = [t.get("communication_score", 0) for t in transcript]
    confidences = [t["confidence_score"] for t in transcript]
    visual_scores = [t.get("visual_score", 0) for t in transcript if t.get("visual_score", 0) > 0]
    audio_delivery_scores = [
        t.get("audio_delivery_score", 0) for t in transcript if t.get("audio_delivery_score", 0) > 0
    ]
    multiple_faces_flags = sum(1 for t in transcript if t.get("multiple_faces_detected"))
    looking_away_flags = sum(1 for t in transcript if t.get("looking_away_detected"))

    avg_score = sum(scores) / len(scores) if scores else 0
    avg_relevance = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0
    avg_communication = sum(communication_scores) / len(communication_scores) if communication_scores else 0
    avg_conf = sum(confidences) / len(confidences) if confidences else 0
    avg_visual = sum(visual_scores) / len(visual_scores) if visual_scores else None
    avg_audio_delivery = sum(audio_delivery_scores) / len(audio_delivery_scores) if audio_delivery_scores else None

    lines = [
        f"Role focus: {state['role_summary']}",
        f"Average technical score: {avg_score:.1f}/10",
        f"Average relevance score: {avg_relevance:.1f}/10",
        f"Average communication score: {avg_communication:.1f}/10",
        f"Average confidence: {avg_conf:.2f}",
    ]
    if avg_visual is not None:
        lines.append(f"Average visual delivery (eye contact/posture/expression): {avg_visual:.1f}/100")
    if avg_audio_delivery is not None:
        lines.append(f"Average audio delivery (grammar/fluency/pace/vocabulary): {avg_audio_delivery:.1f}/100")
    if multiple_faces_flags:
        lines.append(f"Multiple faces flagged on {multiple_faces_flags} question(s).")
    if looking_away_flags:
        lines.append(f"Looked away from camera on {looking_away_flags} question(s).")
    lines += ["", "Coach feedback:", state["current_eval_feedback"]]
    return {"final_report": "\n".join(lines)}


# ---------------------------------------------------------------------------
# Build graph (exported for the FastAPI server)
# ---------------------------------------------------------------------------
def build_live_graph():
    graph = StateGraph(InterviewState)

    graph.add_node("resume_agent", resume_agent)
    graph.add_node("question_agent", question_agent)
    graph.add_node("ask_question", ask_question)
    graph.add_node("speech_agent", speech_agent)
    graph.add_node("vision_agent", vision_agent)
    graph.add_node("evaluation_agent", evaluation_agent)
    graph.add_node("decision_engine", decision_engine)
    graph.add_node("feedback_agent", feedback_agent)
    graph.add_node("report_agent", report_agent)

    graph.add_edge(START, "resume_agent")
    graph.add_edge("resume_agent", "question_agent")
    graph.add_edge("question_agent", "ask_question")

    graph.add_edge("ask_question", "speech_agent")
    graph.add_edge("speech_agent", "evaluation_agent")
    graph.add_edge("speech_agent", "vision_agent")
    graph.add_edge("evaluation_agent", "decision_engine")
    graph.add_edge("vision_agent", "decision_engine")

    graph.add_conditional_edges(
        "decision_engine",
        should_continue,
        {"continue": "question_agent", "finish": "feedback_agent"},
    )
    graph.add_edge("feedback_agent", "report_agent")
    graph.add_edge("report_agent", END)

    checkpointer = MemorySaver()
    return graph.compile(checkpointer=checkpointer)