"""
Video Resume Analyzer — orchestrates frame-by-frame visual analysis, audio
extraction + analysis, and final scoring for a full video-resume file.

Adapted from open_CV.ipynb with imports fixed (the original notebook relied
on os/cv2/tempfile/tqdm/AudioMetrics already being in scope from earlier,
unseen cells) and the `VisualAnalyzer` gap filled — see visual_analyzer.py.
"""
from __future__ import annotations

import os
import tempfile
from typing import Dict, Optional

import cv2
from tqdm import tqdm

from src.video_analysis.audio_analyzer import AudioAnalyzer
from src.video_analysis.models import AudioMetrics, VisualMetrics
from src.video_analysis.score_engine import ScoreEngine
from src.video_analysis.visual_analyzer import VisualAnalyzer


class VideoResumeAnalyzer:
    def __init__(self):
        self.visual_analyzer = VisualAnalyzer()
        self.audio_analyzer = AudioAnalyzer()
        self.score_engine = ScoreEngine()

    def analyze_video(self, video_path: str) -> Dict:
        """Analyze video resume and generate scores"""
        print(f"\n🎬 Analyzing video: {os.path.basename(video_path)}")
        print("-" * 50)

        print("👁️ Analyzing visual components...")
        visual_metrics = self._analyze_video_frames(video_path)

        print("🎤 Analyzing audio components...")
        audio_path = self._extract_audio(video_path)
        if audio_path:
            audio_metrics = self.audio_analyzer.analyze_audio(audio_path)
            try:
                os.remove(audio_path)
            except OSError:
                pass
        else:
            print("⚠️ Audio extraction failed. Using placeholder metrics.")
            audio_metrics = AudioMetrics(
                transcript="No audio available",
                grammar_score=50,
                fluency_score=50,
                speaking_speed=50,
                vocabulary_score=50,
                filler_word_count=0,
                confidence_score=50,
            )

        print("📊 Calculating final scores...")
        overall_score = self.score_engine.calculate_scores(visual_metrics, audio_metrics)

        return {
            "overall_score": overall_score,
            "visual_metrics": visual_metrics,
            "audio_metrics": audio_metrics,
        }

    def _extract_audio(self, video_path: str) -> Optional[str]:
        """Extract audio from video"""
        try:
            from moviepy.editor import VideoFileClip

            audio_path = tempfile.mktemp(suffix=".wav")
            video = VideoFileClip(video_path)

            if video.audio is not None:
                video.audio.write_audiofile(audio_path, fps=16000, logger=None)
                video.close()
                return audio_path
            else:
                video.close()
                return None

        except Exception as e:
            print(f"Audio extraction error: {e}")
            return None

    def _analyze_video_frames(self, video_path: str) -> VisualMetrics:
        """Analyze visual aspects by processing video frames"""
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0

        print(f"   Video duration: {duration:.1f} seconds")
        print(f"   Total frames: {total_frames}")

        sample_rate = max(1, fps // 2)  # 2 frames per second
        frame_metrics = []

        frame_count = 0
        processed_frames = 0

        pbar = tqdm(total=total_frames, desc="   Processing frames")

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            if frame_count % sample_rate == 0:
                metrics = self.visual_analyzer.analyze_frame(frame)
                frame_metrics.append(metrics)
                processed_frames += 1

            frame_count += 1
            pbar.update(1)

        pbar.close()
        cap.release()

        print(f"   Analyzed {processed_frames} frames")

        if not frame_metrics:
            raise ValueError("No frames could be analyzed")

        return self._average_metrics(frame_metrics)

    def _average_metrics(self, metrics_list):
        """Average visual metrics across frames"""
        avg_metrics = metrics_list[0]

        for attr in [
            "eye_contact_score", "head_pose_score", "smile_score",
            "body_posture_score", "facial_expression_score", "confidence",
        ]:
            values = [getattr(m, attr) for m in metrics_list if getattr(m, attr) is not None]
            if values:
                setattr(avg_metrics, attr, sum(values) / len(values))

        face_detected_count = sum(1 for m in metrics_list if m.face_detected)
        avg_metrics.face_detected = face_detected_count > len(metrics_list) / 2

        return avg_metrics
