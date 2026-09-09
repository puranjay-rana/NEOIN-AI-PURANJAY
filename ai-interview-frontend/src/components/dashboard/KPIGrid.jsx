import React from "react";
import { KPICard } from "../common/UIComponents";

export const KPIGrid = ({ scores }) => {
  return (
    <div className="kpi-grid">
      <KPICard title="Overall Score" value={scores.overall} fillClass="bg-indigo" />
      <KPICard title="Relevance Score" value={scores.relevance} suffix="%" fillClass="bg-emerald" />
      <KPICard title="Communication Score" value={scores.communication} suffix="%" fillClass="bg-indigo" />
      <KPICard title="Technical Score" value={scores.technical} suffix="%" fillClass="bg-amber" />
      <KPICard 
        title="Integrity Score" 
        value={scores.integrity} 
        fillClass={scores.integrity >= 80 ? "bg-emerald" : "bg-amber"} 
      />
    </div>
  );
};
