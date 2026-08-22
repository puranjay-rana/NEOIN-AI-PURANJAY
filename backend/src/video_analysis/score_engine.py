"""
Score Engine — combines VisualMetrics + AudioMetrics into an OverallScore
and can render a human-readable report. Adapted directly from open_CV.ipynb.
"""
from __future__ import annotations

from src.video_analysis.models import AudioMetrics, OverallScore, VisualMetrics


class ScoreEngine:
    def __init__(self):
        self.weights = {
            "visual": {
                "eye_contact": 0.25,
                "head_pose": 0.15,
                "smile": 0.20,
                "facial_expression": 0.20,
                "body_posture": 0.20,
            },
            "audio": {
                "grammar": 0.25,
                "fluency": 0.25,
                "speaking_speed": 0.15,
                "vocabulary": 0.20,
                "filler_words": 0.15,
            },
            "overall": {
                "visual": 0.25,
                "audio": 0.25,
                "communication": 0.25,
                "confidence": 0.25,
            },
        }

    def calculate_scores(self, visual_metrics: VisualMetrics, audio_metrics: AudioMetrics) -> OverallScore:
        """Calculate overall scores"""
        visual_score = self._calculate_visual_score(visual_metrics)
        audio_score = self._calculate_audio_score(audio_metrics)
        communication_score = self._calculate_communication_score(visual_metrics, audio_metrics)
        confidence_score = self._calculate_confidence_score(visual_metrics, audio_metrics)
        overall_score = self._calculate_overall_score(
            visual_score, audio_score, communication_score, confidence_score
        )

        detailed_metrics = {
            "visual": {
                "eye_contact": visual_metrics.eye_contact_score,
                "head_pose": visual_metrics.head_pose_score,
                "smile": visual_metrics.smile_score,
                "facial_expression": visual_metrics.facial_expression_score,
                "body_posture": visual_metrics.body_posture_score,
                "confidence": visual_metrics.confidence,
            },
            "audio": {
                "grammar": audio_metrics.grammar_score,
                "fluency": audio_metrics.fluency_score,
                "speaking_speed": audio_metrics.speaking_speed,
                "vocabulary": audio_metrics.vocabulary_score,
                "filler_words": max(0, 100 - audio_metrics.filler_word_count * 5),
                "confidence": audio_metrics.confidence_score,
            },
        }

        return OverallScore(
            visual_score=visual_score,
            audio_score=audio_score,
            communication_score=communication_score,
            confidence_score=confidence_score,
            overall_score=overall_score,
            detailed_metrics=detailed_metrics,
        )

    def _calculate_visual_score(self, visual_metrics: VisualMetrics) -> float:
        w = self.weights["visual"]
        return (
            visual_metrics.eye_contact_score * w["eye_contact"]
            + visual_metrics.head_pose_score * w["head_pose"]
            + visual_metrics.smile_score * w["smile"]
            + visual_metrics.facial_expression_score * w["facial_expression"]
            + visual_metrics.body_posture_score * w["body_posture"]
        )

    def _calculate_audio_score(self, audio_metrics: AudioMetrics) -> float:
        w = self.weights["audio"]
        filler_score = max(0, 100 - audio_metrics.filler_word_count * 5)
        return (
            audio_metrics.grammar_score * w["grammar"]
            + audio_metrics.fluency_score * w["fluency"]
            + audio_metrics.speaking_speed * w["speaking_speed"]
            + audio_metrics.vocabulary_score * w["vocabulary"]
            + filler_score * w["filler_words"]
        )

    def _calculate_communication_score(self, visual_metrics: VisualMetrics, audio_metrics: AudioMetrics) -> float:
        speech_clarity = (
            audio_metrics.grammar_score * 0.3
            + audio_metrics.fluency_score * 0.3
            + audio_metrics.vocabulary_score * 0.2
            + (100 - audio_metrics.filler_word_count * 5) * 0.2
        )
        visual_presence = (
            visual_metrics.eye_contact_score * 0.3
            + visual_metrics.facial_expression_score * 0.25
            + visual_metrics.smile_score * 0.25
            + visual_metrics.body_posture_score * 0.2
        )
        return speech_clarity * 0.5 + visual_presence * 0.5

    def _calculate_confidence_score(self, visual_metrics: VisualMetrics, audio_metrics: AudioMetrics) -> float:
        visual_confidence = (
            visual_metrics.eye_contact_score * 0.3
            + visual_metrics.smile_score * 0.2
            + visual_metrics.head_pose_score * 0.2
            + visual_metrics.body_posture_score * 0.3
        )
        audio_confidence = (
            audio_metrics.confidence_score * 0.4
            + audio_metrics.fluency_score * 0.3
            + (100 - audio_metrics.filler_word_count * 5) * 0.3
        )
        return visual_confidence * 0.5 + audio_confidence * 0.5

    def _calculate_overall_score(
        self, visual_score: float, audio_score: float, communication_score: float, confidence_score: float
    ) -> float:
        w = self.weights["overall"]
        return (
            visual_score * w["visual"]
            + audio_score * w["audio"]
            + communication_score * w["communication"]
            + confidence_score * w["confidence"]
        )

    def generate_report(self, overall_score: OverallScore) -> str:
        """Generate comprehensive report"""
        report = "=" * 70 + "\n"
        report += "🎯 VIDEO RESUME ANALYSIS REPORT\n"
        report += "=" * 70 + "\n\n"
        report += "📊 OVERALL SCORES:\n"
        report += "-" * 50 + "\n"
        report += f"Overall Score: {overall_score.overall_score:.1f}/100\n"
        report += f"Visual Score: {overall_score.visual_score:.1f}/100\n"
        report += f"Audio Score: {overall_score.audio_score:.1f}/100\n"
        report += f"Communication Score: {overall_score.communication_score:.1f}/100\n"
        report += f"Confidence Score: {overall_score.confidence_score:.1f}/100\n\n"

        report += "📈 DETAILED METRICS:\n"
        report += "-" * 50 + "\n\n"

        report += "👁️ VISUAL METRICS:\n"
        for key, value in overall_score.detailed_metrics["visual"].items():
            emoji = "✅" if value >= 70 else "⚠️" if value >= 50 else "❌"
            report += f"  {emoji} {key.replace('_', ' ').title()}: {value:.1f}/100\n"

        report += "\n🎤 AUDIO METRICS:\n"
        for key, value in overall_score.detailed_metrics["audio"].items():
            emoji = "✅" if value >= 70 else "⚠️" if value >= 50 else "❌"
            report += f"  {emoji} {key.replace('_', ' ').title()}: {value:.1f}/100\n"

        report += "\n" + "=" * 70 + "\n"

        report += "\n💡 RECOMMENDATIONS:\n"
        report += "-" * 50 + "\n"

        if overall_score.visual_score < 70:
            report += "  • Maintain better eye contact with the camera\n"
            report += "  • Practice confident posture and body language\n"
            report += "  • Smile naturally during your delivery\n"
            report += "  • Keep your head level and face the camera\n"

        if overall_score.audio_score < 70:
            report += "  • Reduce filler words (um, ah, like)\n"
            report += "  • Improve speaking pace for better clarity\n"
            report += "  • Expand vocabulary with professional terms\n"
            report += "  • Practice clear articulation\n"

        if overall_score.communication_score < 70:
            report += "  • Align verbal and non-verbal communication\n"
            report += "  • Practice with video recording and review\n"
            report += "  • Focus on confident delivery and clarity\n"

        if overall_score.confidence_score < 70:
            report += "  • Practice your content multiple times\n"
            report += "  • Use positive self-talk before recording\n"
            report += "  • Record and review your performance\n"

        report += "\n" + "=" * 70 + "\n"

        return report
