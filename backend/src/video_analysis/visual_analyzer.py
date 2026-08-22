
from __future__ import annotations

import cv2
import numpy as np

from src.video_analysis.models import VisualMetrics

_face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
_eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")
_smile_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_smile.xml")


class VisualAnalyzer:
    def analyze_frame(self, frame: np.ndarray) -> VisualMetrics:
        """Analyze a single BGR video frame and return VisualMetrics."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        frame_h, frame_w = gray.shape[:2]

        faces = _face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))

        if len(faces) == 0:
            return VisualMetrics(
                eye_contact_score=0.0,
                head_pose_score=0.0,
                smile_score=0.0,
                facial_expression_score=0.0,
                body_posture_score=0.0,
                confidence=0.0,
                face_detected=False,
            )

        # Use the largest detected face
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        face_roi_gray = gray[y : y + h, x : x + w]

        eye_contact_score = self._eye_contact_score(face_roi_gray, x, w, frame_w)
        head_pose_score = self._head_pose_score(x, y, w, h, frame_w, frame_h)
        smile_score = self._smile_score(face_roi_gray)
        facial_expression_score = self._expression_score(face_roi_gray)
        body_posture_score = self._posture_score(x, y, w, h, frame_w, frame_h)

        confidence = (
            eye_contact_score * 0.3
            + head_pose_score * 0.2
            + smile_score * 0.2
            + facial_expression_score * 0.15
            + body_posture_score * 0.15
        )

        return VisualMetrics(
            eye_contact_score=eye_contact_score,
            head_pose_score=head_pose_score,
            smile_score=smile_score,
            facial_expression_score=facial_expression_score,
            body_posture_score=body_posture_score,
            confidence=confidence,
            face_detected=True,
        )

    def _eye_contact_score(self, face_gray: np.ndarray, x: int, w: int, frame_w: int) -> float:
        eyes = _eye_cascade.detectMultiScale(face_gray, scaleFactor=1.1, minNeighbors=8, minSize=(15, 15))
        both_eyes_detected = len(eyes) >= 2

        face_center_x = x + w / 2
        centering = 1 - abs(face_center_x - frame_w / 2) / (frame_w / 2)
        centering = max(0.0, min(1.0, centering))

        base = 60.0 if both_eyes_detected else 30.0
        return min(100.0, base + centering * 40.0)

    def _head_pose_score(self, x: int, y: int, w: int, h: int, frame_w: int, frame_h: int) -> float:
        # Approximate "facing forward" from how centered + how square the
        # face bounding box is (a tilted/turned head tends to detect as a
        # narrower or off-center box with Haar cascades).
        center_x = x + w / 2
        center_y = y + h / 2
        h_centering = 1 - abs(center_x - frame_w / 2) / (frame_w / 2)
        v_centering = 1 - abs(center_y - frame_h / 2.2) / (frame_h / 2)
        aspect = min(w, h) / max(w, h)  # closer to 1 = more "square"/frontal

        score = (max(0, h_centering) * 0.4 + max(0, v_centering) * 0.3 + aspect * 0.3) * 100
        return max(0.0, min(100.0, score))

    def _smile_score(self, face_gray: np.ndarray) -> float:
        smiles = _smile_cascade.detectMultiScale(face_gray, scaleFactor=1.7, minNeighbors=20, minSize=(25, 25))
        return 80.0 if len(smiles) > 0 else 35.0

    def _expression_score(self, face_gray: np.ndarray) -> float:
        # Coarse placeholder: use local contrast/variance as a rough proxy
        # for an animated (vs. flat/blank) expression. Swap for DeepFace in
        # production for real emotion classification.
        variance = float(np.var(face_gray))
        score = min(100.0, (variance / 2500.0) * 100.0)
        return max(20.0, score)

    def _posture_score(self, x: int, y: int, w: int, h: int, frame_w: int, frame_h: int) -> float:
        # Coarse placeholder: a face positioned in the upper-middle portion
        # of frame, at a reasonable size, suggests an upright, camera-facing
        # posture. Swap for MediaPipe Pose in production for real posture
        # estimation.
        size_ratio = (w * h) / (frame_w * frame_h)
        size_score = 100.0 if 0.05 <= size_ratio <= 0.35 else 50.0

        vertical_ratio = y / frame_h
        position_score = 100.0 if vertical_ratio < 0.4 else 60.0

        return size_score * 0.5 + position_score * 0.5
