import React from "react";
import { Eye, Volume2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "../common/UIComponents";

export const AnalyticsSection = ({ videoAnalytics, voiceAnalytics, confidenceTimeline }) => {
  return (
    <div className="grid-2-cols">
      {/* Video Analytics */}
      <div className="card space-y-6">
        <div className="flex-between">
          <h3 className="section-title flex-row-center gap-2">
            <Eye size={20} className="text-indigo-600" /> Video & Behavioral Analytics
          </h3>
          <Badge variant="indigo">From recorded frames</Badge>
        </div>

        {videoAnalytics ? (
          <>
            <div className="grid-3-cols">
              <div className="analytics-box">
                <div className="analytics-label">Eye Contact</div>
                <div className="analytics-val">{videoAnalytics.eyeContact ?? "--"}%</div>
              </div>
              <div className="analytics-box">
                <div className="analytics-label">Posture / Engagement</div>
                <div className="analytics-val">{videoAnalytics.engagement ?? "--"}%</div>
              </div>
              <div className="analytics-box">
                <div className="analytics-label">Expression</div>
                <div className="analytics-val">{videoAnalytics.expression ?? "--"}%</div>
              </div>
            </div>

            <div>
              <div className="input-label mb-2">Confidence Progression Timeline</div>
              <div className="h-[140px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={confidenceTimeline}>
                    <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
                    <YAxis domain={[0, 100]} stroke="#64748b" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#cbd5e1', color: '#0f172a', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                    <Line type="monotone" dataKey="confidence" stroke="#4f46e5" strokeWidth={3} dot={{ fill: '#4f46e5' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">No video delivery data was recorded for this session.</p>
        )}
      </div>

      {/* Voice Analytics */}
      <div className="card space-y-6">
        <div className="flex-between">
          <h3 className="section-title flex-row-center gap-2">
            <Volume2 size={20} className="text-indigo-600" /> Voice & Speech Analytics
          </h3>
          <Badge variant="indigo">From recorded audio</Badge>
        </div>

        {voiceAnalytics ? (
          <div className="grid-3-cols">
            <div className="analytics-box">
              <div className="analytics-label">Filler Words</div>
              <div className="analytics-val text-amber-600">{voiceAnalytics.fillerWords ?? "--"}</div>
            </div>
            <div className="analytics-box">
              <div className="analytics-label">Clarity Score</div>
              <div className="analytics-val">{voiceAnalytics.clarity ?? "--"}%</div>
            </div>
            <div className="analytics-box">
              <div className="analytics-label">Pace</div>
              <div className="analytics-val">{voiceAnalytics.pace ?? "--"}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No audio delivery data was recorded for this session.</p>
        )}
      </div>
    </div>
  );
};
