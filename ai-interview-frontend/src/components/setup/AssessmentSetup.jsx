import React, { useRef, useState } from "react";
import { INTERVIEW_LANGUAGES } from "../../config/constants";
import { 
  Sparkles, 
  ShieldCheck, 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  Briefcase, 
  AlignLeft, 
  Globe, 
  ArrowRight,
  Loader2,
  BarChart2
} from "lucide-react";

export const AssessmentSetup = ({
  candidateName,
  setCandidateName,
  appliedRole,
  setAppliedRole,
  handleResumeChange,
  jobDescription,
  setJobDescription,
  interviewLanguage,
  setInterviewLanguage,
  startInterview,
  isStarting,
  error,
  previewDashboard,
}) => {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
    } else {
      setFileName("");
    }
    handleResumeChange(e);
  };

  return (
    <div className="setup-page-wrapper">
      <div className="setup-card-container" style={{ padding: "1.75rem 2.25rem" }}>
        
        {/* Header Title */}
        <div style={{ textAlign: "center" }}>
          <div className="setup-header-badge">
            <ShieldCheck size={14} /> SECURE RECRUITER PORTAL
          </div>
          <h1 className="setup-title" style={{ fontSize: "1.75rem", marginTop: "0.35rem", marginBottom: "0.15rem" }}>
            <Sparkles style={{ color: "#4f46e5", width: "24px", height: "24px" }} /> AI Mock Interview
          </h1>
          <p className="setup-subtitle" style={{ fontSize: "0.8125rem" }}>Configure assessment parameters to launch session</p>
        </div>

        {error && (
          <div className="alert-box alert-error-style" style={{ marginTop: "1rem", padding: "0.6rem 1rem", fontSize: "0.8125rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
            {error}
          </div>
        )}

        <div style={{ marginTop: "1.15rem" }}>
          {/* TOP HERO FEATURE: Sleek Compact Upload PDF Resume Box */}
          <div className="setup-field-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="setup-field-label">
                Upload Candidate PDF Resume
              </label>
              <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: "600" }}>Optional</span>
            </div>
            
            {/* Native file input strictly hidden */}
            <input 
              ref={fileInputRef}
              type="file" 
              accept="application/pdf" 
              onChange={onFileSelect} 
              disabled={isStarting}
              style={{ display: "none" }}
            />

            {/* Custom Compact Drag & Drop Box */}
            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`upload-drop-zone ${fileName ? "has-file" : ""}`}
              style={{ padding: "0.75rem 1.25rem", flexDirection: "row", justifyContent: "flex-start", gap: "1rem" }}
            >
              {fileName ? (
                <>
                  <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", flexShrink: 0 }}>
                    <CheckCircle2 size={20} />
                  </div>
                  <div style={{ textAlign: "left", flex: 1, overflow: "hidden" }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.4rem", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <FileText size={16} style={{ color: "#059669" }} /> {fileName}
                    </p>
                    <p style={{ fontSize: "0.7rem", color: "#047857", fontWeight: "600", margin: 0 }}>PDF Attached — Click to replace file</p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4f46e5", flexShrink: 0 }}>
                    <UploadCloud size={20} />
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: "700", color: "#0f172a", margin: 0 }}>Upload PDF Resume</p>
                    <p style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: "500", margin: 0 }}>Click or drag & drop candidate PDF file</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Form Fields Section */}
          <div className="setup-form-grid" style={{ marginTop: "1rem", paddingTop: "1rem", gap: "0.85rem" }}>
            {/* Row 1: Target Job Title & Interview Language Side-by-Side */}
            <div className="form-row-dual">
              <div className="setup-field-group">
                <label className="setup-field-label">
                  <Briefcase size={14} style={{ color: "#94a3b8" }} /> Target Job Title
                </label>
                <input 
                  type="text" 
                  value={appliedRole} 
                  onChange={(e) => setAppliedRole(e.target.value)} 
                  placeholder="e.g. Senior Frontend Engineer"
                  className="setup-input-control" 
                  style={{ padding: "0.6rem 0.9rem" }}
                />
              </div>

              <div className="setup-field-group">
                <label className="setup-field-label">
                  <Globe size={14} style={{ color: "#94a3b8" }} /> Interview Language
                </label>
                <select
                  value={interviewLanguage}
                  onChange={(e) => setInterviewLanguage(e.target.value)}
                  className="setup-input-control"
                  style={{ cursor: "pointer", padding: "0.6rem 0.9rem" }}
                >
                  {INTERVIEW_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Compact Job Description */}
            <div className="setup-field-group">
              <label className="setup-field-label">
                <AlignLeft size={14} style={{ color: "#94a3b8" }} /> Job Description Requirements
              </label>
              <textarea 
                rows={2} 
                placeholder="Paste role requirements..." 
                value={jobDescription} 
                onChange={(e) => setJobDescription(e.target.value)} 
                className="setup-input-control"
                style={{ resize: "vertical", minHeight: "65px", padding: "0.6rem 0.9rem" }}
              />
            </div>
          </div>

          {/* DEDICATED ACTION BUTTON FOOTER */}
          <div className="setup-action-footer" style={{ marginTop: "1.15rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <button 
              onClick={startInterview} 
              disabled={isStarting} 
              className="launch-btn-primary"
              style={{ padding: "0.85rem 1.25rem", fontSize: "0.95rem" }}
            >
              {isStarting ? (
                <>
                  <Loader2 style={{ width: "18px", height: "18px", animation: "spin 1s linear infinite" }} />
                  <span>Initializing Session...</span>
                </>
              ) : (
                <>
                  <span>Launch Assessment Session</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>

            {previewDashboard && (
              <button
                type="button"
                onClick={previewDashboard}
                className="repeat-btn-secondary"
                style={{ width: "100%", justifyContent: "center", padding: "0.7rem", fontSize: "0.8125rem" }}
              >
                <BarChart2 size={16} style={{ color: "#4f46e5" }} />
                <span>Open Recruiter Results Dashboard Direct</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

