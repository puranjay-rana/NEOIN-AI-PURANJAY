import React from "react";
import { History, ShieldCheck } from "lucide-react";

export const TranscriptSection = ({
  transcript,
  transcriptEndRef,
}) => {
  return (
    <div className="full-width-transcript-card">
      {/* Transcript Header Row */}
      <div className="transcript-header-row">
        <h4 className="transcript-title-label">
          <History size={16} style={{ color: "#4f46e5" }} />
          Live Session Transcript History
        </h4>
        <span style={{ fontSize: "0.7rem", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#4f46e5", background: "#eef2ff", border: "1px solid #c7d2fe", padding: "0.3rem 0.75rem", borderRadius: "9999px" }}>
          Real-Time Log Stream
        </span>
      </div>

      {/* Live Transcript Chat Stream */}
      <div className="transcript-scroll-area" style={{ height: "260px", maxHeight: "260px", marginTop: "1rem" }}>
        {transcript.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#94a3b8", fontSize: "0.875rem", fontWeight: "500" }}>
            Live transcript responses will appear here in real-time as the interview progresses...
          </div>
        ) : (
          transcript.map((msg, idx) => (
            <div 
              key={idx} 
              className={msg.sender === "AI Interviewer" ? "chat-bubble-ai" : "chat-bubble-user"}
              style={{ maxWidth: "85%" }}
            >
              <div className="bubble-sender-name">{msg.sender}</div>
              <div style={{ fontWeight: "600", fontSize: "0.9375rem", lineHeight: "1.6" }}>{msg.text}</div>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Bottom Footer Information */}
      <div className="transcript-footer-row" style={{ marginTop: "1rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: "600", color: "#64748b", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <ShieldCheck size={14} style={{ color: "#4f46e5" }} />
          Automated Proctored Session — Real-Time Voice & Video Analysis Active
        </span>
      </div>
    </div>
  );
};




