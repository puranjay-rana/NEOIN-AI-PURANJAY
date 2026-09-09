import React from "react";
import { AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "../common/UIComponents";

export const QuestionBreakdown = ({ backendTranscript, expandedIndex, setExpandedIndex }) => {
  return (
    <div className="card space-y-4">
      <h3 className="section-title">Question Breakdown & Evaluation</h3>
      <div className="space-y-3">
        {backendTranscript.length === 0 && (
          <p className="text-sm text-slate-500">No completed answers were recorded for this session.</p>
        )}
        {backendTranscript.map((q, idx) => {
          const contentAvg = Math.round(
            (((q.eval_score ?? 0) + (q.relevance_score ?? 0) + (q.communication_score ?? 0)) / 3) * 10
          );
          return (
            <div key={idx} className="accordion-item">
              <div
                onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
                className="accordion-header flex-between"
              >
                <div className="flex-row-center gap-3">
                  <Badge variant="indigo">Q{idx + 1}</Badge>
                  <span className="text-sm font-semibold text-slate-900">{q.question}</span>
                  {q.multiple_faces_detected && (
                    <Badge variant="amber" className="flex-row-center gap-1">
                      <AlertTriangle size={12} /> Multiple faces
                    </Badge>
                  )}
                </div>
                <div className="flex-row-center gap-4">
                  <Badge variant="emerald">Score: {contentAvg}/100</Badge>
                  {expandedIndex === idx ? <ChevronUp size={16} className="text-slate-600" /> : <ChevronDown size={16} className="text-slate-600" />}
                </div>
              </div>
              {expandedIndex === idx && (
                <div className="accordion-body space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-600 font-medium">
                    <div>Technical: {q.eval_score ?? 0}/10</div>
                    <div>Relevance: {q.relevance_score ?? 0}/10</div>
                    <div>Communication: {q.communication_score ?? 0}/10</div>
                  </div>
                  {(q.visual_score > 0 || q.audio_delivery_score > 0) && (
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 font-medium">
                      {q.visual_score > 0 && <div>Visual delivery: {q.visual_score.toFixed(0)}/100</div>}
                      {q.audio_delivery_score > 0 && <div>Audio delivery: {q.audio_delivery_score.toFixed(0)}/100</div>}
                    </div>
                  )}
                  <div>
                    <strong className="text-slate-500 uppercase text-xs block mb-1">AI Feedback & Analysis:</strong>
                    <p className="text-slate-800">{q.feedback || "No feedback recorded for this answer."}</p>
                  </div>
                  <div>
                    <strong className="text-slate-500 uppercase text-xs block mb-1">Candidate Answer:</strong>
                    <p className="text-slate-800">{q.answer || "(no answer text captured)"}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
