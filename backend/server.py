
"""
FastAPI server for the live browser-based AI mock interview.
"""

from __future__ import annotations

import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from langgraph.types import Command

from src.agents.interview_graph_live import build_live_graph
from src.config import MAX_QUESTIONS


app = FastAPI(title="AI Mock Interview")


# React/Vite CORS
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


# Static frontend
app.mount(
    "/static",
    StaticFiles(directory="static"),
    name="static",
)


# Build LangGraph live interview
graph = build_live_graph()


@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "AI Mock Interview",
    }


def _extract_next_event(result: dict) -> dict:
    """
    Convert LangGraph result into the next WebSocket message.
    """

    # LangGraph interrupt
    if "__interrupt__" in result:
        interrupt_obj = result["__interrupt__"][0]

        return {
            "type": "question",
            "question": interrupt_obj.value["question"],
        }

    # Interview finished
    return {
        "type": "final",
        "report": result.get("final_report", ""),
    }

@app.websocket("/ws/interview")
async def interview_ws(websocket: WebSocket):
    await websocket.accept()

    thread_id = str(uuid.uuid4())

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    print(f"WebSocket connected: {thread_id}")

    try:

        while True:

            msg = await websocket.receive_json()

            action = msg.get("action")

            # ---------------------------------
            # START INTERVIEW
            # ---------------------------------
            if action == "start":

                initial_state = {
                    "resume_text": msg.get(
                        "resume_text",
                        ""
                    ),

                    "job_description": msg.get(
                        "job_description",
                        ""
                    ),

                    "skills": [],

                    "role_summary": "",

                    "difficulty": "medium",

                    "questions_asked": 0,

                    "max_questions": MAX_QUESTIONS,

                    "current_question": "",

                    "current_audio_b64": "",

                    "current_frames_b64": [],

                    "current_answer_text": "",

                    "current_confidence_score": 0.0,

                    "current_eval_score": 0.0,

                    "current_eval_feedback": "",

                    "transcript": [],

                    "final_report": "",
                }

                result = graph.invoke(
                    initial_state,
                    config=config,
                )

                event = _extract_next_event(result)

                await websocket.send_json(event)

            # ---------------------------------
            # CANDIDATE ANSWER
            # ---------------------------------
            elif action == "answer":

                payload = {
                    "audio_b64": msg.get(
                        "audio_b64",
                        ""
                    ),

                    "frames_b64": msg.get(
                        "frames_b64",
                        []
                    ),
                }

                result = graph.invoke(
                    Command(resume=payload),
                    config=config,
                )

                event = _extract_next_event(result)

                await websocket.send_json(event)

            # ---------------------------------
            # UNKNOWN ACTION
            # ---------------------------------
            else:

                await websocket.send_json(
                    {
                        "type": "error",
                        "message": f"Unknown action: {action}",
                    }
                )

    except WebSocketDisconnect:

        print(
            f"WebSocket disconnected: {thread_id}"
        )

    except Exception as e:

        print(
            f"WebSocket error: {e}"
        )

        try:

            await websocket.send_json(
                {
                    "type": "error",
                    "message": str(e),
                }
            )

        except Exception:
            pass

