import React from "react";
import { Mic, MicOff, Video, VideoOff, CheckCircle2, UserX } from "lucide-react";

export const CandidateFeedSection = ({
  videoRef,
  recording,
  toggleMic,
  toggleCam,
  micEnabled,
  camEnabled,
  stopRecording,
  interviewPhase,
  showTextAnswer,
}) => {
  return (
    <div className="video-stage-card">
      {/* Video Element */}
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="video-stage-element" 
        style={{ display: camEnabled ? "block" : "none" }}
      />

      {/* Camera Disabled Placeholder Overlay */}
      {!camEnabled && (
        <div className="video-stage-element" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.75rem", background: "linear-gradient(135deg, #0b0f19 0%, #1e293b 100%)", color: "#94a3b8" }}>
          <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171" }}>
            <VideoOff size={30} />
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontWeight: "700", color: "#ffffff", fontSize: "0.9375rem" }}>Camera Feed Off</p>
            <p style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.2rem" }}>Click "Camera Off" button below to enable camera</p>
          </div>
        </div>
      )}

      {/* Top Overlay Bar */}
      <div className="video-overlay-top">
        <div className="pill-badge-live">
          <span style={{ width: "9px", height: "9px", borderRadius: "50%", backgroundColor: camEnabled ? "#34d399" : "#f87171" }} />
          <span>{camEnabled ? "Live Camera Stream" : "Camera Muted"}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {!micEnabled && (
            <div className="pill-badge-rec" style={{ background: "rgba(220, 38, 38, 0.85)", border: "1px solid rgba(239, 68, 68, 0.4)" }}>
              <MicOff size={13} style={{ color: "#ffffff" }} />
              <span>MIC MUTED</span>
            </div>
          )}

          {recording && micEnabled && (
            <div className="pill-badge-rec">
              <span style={{ width: "9px", height: "9px", borderRadius: "50%", backgroundColor: "#ffffff" }} />
              <span>REC ACTIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Overlay Bar with sleek Action Controls */}
      <div className="video-overlay-bottom">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {/* Mic Toggle Button */}
          <button 
            onClick={toggleMic} 
            className="control-btn-dark"
            style={{
              background: micEnabled ? "rgba(255, 255, 255, 0.12)" : "rgba(239, 68, 68, 0.25)",
              borderColor: micEnabled ? "rgba(255, 255, 255, 0.2)" : "rgba(239, 68, 68, 0.5)",
              color: micEnabled ? "#ffffff" : "#fca5a5",
            }}
            title={micEnabled ? "Click to Mute Microphone" : "Click to Unmute Microphone"}
          >
            {micEnabled ? <Mic size={16} /> : <MicOff size={16} style={{ color: "#f87171" }} />}
            <span>{micEnabled ? "Mute" : "Unmute"}</span>
          </button>

          {/* Camera Toggle Button */}
          <button 
            onClick={toggleCam} 
            className="control-btn-dark"
            style={{
              background: camEnabled ? "rgba(255, 255, 255, 0.12)" : "rgba(239, 68, 68, 0.25)",
              borderColor: camEnabled ? "rgba(255, 255, 255, 0.2)" : "rgba(239, 68, 68, 0.5)",
              color: camEnabled ? "#ffffff" : "#fca5a5",
            }}
            title={camEnabled ? "Click to Turn Off Camera" : "Click to Turn On Camera"}
          >
            {camEnabled ? <Video size={16} /> : <VideoOff size={16} style={{ color: "#f87171" }} />}
            <span>{camEnabled ? "Camera On" : "Camera Off"}</span>
          </button>
        </div>

        {recording && (
          <button 
            onClick={stopRecording}
            className="submit-answer-btn"
          >
            <CheckCircle2 size={17} />
            <span>Submit Answer</span>
          </button>
        )}
      </div>
    </div>
  );
};



