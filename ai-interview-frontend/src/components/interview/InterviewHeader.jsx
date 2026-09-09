import React from "react";
import { formatTime } from "../../utils/formatters";
import { INTERVIEW_MAX_SECONDS } from "../../config/constants";
import { Clock, ShieldCheck, Zap } from "lucide-react";

export const InterviewHeader = ({ elapsedSeconds, candidateName, appliedRole }) => {
  return (
    <header style={{ height: "64px", backgroundColor: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyBetween: "space-between", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 40, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", fontWeight: "800", color: "#0f172a", fontSize: "1rem" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: "linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)", display: "flex", alignItems: "center", justifyCenter: "center", justifyContent: "center", color: "#ffffff" }}>
          <Zap size={18} />
        </div>
        <span style={{ letterSpacing: "-0.01em" }}>AI Assessment Studio</span>
        <span className="setup-header-badge" style={{ padding: "0.25rem 0.65rem", fontSize: "0.7rem" }}>
          <ShieldCheck size={13} /> PROCTORED
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {appliedRole && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontWeight: "700", color: "#334155", backgroundColor: "#f8fafc", padding: "0.4rem 0.85rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <span style={{ color: "#64748b", textTransform: "uppercase", fontSize: "0.65rem", letterSpacing: "0.05em" }}>Role:</span>
            <span style={{ color: "#4f46e5", fontWeight: "800" }}>{appliedRole}</span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: "monospace", fontSize: "0.8125rem", fontWeight: "800", color: "#0f172a", backgroundColor: "#f8fafc", padding: "0.4rem 0.85rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
          <Clock size={15} style={{ color: "#4f46e5" }} />
          <span>{formatTime(elapsedSeconds)} / {formatTime(INTERVIEW_MAX_SECONDS)}</span>
        </div>
      </div>
    </header>
  );
};

