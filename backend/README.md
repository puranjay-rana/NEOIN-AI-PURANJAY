# AI Mock-Interview System

A multi-agent mock interview platform built with LangChain + LangGraph.

```
Resume + JD -> Resume Agent -> Question Agent -> Interview Agent (orchestrator)
    -> Ask Question -> Candidate Answers
        -> [Speech Agent | Vision Agent | Evaluation Agent]  (parallel fan-out)
    -> Decision Engine (adjusts difficulty)
    -> loop back to Question Agent, or -> Feedback Agent + Report Agent
```

Retrieval (RAG) grounds question generation and evaluation in real reference
material (past questions, rubrics, wiki pages) from `knowledge_base/`.

A separate video-resume analysis module scores recorded answers on visual
presence (eye contact, posture, expression) and audio delivery (grammar,
fluency, filler words, pacing).

## Project layout

```
ai-mock-interview/
├── main.py                                # CLI entry point — run a text-mode interview
├── server.py                              # FastAPI app — live browser interview (webcam/mic)
├── static/index.html                      # frontend for the live app (webcam, mic, TTS)
├── requirements.txt
├── .env.example
├── knowledge_base/                        # drop .md/.txt reference material here
└── src/
    ├── config.py                          # env-driven settings (API keys, paths)
    ├── rag.py                             # Chroma vector store + retrieval
    ├── agents/
    │   ├── interview_graph.py             # CLI/offline graph (blocking input())
    │   └── interview_graph_live.py        # server graph (LangGraph interrupt/resume)
    └── video_analysis/
        ├── models.py                      # AudioMetrics, VisualMetrics, OverallScore
        ├── audio_analyzer.py              # Whisper STT + grammar/fluency/vocab scoring
        ├── visual_analyzer.py             # per-frame visual scoring (see note below)
        ├── score_engine.py                # combines audio+visual into final scores/report
        └── video_resume_analyzer.py       # orchestrates a full video-resume analysis
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your API key(s)
```

`.env`:
```
# pick ONE provider and set the matching key
GOOGLE_API_KEY=your-gemini-key-here
# OPENAI_API_KEY=your-openai-key-here

LLM_PROVIDER=google        # "google" or "openai"
LLM_MODEL=gemini-2.5-flash # or e.g. "gpt-4o-mini" if LLM_PROVIDER=openai
```

## Run a text-mode interview (terminal)

```bash
python main.py
```

Edit the sample resume/job description at the bottom of `main.py`, or wire
it up to real input.

## Run the live web app (real browser interview)

`server.py` + `static/index.html` is a working FastAPI app that drives
`src/agents/interview_graph_live.py` end-to-end:

1. Browser opens your webcam/mic and connects over a WebSocket.
2. The server asks a question (also read aloud via the browser's built-in
   text-to-speech).
3. You click **Start Answer**, speak your answer; the app records audio and
   grabs a webcam frame once a second.
4. Click **Submit Answer** — audio + frames are sent to the server, which
   resumes the LangGraph graph: Whisper transcribes the audio
   (`speech_agent`), DeepFace scores your expression from the frames
   (`vision_agent`), and the LLM scores your answer (`evaluation_agent`).
5. Repeats for `MAX_QUESTIONS` questions, then shows the final report.

**Run it locally** (this needs real browser camera/mic access, so it must
run on your own machine — not inside a Colab notebook):

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in GOOGLE_API_KEY or OPENAI_API_KEY
uvicorn server:app --reload
```

Then open **http://127.0.0.1:8000/** in Chrome or Edge and allow camera +
microphone access when prompted.

Notes:
- `vision_agent` in `interview_graph_live.py` imports `deepface` — install
  it (`pip install deepface`) or the vision score will just error per turn.
  You can also swap it out for the simpler `src/video_analysis/visual_analyzer.py`
  included in this project if you'd rather not pull in DeepFace.
- `speech_agent` needs `ffmpeg` on PATH (Whisper depends on it).
- Browser mic recording produces `audio/webm` — Whisper handles this fine
  as long as ffmpeg is installed.
- This uses an in-memory checkpointer (`MemorySaver`), so interview state
  is lost if the server restarts mid-interview. Swap for `SqliteSaver` in
  `interview_graph_live.py` if you need it to survive restarts.

## Video-resume analysis (standalone)

```python
from src.video_analysis.video_resume_analyzer import VideoResumeAnalyzer

analyzer = VideoResumeAnalyzer()
result = analyzer.analyze_video("path/to/video.mp4")
print(analyzer.score_engine.generate_report(result["overall_score"]))
```

Requires `ffmpeg` on PATH (for Whisper) and the extra deps listed in
`requirements.txt` under "video analysis".

### Note on `visual_analyzer.py`

The original notebook (`open_CV.ipynb`) called a `VisualAnalyzer` class and a
`VisualMetrics` dataclass that were never actually defined in the file (only
referenced). This project fills that gap with a straightforward OpenCV
Haar-cascade implementation (face detection, head-pose approximation, a
smile heuristic). It works but is intentionally basic — for production
quality, swap it for **MediaPipe Face Mesh** (proper eye-contact/head-pose
landmarks) or **DeepFace** (better expression classification), matching
what `interview_graph_live.py`'s `vision_agent` already assumes is available.

## Security note

The original `agent.ipynb` had a Gemini API key hardcoded in plaintext in
two places. It's been removed here in favor of `GOOGLE_API_KEY` from the
environment — **rotate that key**, since it was exposed in a notebook file.
