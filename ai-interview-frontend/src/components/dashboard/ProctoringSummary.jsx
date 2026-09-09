import React from "react";
import { ShieldCheck, Copy, ExternalLink, Eye, Users, AlertTriangle } from "lucide-react";

export const ProctoringSummary = ({ cheatStats = {} }) => {
  const stats = [
    { label: "Tab Switches", val: cheatStats.tabSwitches || 0, icon: ExternalLink },
    { label: "Copy Events", val: cheatStats.copyEvents || 0, icon: Copy },
    { label: "Paste Events", val: cheatStats.pasteEvents || 0, icon: Copy },
    { label: "Fullscreen Exits", val: cheatStats.fullscreenExits || 0, icon: Eye },
    { label: "Multiple Faces Flagged", val: cheatStats.multipleFaces || 0, icon: Users },
  ];

  const totalViolations = Object.values(cheatStats).reduce((a, b) => (Number(a) || 0) + (Number(b) || 0), 0);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="section-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ShieldCheck size={20} style={{ color: "#4f46e5" }} /> Automated Proctoring Summary
        </h3>
        <span className={totalViolations === 0 ? "badge badge-emerald" : "badge badge-amber"}>
          {totalViolations === 0 ? (
            <>
              <ShieldCheck size={13} /> All Proctoring Checks Passed
            </>
          ) : (
            <>
              <AlertTriangle size={13} /> {totalViolations} Security Alert(s) Flagged
            </>
          )}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem" }}>
        {stats.map((item, idx) => {
          const IconComp = item.icon;
          const isFlagged = item.val > 0;
          return (
            <div 
              key={idx} 
              style={{
                backgroundColor: isFlagged ? "#fffbeb" : "#f8fafc",
                border: `1px solid ${isFlagged ? "#fde68a" : "#e2e8f0"}`,
                borderRadius: "14px",
                padding: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyBetween: "space-between", justifyContent: "space-between", color: "#64748b", fontSize: "0.75rem", fontWeight: "700" }}>
                <span>{item.label}</span>
                <IconComp size={15} style={{ color: isFlagged ? "#b45309" : "#94a3b8" }} />
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: "800", color: isFlagged ? "#b45309" : "#0f172a" }}>
                {item.val}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

