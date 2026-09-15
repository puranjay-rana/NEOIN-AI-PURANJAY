import React from "react";
import { History, ArrowLeft, Calendar, Award, User, Briefcase, PlusCircle, ChevronRight, Inbox, Trash2 } from "lucide-react";

export const HistoryPage = ({ historyList = [], loadHistorySession, onBackToSetup, onClearHistory, onDeleteSession }) => {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", width: "100%", padding: "1.75rem 2rem", boxSizing: "border-box" }}>
      
      {/* Executive Single Main Container Card */}
      <div style={{ 
        width: "100%", 
        background: "#ffffff", 
        borderRadius: "20px", 
        border: "1px solid #e2e8f0", 
        boxShadow: "0 10px 30px -5px rgba(0,0,0,0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        
        {/* Integrated Top Navigation & Title Bar Inside Container */}
        <div style={{ 
          padding: "1.25rem 2rem", 
          borderBottom: "1px solid #e2e8f0", 
          background: "#ffffff", 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem"
        }}>
          {/* Left: Sleek Minimalist Back Link & Title */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <button
              onClick={onBackToSetup}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 0.9rem",
                borderRadius: "10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                color: "#475569",
                fontWeight: "700",
                fontSize: "0.825rem",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
              className="table-row-hover"
            >
              <ArrowLeft size={16} style={{ color: "#4f46e5" }} />
              <span>Back to Setup</span>
            </button>

            <div style={{ height: "24px", width: "1px", background: "#e2e8f0" }} />

            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4f46e5" }}>
                <History size={20} />
              </div>
              <div>
                <h1 style={{ fontSize: "1.25rem", fontWeight: "800", color: "#0f172a", margin: 0, letterSpacing: "-0.01em" }}>
                  Assessment Session History
                </h1>
                <p style={{ fontSize: "0.775rem", color: "#64748b", margin: 0 }}>
                  Enterprise Recruiter Portal • MySQL Database Evaluation Logs
                </p>
              </div>
            </div>
          </div>

          {/* Right Action & Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", background: "#f8fafc", padding: "0.4rem 0.85rem", borderRadius: "20px", color: "#4f46e5", fontWeight: "700", fontSize: "0.8rem", border: "1px solid #e2e8f0" }}>
              <span>Total Saved:</span>
              <span style={{ background: "#4f46e5", color: "#ffffff", padding: "0.1rem 0.5rem", borderRadius: "10px", fontSize: "0.75rem" }}>
                {historyList.length}
              </span>
            </div>

            {historyList.length > 0 && (
              <button
                onClick={onClearHistory}
                style={{
                  padding: "0.55rem 0.9rem",
                  fontSize: "0.825rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  borderRadius: "10px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#dc2626",
                  fontWeight: "700",
                  cursor: "pointer"
                }}
              >
                <Trash2 size={15} />
                <span>Clear DB History</span>
              </button>
            )}

            <button
              onClick={onBackToSetup}
              className="launch-btn-primary"
              style={{ padding: "0.55rem 1.1rem", fontSize: "0.825rem", display: "inline-flex", gap: "0.4rem", width: "auto" }}
            >
              <PlusCircle size={16} />
              <span>New Assessment</span>
            </button>
          </div>
        </div>

        {/* Content Body Area */}
        <div style={{ width: "100%", padding: "0", minHeight: "60vh", display: "flex", flexDirection: "column" }}>
          {historyList.length === 0 ? (
            <div style={{ 
              flex: 1, 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center", 
              padding: "5rem 2rem", 
              textAlign: "center" 
            }}>
              <div style={{ width: "72px", height: "72px", borderRadius: "20px", background: "#f8fafc", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1.25rem auto", color: "#94a3b8" }}>
                <Inbox size={36} />
              </div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: "800", color: "#0f172a", margin: "0 0 0.4rem 0" }}>
                No History Added
              </h3>
              <p style={{ color: "#64748b", fontSize: "0.875rem", margin: 0, maxWidth: "420px" }}>
                There are currently no recorded candidate assessment sessions in MySQL database.
              </p>
            </div>
          ) : (
            <div style={{ width: "100%", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "0.75rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Candidate & Role</th>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Date Completed</th>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Technical</th>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Confidence</th>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Delivery (Video)</th>
                    <th style={{ padding: "1.1rem 1.75rem" }}>Overall Score</th>
                    <th style={{ padding: "1.1rem 1.75rem", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyList.map((item, idx) => {
                    const overall = item.overallScore ?? item.scores?.overall ?? item.scores?.technical ?? 0;
                    const technical = item.scores?.technical ?? item.technical_score ?? 0;
                    const confidence = item.confidenceScore ?? item.scores?.confidence ?? 0;
                    const videoDelivery = item.videoScore ?? item.scores?.video ?? item.scores?.audio_delivery ?? 0;

                    return (
                      <tr key={item.id || idx} style={{ borderBottom: "1px solid #f1f5f9", transition: "background 0.15s ease" }} className="table-row-hover">
                        <td style={{ padding: "1.2rem 1.75rem" }}>
                          <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "0.95rem" }}>
                            {item.candidateName || "Candidate"}
                          </div>
                          <div style={{ fontSize: "0.775rem", color: "#4f46e5", fontWeight: "600", marginTop: "0.15rem" }}>
                            {item.appliedRole || "Software Engineer"}
                          </div>
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem", color: "#64748b", fontWeight: "500" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <Calendar size={14} style={{ color: "#94a3b8" }} />
                            <span>{item.interviewDate || "Completed"}</span>
                          </div>
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem", fontWeight: "700", color: "#334155" }}>
                          {technical}%
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem", fontWeight: "700", color: "#334155" }}>
                          {confidence}%
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem", fontWeight: "700", color: "#334155" }}>
                          <span style={{
                            padding: "0.25rem 0.6rem",
                            borderRadius: "6px",
                            background: "#eff6ff",
                            color: "#1d4ed8",
                            fontSize: "0.825rem",
                            fontWeight: "700",
                            border: "1px solid #bfdbfe"
                          }}>
                            {videoDelivery}%
                          </span>
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem" }}>
                          <span style={{ 
                            fontSize: "0.85rem", 
                            fontWeight: "800", 
                            color: overall >= 75 ? "#047857" : "#d97706",
                            background: overall >= 75 ? "#ecfdf5" : "#fffbeb",
                            border: `1px solid ${overall >= 75 ? "#a7f3d0" : "#fde68a"}`,
                            padding: "0.3rem 0.75rem", 
                            borderRadius: "8px" 
                          }}>
                            {overall}%
                          </span>
                        </td>

                        <td style={{ padding: "1.2rem 1.75rem", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                            <button
                              onClick={() => loadHistorySession(item)}
                              className="submit-answer-btn"
                              style={{ padding: "0.55rem 0.95rem", fontSize: "0.775rem", fontWeight: "700", display: "inline-flex", gap: "0.35rem" }}
                            >
                              <Award size={14} />
                              <span>View Report</span>
                              <ChevronRight size={14} />
                            </button>

                            {onDeleteSession && (
                              <button
                                onClick={() => onDeleteSession(item.id)}
                                title="Delete from Database"
                                style={{
                                  padding: "0.55rem 0.65rem",
                                  borderRadius: "8px",
                                  border: "1px solid #fee2e2",
                                  background: "#fef2f2",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
