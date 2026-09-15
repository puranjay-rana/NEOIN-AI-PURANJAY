import React from "react";
import { Eye, Volume2, Users, Activity, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export const AnalyticsSection = ({ 
  videoAnalytics, 
  voiceAnalytics, 
  confidenceTimeline = [], 
  cheatStats = {} 
}) => {
  const video = videoAnalytics || { eyeContact: 0, engagement: 0, expression: 0 };
  const voice = voiceAnalytics || { fillerWords: 0, clarity: 0, pace: "N/A" };

  const defaultTimeline = confidenceTimeline || [];

  const multipleFacesCount = cheatStats.multipleFaces || 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1.5rem", width: "100%", alignItems: "stretch" }}>
      
      {/* CARD 1: Video & Behavioral Analytics (Integrated with Multiple Faces Detection) */}
      <div 
        style={{ 
          background: "#ffffff", 
          borderRadius: "20px", 
          border: "1px solid #e2e8f0", 
          padding: "1.35rem", 
          display: "flex", 
          flexDirection: "column", 
          justifyContent: "space-between", 
          gap: "1.1rem",
          boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.03)",
          minHeight: "295px"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
            <Eye size={18} style={{ color: "#4f46e5" }} /> Video & Behavioral Analytics
          </h3>
          <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#4f46e5", background: "#eef2ff", border: "1px solid #c7d2fe", padding: "0.25rem 0.65rem", borderRadius: "9999px" }}>
            Recorded Video Frames
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.6rem" }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Eye Contact</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#0f172a", marginTop: "0.15rem" }}>{video.eyeContact}%</div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Posture</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#0f172a", marginTop: "0.15rem" }}>{video.engagement}%</div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Expression</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#0f172a", marginTop: "0.15rem" }}>{video.expression}%</div>
          </div>

          <div style={{ background: multipleFacesCount > 0 ? "#fffbeb" : "#f8fafc", border: `1px solid ${multipleFacesCount > 0 ? "#fde68a" : "#e2e8f0"}`, borderRadius: "10px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: multipleFacesCount > 0 ? "#b45309" : "#64748b", letterSpacing: "0.02em", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.2rem" }}>
              <Users size={10} /> Multi-Faces
            </div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: multipleFacesCount > 0 ? "#b45309" : "#047857", marginTop: "0.15rem" }}>
              {multipleFacesCount > 0 ? `${multipleFacesCount} Alert` : "0 Clean"}
            </div>
          </div>
        </div>

        <div style={{ background: "#f8fafc", borderRadius: "14px", padding: "0.75rem 0.9rem", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.68rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", marginBottom: "0.35rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <Activity size={13} style={{ color: "#4f46e5" }} /> Confidence Progression Timeline
          </div>
          <div style={{ height: "80px", width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {defaultTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={defaultTimeline} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} tickLine={false} />
                  <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} />
                  <Tooltip 
                    formatter={(val) => [`${val}% Confidence`, "Confidence Score"]}
                    labelFormatter={(label) => `Question ${label}`}
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1', color: '#0f172a', borderRadius: '8px', fontSize: '11px', padding: '4px 8px', fontWeight: '600' }} 
                  />
                  <Line type="monotone" dataKey="confidence" stroke="#4f46e5" strokeWidth={2.5} dot={{ fill: '#4f46e5', r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>No timeline points recorded</div>
            )}
          </div>
        </div>
      </div>

      {/* CARD 2: Voice & Speech Analytics */}
      <div 
        style={{ 
          background: "#ffffff", 
          borderRadius: "20px", 
          border: "1px solid #e2e8f0", 
          padding: "1.35rem", 
          display: "flex", 
          flexDirection: "column", 
          justifyContent: "space-between", 
          gap: "1.1rem",
          boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.03)",
          minHeight: "295px"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
            <Volume2 size={18} style={{ color: "#4f46e5" }} /> Voice & Speech Analytics
          </h3>
          <span style={{ fontSize: "0.68rem", fontWeight: "700", color: "#4f46e5", background: "#eef2ff", border: "1px solid #c7d2fe", padding: "0.25rem 0.65rem", borderRadius: "9999px" }}>
            Recorded Audio Stream
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem" }}>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Filler Words</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#d97706", marginTop: "0.15rem" }}>{voice.fillerWords}</div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Clarity Score</div>
            <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#0f172a", marginTop: "0.15rem" }}>{voice.clarity}%</div>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.65rem 0.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.625rem", fontWeight: "700", textTransform: "uppercase", color: "#64748b", letterSpacing: "0.02em" }}>Pace</div>
            <div style={{ fontSize: "0.925rem", fontWeight: "800", color: "#0f172a", marginTop: "0.3rem" }}>{voice.pace}</div>
          </div>
        </div>

        <div style={{ background: "#f8fafc", borderRadius: "14px", padding: "0.85rem 1rem", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ fontSize: "0.68rem", fontWeight: "700", color: "#4f46e5", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            Acoustic Signal Quality
          </div>
          <div style={{ fontSize: "0.8rem", fontWeight: "600", color: "#334155", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <CheckCircle2 size={14} style={{ color: "#059669" }} /> Clear acoustic capture • Minimal background noise
          </div>
        </div>
      </div>

    </div>
  );
};
