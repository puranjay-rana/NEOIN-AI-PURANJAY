import React from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import { Compass } from "lucide-react";
import { Badge } from "../common/UIComponents";

export const CompetencyRadarChart = ({ scores = {} }) => {
  const radarData = [
    { subject: 'Technical', A: scores.technical ?? 0, fullMark: 100 },
    { subject: 'Communication', A: scores.communication ?? 0, fullMark: 100 },
    { subject: 'Relevance', A: scores.relevance ?? 0, fullMark: 100 },
    { subject: 'Confidence', A: scores.confidence ?? 0, fullMark: 100 },
    { subject: 'Delivery', A: scores.video ?? 0, fullMark: 100 },
  ];

  return (
    <div className="card space-y-4" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div className="flex-between">
        <div>
          <h3 className="section-title flex-row-center gap-2">
            <Compass size={20} className="text-indigo-600" /> Competency Radar Map
          </h3>
          <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Candidate strength profile across core vectors
          </p>
        </div>
        <Badge variant="indigo">5-Vector Map</Badge>
      </div>

      <div style={{ width: "100%", height: "270px" }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
            <PolarGrid stroke="#cbd5e1" strokeDasharray="3 3" />
            <PolarAngleAxis dataKey="subject" stroke="#334155" tick={{ fill: '#1e293b', fontSize: 11, fontWeight: 700 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#cbd5e1" fontSize={10} />
            <Radar name="Candidate" dataKey="A" stroke="#4f46e5" strokeWidth={2.5} fill="#6366f1" fillOpacity={0.35} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

