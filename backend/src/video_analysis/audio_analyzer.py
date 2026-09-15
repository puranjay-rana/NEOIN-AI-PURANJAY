"""
Audio Analyzer — transcribes candidate audio (Whisper) and scores grammar,
fluency, vocabulary, filler-word usage, speaking speed, and vocal confidence.

Adapted from open_CV.ipynb with imports fixed (the original notebook relied
on numpy/spacy/etc. having already been imported in an earlier, unseen cell).
"""
from __future__ import annotations

import numpy as np


from src.video_analysis.models import AudioMetrics


class AudioAnalyzer:
    def __init__(self):
        try:
            import whisper

            self.whisper_available = True
            print("Loading Whisper model...")
            self.model = whisper.load_model("base")
            print("Whisper model loaded successfully!")
        except Exception:
            self.whisper_available = False
            print("Whisper not available. Audio analysis will be limited.")

        try:
            import spacy

            self.nlp = spacy.load("en_core_web_sm")
            self.spacy_available = True
        except Exception:
            self.spacy_available = False
            print("spaCy not available. Grammar analysis will be limited.")

        # Filler words
        self.filler_words = {
            "um", "uh", "er", "ah", "like", "you know", "so",
            "well", "actually", "basically", "literally", "seriously",
            "right", "okay", "ok", "hmm", "mm", "uh-huh",
        }

    def analyze_audio(self, audio_path: str, language: str = None, prompt: str = None) -> AudioMetrics:
        """Analyze audio file"""
        transcript = ""  # Empty string = no transcript yet; callers check truthiness
        grammar_score = 50.0
        fluency_score = 50.0
        speaking_speed = 50.0
        vocabulary_score = 50.0
        filler_count = 0.0
        confidence_score = 50.0

        # Transcribe with Whisper
        if self.whisper_available:
            try:
                transcribe_kwargs = {
                    "temperature": 0.0,
                    "condition_on_previous_text": False,
                    "fp16": False,
                    "no_speech_threshold": 0.6,
                    "logprob_threshold": -1.0,
                    "compression_ratio_threshold": 2.0,
                }
                if language:
                    transcribe_kwargs["language"] = language
                if prompt:
                    transcribe_kwargs["initial_prompt"] = prompt
                else:
                    transcribe_kwargs["initial_prompt"] = (
                        "Technical candidate job interview discussing software development, coding, APIs, databases, "
                        "Python, Node.js, Express, MongoDB, cloud services, and system architecture."
                    )
                result = self.model.transcribe(audio_path, **transcribe_kwargs)
                raw = (result.get("text") or "").strip()
                transcript = raw
                print(f"[AudioAnalyzer] Whisper transcript ({len(transcript)} chars): {transcript[:200]!r}")
            except Exception as e:
                print(f"[AudioAnalyzer] Whisper transcription error: {e}")

        # If we have a real transcript, analyze it
        if transcript:
            try:
                grammar_score = self._analyze_grammar(transcript) if self.spacy_available else 60.0
                vocabulary_score = self._analyze_vocabulary(transcript)
                filler_count = self._count_filler_words(transcript)
                speaking_speed = self._estimate_speaking_speed(audio_path, transcript)
                fluency_score = self._analyze_fluency(transcript)
                confidence_score = self._analyze_audio_confidence(audio_path)
            except Exception as e:
                print(f"Audio analysis error: {e}")

        return AudioMetrics(
            transcript=transcript,
            grammar_score=grammar_score,
            fluency_score=fluency_score,
            speaking_speed=speaking_speed,
            vocabulary_score=vocabulary_score,
            filler_word_count=filler_count,
            confidence_score=confidence_score,
        )

    def _analyze_grammar(self, text: str) -> float:
        """Analyze grammar using spaCy and textstat"""
        try:
            import textstat

            flesch_score = textstat.flesch_reading_ease(text)
            doc = self.nlp(text)

            grammar_errors = 0
            total_sentences = 0

            for sent in doc.sents:
                total_sentences += 1
                for token in sent:
                    if token.dep_ == "nsubj" and token.head.pos_ == "VERB":
                        if token.tag_ == "NN" and token.head.tag_ != "VBZ":
                            grammar_errors += 1
                        elif token.tag_ == "NNS" and token.head.tag_ != "VBP":
                            grammar_errors += 1

            if total_sentences > 0:
                error_rate = grammar_errors / total_sentences
                grammar_score = max(0, 100 - (error_rate * 20))
            else:
                grammar_score = 50

            readability_score = max(0, min(100, flesch_score))
            grammar_score = (grammar_score + readability_score) / 2

            return min(100, grammar_score)

        except Exception as e:
            print(f"Grammar analysis error: {e}")
            return 50.0

    def _analyze_vocabulary(self, text: str) -> float:
        """Analyze vocabulary richness"""
        try:
            words = [word.lower() for word in text.split() if word.isalpha()]

            if len(words) == 0:
                return 50.0

            unique_words = set(words)
            ttr = len(unique_words) / len(words)
            avg_word_length = sum(len(word) for word in words) / len(words)

            ttr_score = ttr * 100
            length_score = min(100, (avg_word_length / 7) * 100)

            vocabulary_score = ttr_score * 0.6 + length_score * 0.4
            return min(100, vocabulary_score)

        except Exception as e:
            print(f"Vocabulary analysis error: {e}")
            return 50.0

    def _count_filler_words(self, text: str) -> float:
        """Count filler words as percentage"""
        try:
            text_lower = text.lower()
            words = text_lower.split()

            filler_count = 0
            for filler in self.filler_words:
                filler_count += text_lower.count(filler)

            total_words = len(words)
            if total_words > 0:
                return (filler_count / total_words) * 100
            return 0.0

        except Exception as e:
            print(f"Filler word analysis error: {e}")
            return 0.0

    def _estimate_speaking_speed(self, audio_path: str, transcript: str) -> float:
        """Estimate speaking speed"""
        try:
            import librosa

            words = len(transcript.split())
            duration = librosa.get_duration(path=audio_path)

            if duration > 0:
                wpm = (words / duration) * 60

                # Score based on WPM (optimal: 140-160)
                if wpm < 80:
                    return (wpm / 80) * 30
                elif wpm < 140:
                    return 30 + ((wpm - 80) / 60) * 30
                elif wpm < 180:
                    return 60 + ((wpm - 140) / 40) * 30
                elif wpm < 220:
                    return 90 - ((wpm - 180) / 40) * 20
                else:
                    return max(0, 70 - ((wpm - 220) / 50) * 70)

            return 50.0

        except Exception as e:
            print(f"Speaking speed analysis error: {e}")
            return 50.0

    def _analyze_fluency(self, text: str) -> float:
        """Analyze fluency based on text features"""
        try:
            words = text.split()
            if len(words) == 0:
                return 50.0

            sentences = [s.strip() for s in text.split(".") if s.strip()]
            if len(sentences) > 0:
                avg_sentence_length = sum(len(s.split()) for s in sentences) / len(sentences)

                # Optimal sentence length is 15-20 words
                if avg_sentence_length < 10:
                    fluency = 50 + (avg_sentence_length / 10) * 30
                elif avg_sentence_length < 25:
                    fluency = 80 + ((avg_sentence_length - 10) / 15) * 15
                else:
                    fluency = 95 - ((avg_sentence_length - 25) / 20) * 30

                return min(100, max(0, fluency))

            return 50.0

        except Exception as e:
            print(f"Fluency analysis error: {e}")
            return 50.0

    def _analyze_audio_confidence(self, audio_path: str) -> float:
        """Analyze confidence from audio features"""
        try:
            import librosa

            audio, sr = librosa.load(audio_path, sr=None)

            # Volume variation
            rms = librosa.feature.rms(y=audio)[0]
            volume_variation = np.std(rms) / np.mean(rms) if np.mean(rms) > 0 else 0

            # Pitch variation
            pitches, _ = librosa.piptrack(y=audio, sr=sr)
            pitch_means = []
            for t in range(pitches.shape[1]):
                pitch_means.append(np.mean(pitches[:, t]))
            pitch_means = np.array(pitch_means)
            pitch_means = pitch_means[pitch_means > 0]

            if len(pitch_means) > 0:
                pitch_variation = np.std(pitch_means) / np.mean(pitch_means)
                volume_confidence = min(100, (volume_variation / 0.3) * 100)
                pitch_confidence = min(100, (pitch_variation / 1.0) * 100)
                return volume_confidence * 0.4 + pitch_confidence * 0.6

            return 50.0

        except Exception as e:
            print(f"Confidence analysis error: {e}")
            return 50.0
