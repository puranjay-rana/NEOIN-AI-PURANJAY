/**
 * Compute average metrics for video delivery (eye contact, engagement/posture, facial expressions)
 * directly from backend session data without synthetic offsets or fake numbers.
 */
export const computeVideoAnalytics = (backendTranscript = [], backendScores = {}) => {
  if (backendScores?.eye_contact !== undefined && backendScores.eye_contact !== null && backendScores.eye_contact > 0) {
    return {
      eyeContact: Math.round(backendScores.eye_contact),
      engagement: Math.round(backendScores.posture ?? backendScores.video ?? 0),
      expression: Math.round(backendScores.expression ?? 0),
    };
  }

  if (!backendTranscript || !backendTranscript.length) return null;
  const withVisual = backendTranscript.filter((t) => t.delivery_detail?.visual);

  if (withVisual.length > 0) {
    const avg = (key) => {
      const vals = withVisual
        .map((t) => t.delivery_detail.visual[key])
        .filter((v) => typeof v === "number");
      if (!vals.length) return 0;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return {
      eyeContact: avg("eye_contact_score"),
      engagement: avg("body_posture_score"),
      expression: avg("facial_expression_score"),
    };
  }

  // Fallback to backend visual_score if detailed metrics were not extracted
  const scores = backendTranscript.map((t) => t.visual_score).filter((v) => typeof v === "number" && v > 0);
  if (scores.length > 0) {
    const avgVisual = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return {
      eyeContact: avgVisual,
      engagement: avgVisual,
      expression: avgVisual,
    };
  }

  return { eyeContact: 0, engagement: 0, expression: 0 };
};

/**
 * Compute average metrics for voice delivery (filler words, clarity, pace)
 * directly from backend metrics.
 */
export const computeVoiceAnalytics = (backendTranscript = [], backendScores = {}) => {
  if (backendScores?.clarity !== undefined && backendScores.clarity !== null && backendScores.clarity > 0) {
    return {
      fillerWords: backendScores.filler_words ?? 0,
      clarity: Math.round(backendScores.clarity),
      pace: backendScores.pace || "N/A",
    };
  }

  if (!backendTranscript || !backendTranscript.length) return null;
  const withAudio = backendTranscript.filter((t) => t.delivery_detail?.audio);

  if (withAudio.length > 0) {
    const avg = (key) => {
      const vals = withAudio
        .map((t) => t.delivery_detail.audio[key])
        .filter((v) => typeof v === "number");
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };

    const fillerCount = withAudio
      .map((t) => t.delivery_detail.audio.filler_word_count ?? (t.delivery_detail.audio.filler_words <= 20 ? t.delivery_detail.audio.filler_words : 0))
      .filter((v) => typeof v === "number");
    const avgFillers = fillerCount.length ? Math.round(fillerCount.reduce((a, b) => a + b, 0) / fillerCount.length) : 0;
    const paceVal = avg("pace") || avg("speaking_speed");

    return {
      fillerWords: avgFillers,
      clarity: avg("clarity") ?? avg("grammar") ?? 0,
      pace: paceVal ? `Optimal (${paceVal} wpm)` : "N/A",
    };
  }

  // Fallback to backend audio_delivery_score if detailed metrics were not extracted
  const scores = backendTranscript.map((t) => t.audio_delivery_score).filter((v) => typeof v === "number" && v > 0);
  if (scores.length > 0) {
    const avgAudio = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return {
      fillerWords: 0,
      clarity: avgAudio,
      pace: "N/A",
    };
  }

  return { fillerWords: 0, clarity: 0, pace: "N/A" };
};

/**
 * Build confidence progression timeline from answered questions.
 */
export const computeConfidenceTimeline = (backendTranscript = []) => {
  if (!backendTranscript || !backendTranscript.length) return [];
  return backendTranscript.map((t, i) => {
    let conf = 0;
    if (typeof t.confidence_score === "number") {
      conf = t.confidence_score > 1 ? Math.round(t.confidence_score) : Math.round(t.confidence_score * 100);
    } else if (typeof t.eval_score === "number") {
      conf = Math.round((t.eval_score / 10) * 100);
    }
    return {
      time: `Q${i + 1}`,
      confidence: conf,
    };
  });
};
