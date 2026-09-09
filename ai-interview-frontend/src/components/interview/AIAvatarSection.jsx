import React from "react";
import { RotateCcw, Bot, Sparkles, Volume2, LogOut, Edit3, Send } from "lucide-react";

export const AIAvatarSection = ({
  isSpeakingAI,
  status,
  questionNumber,
  maxQuestions,
  question,
  isProcessing,
  repeatQuestion,
  setShowExitModal,
  showTextAnswer,
  setShowTextAnswer,
  answer,
  setAnswer,
  sendTextAnswer,
}) => {
  const currentNum = questionNumber || 1;
  const totalNum = maxQuestions || 10;
  const progressPercent = Math.min(100, Math.max(10, (currentNum / totalNum) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* AI Assistant Avatar Header Card */}
      <div className="ai-persona-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <div className="ai-avatar-icon-box">
            <Bot size={22} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontWeight: "700", fontSize: "0.875rem", color: "#ffffff" }}>AI Interviewer</span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: "500", marginTop: "0.15rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: isSpeakingAI ? "#818cf8" : "#34d399" }} />
              {isSpeakingAI ? "Speaking..." : status || "Ready"}
            </p>
          </div>
        </div>

        {isSpeakingAI ? (
          <div className="ai-status-pill" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Volume2 size={13} style={{ color: "#a5b4fc" }} />
            <span>Speaking</span>
          </div>
        ) : (
          <span className="ai-status-pill">PROCTORED</span>
        )}
      </div>

      {/* Progress & Question Box */}
      <div className="question-hero-card">
        {/* Progress Bar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div className="question-progress-header">
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <Sparkles size={14} style={{ color: "#4f46e5" }} /> Question {currentNum} of {totalNum}
            </span>
            <span style={{ fontWeight: "700", color: "#64748b" }}>{Math.round(progressPercent)}%</span>
          </div>
          <div className="progress-track-bar">
            <div className="progress-fill-bar" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        {/* Question Text */}
        <div className="question-body-text">
          {isProcessing ? (
            <span style={{ color: "#4f46e5", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#4f46e5" }} />
              Evaluating your response...
            </span>
          ) : (
            question || "Initializing interview question..."
          )}
        </div>

        {/* Inline Text Answer Input Box (Right next to Question) */}
        {showTextAnswer && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.85rem", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: "14px", marginTop: "0.5rem" }}>
            <label style={{ fontSize: "0.7rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#475569" }}>
              Type Text Answer Response
            </label>
            <textarea 
              rows={3} 
              placeholder="Type your response here..." 
              value={answer} 
              onChange={(e) => setAnswer(e.target.value)} 
              className="setup-input-control"
              style={{ minHeight: "85px", resize: "vertical", fontSize: "0.875rem" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button 
                onClick={sendTextAnswer} 
                className="submit-answer-btn"
                style={{ padding: "0.5rem 1rem", fontSize: "0.75rem" }}
              >
                <span>Submit Text Answer</span>
                <Send size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Question Action Controls Row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderTop: "1px solid #e0e7ff", paddingTop: "0.75rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {setShowTextAnswer && (
              <button 
                onClick={() => setShowTextAnswer(!showTextAnswer)} 
                className="repeat-btn-secondary"
              >
                <Edit3 size={13} style={{ color: "#4f46e5" }} />
                <span>{showTextAnswer ? "Hide Input" : "Type Answer"}</span>
              </button>
            )}

            {!isProcessing && question && (
              <button
                onClick={repeatQuestion}
                disabled={isSpeakingAI}
                className="repeat-btn-secondary"
                title="Repeat question audio"
              >
                <RotateCcw size={13} style={{ color: "#4f46e5" }} />
                <span>Repeat</span>
              </button>
            )}
          </div>

          {setShowExitModal && (
            <button 
              onClick={() => setShowExitModal(true)} 
              className="finish-early-btn"
            >
              <LogOut size={13} />
              <span>Finish Early</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};




