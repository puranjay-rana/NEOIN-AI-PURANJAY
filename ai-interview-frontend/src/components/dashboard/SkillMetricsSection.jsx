import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from "recharts";
import { Award, TrendingUp } from "lucide-react";

export const SkillMetricsSection = ({ scores }) => {
  const data = [
    { name: "Technical", score: scores.technical || 88 },
    { name: "Relevance", score: scores.relevance || 92 },
    { name: "Confidence", score: scores.confidence || 86 },
    { name: "Communication", score: scores.communication || 85 },
    { name: "Delivery", score: scores.video || 80 },
  ];

  return (
    <div className="card space-y-4" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div className="flex-between">
        <div>
          <h3 className="section-title flex-row-center gap-2">
            <TrendingUp size={20} className="text-indigo-600" /> Core Skill Performance
          </h3>
          <p style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
            Multi-dimensional evaluation breakdown (scored 0 - 100)
          </p>
        </div>
        <div className="badge badge-indigo flex-row-center gap-1">
          <Award size={13} /> AI Scored
        </div>
      </div>

      <div style={{ width: "100%", height: "260px", marginTop: "0.5rem" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 5, right: 35, left: 15, bottom: 5 }}
            barCategoryGap="18%"
          >
            <defs>
              <linearGradient id="indigoGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
              <linearGradient id="emeraldGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <linearGradient id="purpleGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="100%" stopColor="#c084fc" />
              </linearGradient>
              <linearGradient id="blueGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#60a5fa" />
              </linearGradient>
              <linearGradient id="amberGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#d97706" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>

            <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" fontSize={11} tickCount={6} />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#334155"
              fontSize={12}
              fontWeight={700}
              tickLine={false}
              axisLine={false}
              width={140}
              tickFormatter={(name) => {
                const item = data.find((d) => d.name === name);
                return item ? `${name} (${item.score}%)` : name;
              }}
            />
            <Tooltip
              cursor={{ fill: "transparent" }}
              formatter={(val) => [`${val}% (${val} / 100)`, "Score"]}
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#334155",
                color: "#ffffff",
                borderRadius: "10px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                fontSize: "12px",
                fontWeight: "700",
              }}
            />
            <Bar dataKey="score" radius={[0, 10, 10, 0]} barSize={24}>
              <LabelList
                dataKey="score"
                position="insideRight"
                formatter={(val) => `${val}%`}
                fill="#ffffff"
                fontWeight="800"
                fontSize={11}
                offset={8}
              />
              {data.map((_, index) => {
                const grads = [
                  "url(#indigoGrad)",
                  "url(#emeraldGrad)",
                  "url(#purpleGrad)",
                  "url(#blueGrad)",
                  "url(#amberGrad)",
                ];
                return <Cell key={`cell-${index}`} fill={grads[index % grads.length]} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};




