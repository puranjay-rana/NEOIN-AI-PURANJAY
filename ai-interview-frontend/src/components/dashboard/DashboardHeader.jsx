import React from "react";
import { CheckCircle, Briefcase, Calendar, Clock, Download, ArrowLeft, Sparkles } from "lucide-react";
import { formatTime } from "../../utils/formatters";
import { Badge } from "../common/UIComponents";

export const DashboardHeader = ({ candidateName, appliedRole, interviewDate, elapsedSeconds, resetToSetup, finalReport }) => {
  return (
    <div className="card dashboard-header" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "1rem" }}>
        <div className="header-info">
          <div className="flex-row-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900" style={{ margin: 0 }}>{candidateName || "Candidate"}</h1>
            <Badge variant="emerald" className="flex-row-center gap-1">
              <CheckCircle size={14} /> Completed & Verified
            </Badge>
          </div>
          <div className="meta-info-row">
            <span className="flex-row-center gap-1.5"><Briefcase size={15} /> {appliedRole}</span>
            <span className="flex-row-center gap-1.5"><Calendar size={15} /> {interviewDate}</span>
            <span className="flex-row-center gap-1.5"><Clock size={15} /> {formatTime(elapsedSeconds)}</span>
          </div>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          {resetToSetup && (
            <button onClick={resetToSetup} className="repeat-btn-secondary" style={{ padding: "0.65rem 1.1rem" }}>
              <ArrowLeft size={16} style={{ color: "#4f46e5" }} /> New Assessment Setup
            </button>
          )}
          <button onClick={() => window.print()} className="btn btn-primary flex-row-center gap-2">
            <Download size={16} /> Download Full Report
          </button>
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)", border: "1px solid #c7d2fe", borderRadius: "14px", padding: "1rem 1.25rem", width: "100%", boxSizing: "border-box" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: "700", color: "#4f46e5", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <Sparkles size={13} /> AI Evaluation Executive Summary
        </div>
        <p style={{ color: "#0f172a", fontSize: "0.9375rem", lineHeight: "1.6", fontWeight: "500", margin: 0 }}>
          {finalReport || "The candidate demonstrated high architectural proficiency, structured problem solving, and effective communication skills."}
        </p>
      </div>
    </div>
  );
};


