from __future__ import annotations

import json
import operator
import random
import traceback
from typing import Annotated, List, Literal, TypedDict

from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END

from src.config import get_llm

llm = get_llm(temperature=0.4)


# ---------------------------------------------------------------------------
# Shared State
# ---------------------------------------------------------------------------
class QAItem(TypedDict):
    question: str
    difficulty: str
    answer: str
    eval_score: float           # technical correctness/depth, 0-10
    relevance_score: float      # how directly the answer addresses the question, 0-10
    communication_score: float  # clarity/structure of the answer, 0-10
    confidence_score: float     # facial-expression confidence, 0-1
    feedback: str


class InterviewState(TypedDict):
    # inputs
    resume_text: str
    job_description: str

    # resume agent output
    skills: List[str]
    role_summary: str

    # interview control
    difficulty: str  # "easy" | "medium" | "hard"
    questions_asked: int
    max_questions: int

    # per-turn scratch
    current_question: str
    current_answer_text: str
    current_audio_path: str  # optional, for Speech Agent (STT)
    current_confidence_score: float
    current_eval_score: float
    current_relevance_score: float
    current_communication_score: float
    current_eval_feedback: str

    # accumulators
    transcript: Annotated[List[QAItem], operator.add]

    # final output
    final_report: str


def _parse_json_block(raw: str) -> str:
    return raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()


def _safe_llm_invoke(prompt: str, *, fallback: str = "") -> str:
    """Wraps llm.invoke so a network/API failure doesn't crash the whole
    graph run -- logs the error and falls back instead."""
    try:
        resp = llm.invoke([HumanMessage(content=prompt)])
        return (resp.content or "").strip()
    except Exception:
        print("❌ LLM call failed:")
        traceback.print_exc()
        return fallback


# ---------------------------------------------------------------------------
# Node: Resume Agent
# ---------------------------------------------------------------------------
def resume_agent(state: InterviewState) -> dict:
    """Extracts structured skills + role focus from resume + job description."""
    prompt = f"""You are a resume parsing agent for a technical interview platform.

Given the RESUME and JOB DESCRIPTION below, extract:
1. A list of 6-10 concrete skills/technologies relevant to the job that the
   candidate should be interviewed on (ordered by relevance).
2. A one-sentence summary of the target role focus.

Return STRICT JSON only, no markdown fences, in this shape:
{{"skills": ["skill1", "skill2", ...], "role_summary": "..."}}

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
    }


# ---------------------------------------------------------------------------
# Node: Question Agent
# ---------------------------------------------------------------------------
def question_agent(state: InterviewState) -> dict:
    """Generates the next interview question at the current difficulty level."""
    asked_so_far = [t["question"] for t in state["transcript"]]
    prompt = f"""You are a technical interview question generator.

Role focus: {state['role_summary']}
Candidate skills to probe: {state['skills']}
Target difficulty: {state['difficulty']}
Questions already asked (do not repeat): {asked_so_far}

Write ONE interview question appropriate for the target difficulty.
Return only the question text, no preamble, no numbering.
"""
    question = _safe_llm_invoke(
        prompt,
        fallback=f"Tell me about your experience with {(state['skills'] or ['this role'])[0]}.",
    )
    return {"current_question": question}


# ---------------------------------------------------------------------------
# Node: Interview Agent / "Ask question" step
# ---------------------------------------------------------------------------
def ask_question(state: InterviewState) -> dict:
    """Presents the question to the candidate (TTS hook point) and collects
    their answer. Swap the `input()` call for your TTS + audio-capture
    pipeline in a real deployment."""
    print(f"\n[Q{state['questions_asked'] + 1} | {state['difficulty']}] {state['current_question']}")

    # --- TTS hook (optional) ---
    # tts_engine.speak(state["current_question"])

    # --- Candidate answers (voice or text) ---
    answer_text = input("Your answer: ").strip()

    return {"current_answer_text": answer_text, "current_audio_path": ""}


# ---------------------------------------------------------------------------
# Parallel Node: Speech Agent (STT)
# ---------------------------------------------------------------------------
def speech_agent(state: InterviewState) -> dict:
    """Transcribes audio to text if an audio path is present. If the
    candidate typed their answer directly (text mode), this is a passthrough."""
    audio_path = state.get("current_audio_path", "")
    if not audio_path:
        return {"current_answer_text": state["current_answer_text"]}

    # Real deployment: run Whisper here (see src/video_analysis/audio_analyzer.py).
    text = state["current_answer_text"]  # stub fallback
    return {"current_answer_text": text}


# ---------------------------------------------------------------------------
# Parallel Node: Vision Agent (confidence via facial expression)
# ---------------------------------------------------------------------------
def vision_agent(state: InterviewState) -> dict:
    """Estimates candidate confidence from facial expression during the
    answer. Wire this up to a webcam frame buffer + src/video_analysis in
    production (see interview_graph_live.py for a real implementation)."""
    confidence_score = round(random.uniform(0.4, 0.95), 2)  # stub
    return {"current_confidence_score": confidence_score}


# ---------------------------------------------------------------------------
# Parallel Node: Evaluation Agent
# ---------------------------------------------------------------------------
def evaluation_agent(state: InterviewState) -> dict:
    """Scores the candidate's answer for correctness/depth using the LLM,
    on three separate dimensions."""
    answer_text = state.get("current_answer_text", "").strip()

    if not answer_text:
        return {
            "current_eval_score": 0.0,
            "current_relevance_score": 0.0,
            "current_communication_score": 0.0,
            "current_eval_feedback": "No answer was provided.",
        }

    prompt = f"""You are a strict but fair technical interview evaluator.

Question: {state['current_question']}
Difficulty: {state['difficulty']}
Candidate answer: {answer_text}

Score the answer 0-10 on THREE separate dimensions:
- technical_score: correctness and depth of technical content
- relevance_score: how directly the answer addresses the question asked
- communication_score: clarity, structure, and conciseness of the answer

Return STRICT JSON only:
{{"technical_score": <0-10>, "relevance_score": <0-10>, "communication_score": <0-10>, "feedback": "<1-2 sentence feedback>"}}
"""
    raw = _safe_llm_invoke(prompt)
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
# Node: Decision Engine
# ---------------------------------------------------------------------------
DIFFICULTY_ORDER = ["easy", "medium", "hard"]


def decision_engine(state: InterviewState) -> dict:
    """Combines evaluation scores + confidence signal to adjust difficulty
    and records this turn in the transcript."""
    eval_score = state["current_eval_score"]  # 0-10
    relevance_score = state.get("current_relevance_score", eval_score)
    communication_score = state.get("current_communication_score", eval_score)
    confidence = state["current_confidence_score"]  # 0-1

    content_avg = (eval_score + relevance_score + communication_score) / 3
    blended = content_avg / 10 * 0.7 + confidence * 0.3  # weighted blend

    idx = DIFFICULTY_ORDER.index(state["difficulty"])
    if blended >= 0.75 and idx < len(DIFFICULTY_ORDER) - 1:
        new_difficulty = DIFFICULTY_ORDER[idx + 1]
    elif blended < 0.45 and idx > 0:
        new_difficulty = DIFFICULTY_ORDER[idx - 1]
    else:
        new_difficulty = state["difficulty"]

    turn_record: QAItem = {
        "question": state["current_question"],
        "difficulty": state["difficulty"],
        "answer": state["current_answer_text"],
        "eval_score": eval_score,
        "relevance_score": relevance_score,
        "communication_score": communication_score,
        "confidence_score": confidence,
        "feedback": state["current_eval_feedback"],
    }

    return {
        "difficulty": new_difficulty,
        "questions_asked": state["questions_asked"] + 1,
        "transcript": [turn_record],  # merged via operator.add reducer
    }


def should_continue(state: InterviewState) -> Literal["continue", "finish"]:
    if state["questions_asked"] >= state["max_questions"]:
        return "finish"
    return "continue"


# ---------------------------------------------------------------------------
# Node: Feedback Agent
# ---------------------------------------------------------------------------
def feedback_agent(state: InterviewState) -> dict:
    transcript_summary = "\n".join(
        f"- Q({t['difficulty']}): {t['question']}\n"
        f"  Answer: {t['answer']}\n"
        f"  Technical: {t['eval_score']}/10, Relevance: {t.get('relevance_score', 0)}/10, "
        f"Communication: {t.get('communication_score', 0)}/10, Confidence: {t['confidence_score']}\n"
        f"  Note: {t['feedback']}"
        for t in state["transcript"]
    )
    prompt = f"""You are an interview coach. Based on this full interview transcript,
write constructive, specific feedback (strengths, weaknesses, and 2-3 concrete
improvement suggestions) for the candidate. Keep it under 200 words.

TRANSCRIPT:
{transcript_summary}
"""
    feedback = _safe_llm_invoke(prompt, fallback="Interview completed. Detailed feedback unavailable.")
    return {"current_eval_feedback": feedback}  # reused as scratch field


# ---------------------------------------------------------------------------
# Node: Report Agent
# ---------------------------------------------------------------------------
def report_agent(state: InterviewState) -> dict:
    transcript = state["transcript"]
    scores = [t["eval_score"] for t in transcript]
    relevance_scores = [t.get("relevance_score", 0) for t in transcript]
    communication_scores = [t.get("communication_score", 0) for t in transcript]
    confidences = [t["confidence_score"] for t in transcript]

    avg_score = sum(scores) / len(scores) if scores else 0
    avg_relevance = sum(relevance_scores) / len(relevance_scores) if relevance_scores else 0
    avg_communication = sum(communication_scores) / len(communication_scores) if communication_scores else 0
    avg_conf = sum(confidences) / len(confidences) if confidences else 0

    report_lines = [
        "=" * 60,
        "INTERVIEW REPORT",
        "=" * 60,
        f"Role focus: {state['role_summary']}",
        f"Skills probed: {', '.join(state['skills'])}",
        f"Questions asked: {len(transcript)}",
        f"Average technical score: {avg_score:.1f}/10",
        f"Average relevance score: {avg_relevance:.1f}/10",
        f"Average communication score: {avg_communication:.1f}/10",
        f"Average confidence: {avg_conf:.2f}",
        "",
        "Per-question breakdown:",
    ]
    for i, t in enumerate(transcript, 1):
        report_lines.append(
            f"  {i}. [{t['difficulty']}] {t['question']}\n"
            f"     Technical: {t['eval_score']}/10 | Relevance: {t.get('relevance_score', 0)}/10 | "
            f"Communication: {t.get('communication_score', 0)}/10 | Confidence: {t['confidence_score']}\n"
            f"     {t['feedback']}"
        )
    report_lines += ["", "Coach feedback:", state["current_eval_feedback"]]

    return {"final_report": "\n".join(report_lines)}


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------
def build_graph():
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

    # Fan-out: Speech, Vision, and Evaluation run in parallel after the
    # candidate answers.
    graph.add_edge("ask_question", "speech_agent")
    graph.add_edge("ask_question", "vision_agent")
    graph.add_edge("ask_question", "evaluation_agent")

    # Fan-in: Decision Engine waits for all three parallel branches.
    graph.add_edge("speech_agent", "decision_engine")
    graph.add_edge("vision_agent", "decision_engine")
    graph.add_edge("evaluation_agent", "decision_engine")

    # Loop or finish
    graph.add_conditional_edges(
        "decision_engine",
        should_continue,
        {"continue": "question_agent", "finish": "feedback_agent"},
    )

    graph.add_edge("feedback_agent", "report_agent")
    graph.add_edge("report_agent", END)

    return graph.compile()