import React from "react";

export const Alert = ({ type = "error", children }) => {
  if (!children) return null;
  const className = type === "warning" ? "alert alert-warning" : "alert alert-error";
  return <div className={className}>{children}</div>;
};

export const Badge = ({ variant = "indigo", className = "", children }) => {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>;
};

export const KPICard = ({ title, value, fillClass = "bg-indigo", suffix = "" }) => {
  const numericVal = typeof value === "number" ? value : parseFloat(value) || 0;
  return (
    <div className="card kpi-card">
      <div className="kpi-title">{title}</div>
      <div className="kpi-flex">
        <span className="kpi-value">{value}{suffix}</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, numericVal))}%` }}></div>
      </div>
    </div>
  );
};

export const SkillBar = ({ label, val, fillClass = "bg-indigo" }) => {
  return (
    <div className="skill-bar-wrapper">
      <div className="skill-bar-label">
        <span>{label}</span>
        <span>{val}/100</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${fillClass}`} style={{ width: `${Math.min(100, Math.max(0, val))}%` }}></div>
      </div>
    </div>
  );
};
