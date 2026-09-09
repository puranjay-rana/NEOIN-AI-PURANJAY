import React from "react";
import { Download, Video, Play, ShieldCheck } from "lucide-react";

export const FullSessionRecordingCard = ({ fullSessionUrl, candidateName }) => {
  return (
    <div className="card space-y-4" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div className="flex-between">
        <div>
          <h3 className="section-title flex-row-center gap-2">
            <Video size={20} className="text-indigo-600" /> Full Candidate Video Recording
          </h3>
          <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Proctored session audio & video replay
          </p>
        </div>
        <span className="badge badge-indigo flex-row-center gap-1">
          <ShieldCheck size={13} /> HD 1080p
        </span>
      </div>

      {fullSessionUrl ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem", justifyContent: "center" }}>
          <video
            controls
            autoPlay={false}
            src={fullSessionUrl}
            className="w-full rounded-xl"
            style={{ maxHeight: "250px", width: "100%", background: "#0f172a", objectFit: "contain" }}
          />
          <div className="flex-between">
            <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: "600" }}>WEBM Stream</span>
            <a
              href={fullSessionUrl}
              download={`interview-${candidateName || "candidate"}.webm`}
              className="btn btn-primary text-xs inline-flex items-center gap-2"
              style={{ padding: "0.45rem 0.85rem" }}
            >
              <Download size={13} /> Download
            </a>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "270px",
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            overflow: "hidden",
            boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ position: "absolute", top: "0.85rem", left: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem", background: "rgba(15,23,42,0.85)", padding: "0.3rem 0.65rem", borderRadius: "9999px", border: "1px solid rgba(255,255,255,0.15)", fontSize: "0.7rem", fontWeight: "700" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444" }} />
            SESSION REPLAY READY
          </div>

          <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px rgba(79, 70, 229, 0.5)", marginBottom: "0.75rem" }}>
            <Play size={24} fill="#ffffff" style={{ marginLeft: "3px" }} />
          </div>

          <div style={{ fontSize: "0.95rem", fontWeight: "700" }}>Candidate Session Recording</div>
          <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.25rem", textAlign: "center", maxWidth: "320px", px: "1rem" }}>
            Video & voice stream captured live during response evaluation cycles.
          </p>
        </div>
      )}
    </div>
  );
};


