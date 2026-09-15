import React from "react";
import { AlertTriangle, ChevronUp, ChevronDown, Sparkles, MessageSquare, Award, Cpu, FileText, Mic, Eye, CheckCircle2, TrendingUp } from "lucide-react";

export const QuestionBreakdown = ({ backendTranscript = [], scores = {}, expandedIndex, setExpandedIndex }) => {
  // Use the authoritative overall score calculated directly by the backend ScoreEngine
  const sessionOverallAvg = scores?.overall !== undefined && scores?.overall !== null
    ? Math.round(scores.overall)
    : (backendTranscript.length > 0
        ? Math.round(
            backendTranscript.reduce((acc, q) => {
              const rawTech = q.eval_score ?? q.technical_score ?? 0;
              const rawRel = q.relevance_score ?? 0;
              const rawComm = q.communication_score ?? 0;
              const t = rawTech > 10 ? rawTech / 10 : Number(rawTech);
              const r = rawRel > 10 ? rawRel / 10 : Number(rawRel);
              const c = rawComm > 10 ? rawComm / 10 : Number(rawComm);
              return acc + Math.round(((t + r + c) / 3) * 10);
            }, 0) / backendTranscript.length
          )
        : 0);

  let overallRatingLabel = "Needs Improvement";
  let overallRatingColor = "#dc2626";
  let overallRatingBg = "#fef2f2";
  let overallRatingBorder = "#fecaca";

  if (sessionOverallAvg >= 80) {
    overallRatingLabel = "Strong Hire (Excellent)";
    overallRatingColor = "#047857";
    overallRatingBg = "#ecfdf5";
    overallRatingBorder = "#a7f3d0";
  } else if (sessionOverallAvg >= 65) {
    overallRatingLabel = "Proficient (Passed)";
    overallRatingColor = "#4f46e5";
    overallRatingBg = "#eef2ff";
    overallRatingBorder = "#c7d2fe";
  } else if (sessionOverallAvg >= 50) {
    overallRatingLabel = "Developing Candidate";
    overallRatingColor = "#b45309";
    overallRatingBg = "#fffbeb";
    overallRatingBorder = "#fde68a";
  }

  return (
    <div className="card space-y-5" style={{ background: "#ffffff", borderRadius: "20px", border: "1px solid #e2e8f0", boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.05)", padding: "1.5rem" }}>
      {/* Executive Section Header */}
      <div className="flex-between" style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h3 className="section-title flex-row-center gap-2" style={{ fontSize: "1.15rem", fontWeight: "700", color: "#0f172a" }}>
            <Award size={22} style={{ color: "#4f46e5" }} />
            Question Breakdown & AI Evaluation
          </h3>
          <p style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.25rem" }}>
            Detailed per-question dimensional metrics, candidate spoken answers, and AI analysis
          </p>
        </div>
        
        {/* Overall Session Score Card */}
        {backendTranscript.length > 0 && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "14px", padding: "0.6rem 1.1rem", display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b" }}>
                Overall Session Score
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: "800", color: "#0f172a", lineHeight: "1.2" }}>
                {sessionOverallAvg}<span style={{ fontSize: "0.85rem", color: "#64748b" }}>/100</span>
              </div>
            </div>

            <span style={{ fontSize: "0.75rem", fontWeight: "700", color: overallRatingColor, background: overallRatingBg, border: `1px solid ${overallRatingBorder}`, padding: "0.4rem 0.85rem", borderRadius: "10px" }}>
              {overallRatingLabel}
            </span>
          </div>
        )}
      </div>

      {/* Content Stream */}
      <div className="space-y-4">
        {backendTranscript.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94a3b8", fontSize: "0.875rem", background: "#f8fafc", borderRadius: "16px", border: "1px dashed #cbd5e1" }}>
            <FileText size={32} style={{ margin: "0 auto 0.75rem auto", opacity: 0.5, color: "#64748b" }} />
            No completed answers were recorded for this interview session.
          </div>
        ) : (
          backendTranscript.map((q, idx) => {
            const rawTech = q.eval_score ?? q.technical_score ?? q.technical ?? q.current_eval_score;
            const rawRel = q.relevance_score ?? q.relevance ?? q.current_relevance_score;
            const rawComm = q.communication_score ?? q.communication ?? q.current_communication_score;

            const tech10 = rawTech !== undefined && rawTech !== null ? (rawTech > 10 ? rawTech / 10 : Number(rawTech)) : 0;
            const rel10 = rawRel !== undefined && rawRel !== null ? (rawRel > 10 ? rawRel / 10 : Number(rawRel)) : 0;
            const comm10 = rawComm !== undefined && rawComm !== null ? (rawComm > 10 ? rawComm / 10 : Number(rawComm)) : 0;

            const contentAvgPercent = Math.min(100, Math.max(0, Math.round(((tech10 + rel10 + comm10) / 3) * 10)));

            const visualScore = q.visual_score ?? q.current_visual_score ?? 0;
            const audioScore = q.audio_delivery_score ?? q.audio_score ?? 0;
            const rawConf = q.confidence_score ?? q.confidence ?? 0;
            const confPercent = typeof rawConf === "number"
              ? (rawConf <= 1.0 ? Math.round(rawConf * 100) : Math.round(rawConf))
              : 0;

            const hasDelivery = visualScore > 0 || audioScore > 0;
            const questionOverall = hasDelivery
              ? Math.min(100, Math.max(0, Math.round(
                  (tech10 * 10 * 0.40) +
                  (rel10 * 10 * 0.15) +
                  (comm10 * 10 * 0.15) +
                  (confPercent * 0.10) +
                  (visualScore * 0.10) +
                  (audioScore * 0.10)
                )))
              : contentAvgPercent;

            const isExpanded = expandedIndex === idx;

            let badgeBg = "#ecfdf5";
            let badgeText = "#047857";
            let badgeBorder = "#a7f3d0";

            if (questionOverall < 40) {
              badgeBg = "#fef2f2";
              badgeText = "#b91c1c";
              badgeBorder = "#fecaca";
            } else if (questionOverall < 70) {
              badgeBg = "#fffbeb";
              badgeText = "#b45309";
              badgeBorder = "#fde68a";
            }

            return (
              <div 
                key={idx} 
                style={{ 
                  background: "#ffffff", 
                  border: isExpanded ? "1.5px solid #4f46e5" : "1px solid #e2e8f0", 
                  borderRadius: "16px", 
                  overflow: "hidden", 
                  transition: "all 0.2s ease-in-out",
                  boxShadow: isExpanded ? "0 10px 25px -5px rgba(79, 70, 229, 0.08)" : "none"
                }}
              >
                {/* Accordion Header */}
                <div
                  onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                  style={{
                    padding: "1.1rem 1.25rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                    background: isExpanded ? "#f8fafc" : "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flex: 1 }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: "800", color: "#4f46e5", background: "#eef2ff", border: "1px solid #c7d2fe", padding: "0.3rem 0.75rem", borderRadius: "10px", flexShrink: 0 }}>
                      Q{idx + 1}
                    </span>
                    <span style={{ fontSize: "0.925rem", fontWeight: "600", color: "#0f172a", lineHeight: "1.4" }}>
                      {q.question || `Question ${idx + 1}`}
                    </span>
                    {q.multiple_faces_detected && (
                      <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", padding: "0.25rem 0.6rem", borderRadius: "9999px", display: "inline-flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}>
                        <AlertTriangle size={12} /> Multiple faces
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexShrink: 0 }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: "800", color: badgeText, background: badgeBg, border: `1px solid ${badgeBorder}`, padding: "0.4rem 0.9rem", borderRadius: "12px", whiteSpace: "nowrap" }}>
                      Overall Score: {questionOverall}/100
                    </span>
                    {isExpanded ? <ChevronUp size={18} style={{ color: "#64748b" }} /> : <ChevronDown size={18} style={{ color: "#64748b" }} />}
                  </div>
                </div>

                {/* Accordion Body */}
                {isExpanded && (
                  <div style={{ padding: "1.25rem", borderTop: "1px solid #f1f5f9", background: "#ffffff", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                    
                    {/* Metrics Breakdown Progress Grid */}
                    <div style={{ background: "#f8fafc", borderRadius: "14px", padding: "1.1rem", border: "1px solid #e2e8f0" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem" }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#475569", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <Cpu size={14} style={{ color: "#4f46e5" }} />
                          Question Evaluation Metrics
                        </div>
                        <span style={{ fontSize: "0.75rem", fontWeight: "800", color: "#4f46e5" }}>
                          Overall Question Score: {questionOverall}%
                        </span>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
                        {/* Technical Score */}
                        <div style={{ background: "#ffffff", padding: "0.75rem 0.9rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", color: "#334155", marginBottom: "0.35rem" }}>
                            <span>Technical Depth</span>
                            <span style={{ color: "#4f46e5" }}>{tech10.toFixed(1)} / 10</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                            <div style={{ width: `${tech10 * 10}%`, height: "100%", background: "linear-gradient(90deg, #4f46e5, #818cf8)", borderRadius: "9999px" }} />
                          </div>
                        </div>

                        {/* Relevance Score */}
                        <div style={{ background: "#ffffff", padding: "0.75rem 0.9rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", color: "#334155", marginBottom: "0.35rem" }}>
                            <span>Answer Relevance</span>
                            <span style={{ color: "#059669" }}>{rel10.toFixed(1)} / 10</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                            <div style={{ width: `${rel10 * 10}%`, height: "100%", background: "linear-gradient(90deg, #059669, #34d399)", borderRadius: "9999px" }} />
                          </div>
                        </div>

                        {/* Communication Score */}
                        <div style={{ background: "#ffffff", padding: "0.75rem 0.9rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", color: "#334155", marginBottom: "0.35rem" }}>
                            <span>Communication</span>
                            <span style={{ color: "#2563eb" }}>{comm10.toFixed(1)} / 10</span>
                          </div>
                          <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                            <div style={{ width: `${comm10 * 10}%`, height: "100%", background: "linear-gradient(90deg, #2563eb, #60a5fa)", borderRadius: "9999px" }} />
                          </div>
                        </div>

                        {/* Visual Delivery Score */}
                        {visualScore > 0 && (
                          <div style={{ background: "#ffffff", padding: "0.75rem 0.9rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", color: "#334155", marginBottom: "0.35rem" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                <Eye size={12} style={{ color: "#7c3aed" }} /> Visual Delivery
                              </span>
                              <span style={{ color: "#7c3aed" }}>{Math.round(visualScore)} / 100</span>
                            </div>
                            <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, visualScore)}%`, height: "100%", background: "linear-gradient(90deg, #7c3aed, #c084fc)", borderRadius: "9999px" }} />
                            </div>
                          </div>
                        )}

                        {/* Audio Delivery Score */}
                        {audioScore > 0 && (
                          <div style={{ background: "#ffffff", padding: "0.75rem 0.9rem", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", color: "#334155", marginBottom: "0.35rem" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                                <Mic size={12} style={{ color: "#d97706" }} /> Audio Delivery
                              </span>
                              <span style={{ color: "#d97706" }}>{Math.round(audioScore)} / 100</span>
                            </div>
                            <div style={{ width: "100%", height: "6px", background: "#e2e8f0", borderRadius: "9999px", overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, audioScore)}%`, height: "100%", background: "linear-gradient(90deg, #d97706, #fbbf24)", borderRadius: "9999px" }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* AI Feedback & Analysis Card */}
                    <div style={{ background: "#f5f3ff", borderRadius: "14px", padding: "1.1rem", borderLeft: "4px solid #4f46e5", border: "1px solid #ddd6fe", borderLeftWidth: "4px" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.05em", color: "#4338ca", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <Sparkles size={15} style={{ color: "#4f46e5" }} />
                        AI Feedback & Detailed Analysis
                      </div>
                      <p style={{ fontSize: "0.875rem", color: "#1e1b4b", lineHeight: "1.65", fontWeight: "500", margin: 0 }}>
                        {q.feedback || "AI evaluation completed for this response."}
                      </p>
                    </div>

                    {/* Candidate Spoken Answer Card (Clean White/Light Theme - NO Black BG) */}
                    <div style={{ background: "#f8fafc", borderRadius: "14px", padding: "1.1rem", border: "1px solid #cbd5e1" }}>
                      <div style={{ fontSize: "0.725rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#475569", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <MessageSquare size={14} style={{ color: "#4f46e5" }} />
                        Candidate Spoken / Typed Response
                      </div>
                      <p style={{ fontSize: "0.875rem", color: "#0f172a", lineHeight: "1.6", fontWeight: "500", fontStyle: "italic", margin: 0 }}>
                        "{q.answer || q.text || q.candidate_answer || "(no answer text captured)"}"
                      </p>
                    </div>

                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
