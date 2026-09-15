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
  History,
  X,
  Award,
  Calendar,
  AlertCircle
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
  historyList = [],
  loadHistorySession,
  onOpenHistory
}) => {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [validationError, setValidationError] = useState("");

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setCandidateName(file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9 ]/g, " "));
      setValidationError("");
    } else {
      setFileName("");
    }
    handleResumeChange(e);
  };

  const handleLaunchSession = () => {
    setValidationError("");
    if (!fileName) {
      setValidationError("⚠️ Candidate PDF Resume is required. Please upload a PDF resume file.");
      return;
    }
    if (!appliedRole || !appliedRole.trim()) {
      setValidationError("⚠️ Target Job Title is required. Please enter a job title.");
      return;
    }
    if (!jobDescription || !jobDescription.trim()) {
      setValidationError("⚠️ Job Description Requirements are required. Please paste job requirements.");
      return;
    }
    startInterview();
  };

  return (
    <div className="setup-page-wrapper">
      <div className="setup-card-container" style={{ padding: "1.75rem 2.25rem", position: "relative" }}>
        
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

        {/* Global Error Alert */}
        {(error || validationError) && (
          <div className="alert-box alert-error-style" style={{ marginTop: "1rem", padding: "0.7rem 1rem", fontSize: "0.825rem", display: "flex", alignItems: "center", gap: "0.5rem", borderRadius: "12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontWeight: "600" }}>
            <AlertCircle size={16} style={{ color: "#dc2626", shrink: 0 }} />
            <span>{validationError || error}</span>
          </div>
        )}

        <div style={{ marginTop: "1.15rem" }}>
          {/* Upload PDF Resume Field (REQUIRED) */}
          <div className="setup-field-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label className="setup-field-label" style={{ fontWeight: "700" }}>
                Upload Candidate PDF Resume <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <span style={{ fontSize: "0.7rem", color: fileName ? "#059669" : "#dc2626", fontWeight: "700" }}>
                {fileName ? "Attached" : "Required"}
              </span>
            </div>
            
            <input 
              ref={fileInputRef}
              type="file" 
              accept="application/pdf" 
              onChange={onFileSelect} 
              disabled={isStarting}
              style={{ display: "none" }}
            />

            <div 
              onClick={() => fileInputRef.current?.click()}
              className={`upload-drop-zone ${fileName ? "has-file" : ""}`}
              style={{ 
                padding: "0.85rem 1.25rem", 
                flexDirection: "row", 
                justifyContent: "flex-start", 
                gap: "1rem",
                border: !fileName && validationError ? "1.5px dashed #ef4444" : undefined
              }}
            >
              {fileName ? (
                <>
                  <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#d1fae5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669", shrink: 0 }}>
                    <CheckCircle2 size={22} />
                  </div>
                  <div style={{ textAlign: "left", flex: 1, overflow: "hidden" }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: "700", color: "#0f172a", display: "flex", alignItems: "center", gap: "0.4rem", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <FileText size={16} style={{ color: "#059669" }} /> {fileName}
                    </p>
                    <p style={{ fontSize: "0.7rem", color: "#047857", fontWeight: "600", margin: 0 }}>PDF Attached — Click to change file</p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", color: "#4f46e5", shrink: 0 }}>
                    <UploadCloud size={22} />
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <p style={{ fontSize: "0.875rem", fontWeight: "700", color: "#0f172a", margin: 0 }}>Upload PDF Resume</p>
                    <p style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: "500", margin: 0 }}>Click or drag & drop candidate PDF file (Required)</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Form Fields Section */}
          <div className="setup-form-grid" style={{ marginTop: "1rem", paddingTop: "0.5rem", gap: "0.85rem" }}>
            {/* Target Job Title & Interview Language */}
            <div className="form-row-dual">
              <div className="setup-field-group">
                <label className="setup-field-label" style={{ fontWeight: "700" }}>
                  <Briefcase size={14} style={{ color: "#94a3b8" }} /> Target Job Title <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input 
                  type="text" 
                  value={appliedRole} 
                  onChange={(e) => {
                    setAppliedRole(e.target.value);
                    if (validationError) setValidationError("");
                  }} 
                  placeholder="e.g. Senior Frontend Engineer"
                  className="setup-input-control" 
                  style={{ padding: "0.65rem 0.9rem", border: !appliedRole.trim() && validationError ? "1px solid #ef4444" : undefined }}
                />
              </div>

              <div className="setup-field-group">
                <label className="setup-field-label" style={{ fontWeight: "700" }}>
                  <Globe size={14} style={{ color: "#94a3b8" }} /> Interview Language <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <select
                  value={interviewLanguage}
                  onChange={(e) => setInterviewLanguage(e.target.value)}
                  className="setup-input-control"
                  style={{ cursor: "pointer", padding: "0.65rem 0.9rem" }}
                >
                  {INTERVIEW_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Job Description Requirements */}
            <div className="setup-field-group">
              <label className="setup-field-label" style={{ fontWeight: "700" }}>
                <AlignLeft size={14} style={{ color: "#94a3b8" }} /> Job Description Requirements <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <textarea 
                rows={2} 
                placeholder="Paste role requirements..." 
                value={jobDescription} 
                onChange={(e) => {
                  setJobDescription(e.target.value);
                  if (validationError) setValidationError("");
                }} 
                className="setup-input-control"
                style={{ resize: "vertical", minHeight: "65px", padding: "0.65rem 0.9rem", border: !jobDescription.trim() && validationError ? "1px solid #ef4444" : undefined }}
              />
            </div>
          </div>

          {/* DEDICATED ACTION BUTTON FOOTER */}
          <div className="setup-action-footer" style={{ marginTop: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button 
              onClick={handleLaunchSession} 
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

            {/* Interview History Button */}
            <button
              type="button"
              onClick={onOpenHistory}
              className="repeat-btn-secondary"
              style={{ width: "100%", justifyContent: "center", padding: "0.75rem", fontSize: "0.85rem", fontWeight: "700", border: "1px solid #cbd5e1" }}
            >
              <History size={16} style={{ color: "#4f46e5" }} />
              <span>Interview Session History ({historyList.length})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
