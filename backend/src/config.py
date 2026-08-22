"""
Central configuration. Reads everything from the environment (via .env if
present) so no API keys or provider choices are hardcoded in source.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent
KB_DIR = ROOT_DIR / "knowledge_base"
PERSIST_DIR = ROOT_DIR / "chroma_db"

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "google").lower()

# gemini-3.5-flash-lite is correct and current — do not change this.
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-3.5-flash-lite")

MAX_QUESTIONS = int(os.getenv("MAX_QUESTIONS", "5"))

# FIX: gemini-2.5-flash-lite is retired -- Google returns a permanent 404
# NOT_FOUND ("no longer available to new users") for it. It was in this
# list and would 404 on every single call, every time, forever. Removed.
# gemini-3.6-flash added as a third fallback since 3.5/3.1-flash-lite are
# both still Flash-Lite tier; if you'd rather keep only lite-tier models
# for cost reasons, drop it and accept only 2 fallback instances.
LLM_MODEL_FALLBACKS = [
    m.strip() for m in os.getenv(
        "LLM_MODEL_FALLBACKS",
        "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash",
    ).split(",") if m.strip()
]

_GOOGLE_KEYS = [
    k.strip() for k in os.getenv("GOOGLE_API_KEYS", os.getenv("GOOGLE_API_KEY", "")).split(",")
    if k.strip()
]

# ---------------------------------------------------------------------------
# TIMEOUT BUDGET
#
# FIX: the google-genai SDK enforces a HARD MINIMUM deadline of 10s --
# passing timeout=8 doesn't make calls fail faster, it makes them reject
# immediately with 400 INVALID_ARGUMENT ("Manually set deadline 8s is too
# short. Minimum allowed deadline is 10s.") before any request is even
# sent. 10 is the floor; using exactly 10 leaves no margin for normal
# jitter, so default to 12.
#
# main.py's GRAPH_INVOKE_TIMEOUT_SECONDS (90s) has to cover: Whisper +
# up to 6 DeepFace frame scores + up to TWO sequential LLM calls in the
# same turn (evaluation_agent, then question_agent for the next question).
# Each *individual* LLM call (across all its own internal retries) must
# fit a much smaller budget than 90s, or the outer timeout fires before
# get_llm_with_fallback() even finishes trying every model/key combo.
#
# Per-instance worst case = LLM_TIMEOUT_SECONDS * (LLM_MAX_RETRIES + 1)
# Total _safe_llm_invoke worst case = per-instance worst case * num_instances
#   where num_instances = len(LLM_MODEL_FALLBACKS) * max(len(_GOOGLE_KEYS), 1)
#
# With the defaults below (timeout=12, max_retries=0, 3 models, 1 key):
#   worst case per _safe_llm_invoke call = 12 * 1 * 3 = 36s
# ---------------------------------------------------------------------------
_SDK_MIN_TIMEOUT_SECONDS = 10  # hard floor enforced by google-genai itself

LLM_TIMEOUT_SECONDS = max(
    _SDK_MIN_TIMEOUT_SECONDS,
    int(os.getenv("LLM_TIMEOUT_SECONDS", "12")),
)
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "0"))


def _build_google_llm(model: str, temperature: float, api_key: str | None = None):
    from langchain_google_genai import ChatGoogleGenerativeAI

    kwargs = dict(
        model=model,
        temperature=temperature,
        max_retries=LLM_MAX_RETRIES,
        timeout=LLM_TIMEOUT_SECONDS,
    )
    if api_key:
        kwargs["google_api_key"] = api_key
    return ChatGoogleGenerativeAI(**kwargs)


def get_llm(temperature: float = 0.4, model_override: str | None = None, key_index: int = 0):
    if LLM_PROVIDER == "openai":
        from langchain_openai import ChatOpenAI
        if not os.getenv("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not set in the environment.")
        return ChatOpenAI(
            model=model_override or LLM_MODEL,
            temperature=temperature,
            max_retries=LLM_MAX_RETRIES,
            timeout=LLM_TIMEOUT_SECONDS,
        )

    if LLM_PROVIDER == "google":
        if not _GOOGLE_KEYS:
            raise RuntimeError("GOOGLE_API_KEY (or GOOGLE_API_KEYS) is not set in the environment.")
        api_key = _GOOGLE_KEYS[key_index % len(_GOOGLE_KEYS)]
        return _build_google_llm(model_override or LLM_MODEL, temperature, api_key)

    raise ValueError(f"Unknown LLM_PROVIDER: {LLM_PROVIDER!r} (use 'google' or 'openai')")


def get_llm_with_fallback(temperature: float = 0.4):
    instances = []
    for model in LLM_MODEL_FALLBACKS:
        for key_idx in range(max(len(_GOOGLE_KEYS), 1)):
            instances.append(get_llm(temperature=temperature, model_override=model, key_index=key_idx))
    return instances