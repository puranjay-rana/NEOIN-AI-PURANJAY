"""
Shared dataclasses for the video-resume analysis module.

Note: `VisualMetrics` was referenced throughout open_CV.ipynb (by
ScoreEngine and VideoResumeAnalyzer) but never actually defined in the
notebook. It's defined here to match how the rest of the code uses it
(see visual_analyzer.py).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict


@dataclass
class AudioMetrics:
    transcript: str
    grammar_score: float
    fluency_score: float
    speaking_speed: float
    vocabulary_score: float
    filler_word_count: float
    confidence_score: float


@dataclass
class VisualMetrics:
    eye_contact_score: float
    head_pose_score: float
    smile_score: float
    facial_expression_score: float
    body_posture_score: float
    confidence: float
    face_detected: bool


@dataclass
class OverallScore:
    visual_score: float
    audio_score: float
    communication_score: float
    confidence_score: float
    overall_score: float
    detailed_metrics: Dict
