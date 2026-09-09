import React from "react";

export const ExitModal = ({
  showExitModal,
  setShowExitModal,
  handleCompleteInterview,
}) => {
  if (!showExitModal) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-slate-900">End Interview Early?</h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Your performance report will be generated immediately based on the completed questions.
        </p>
        <div className="flex justify-end gap-2.5 pt-2">
          <button 
            onClick={() => setShowExitModal(false)} 
            className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs py-2 px-3.5 rounded-xl border border-slate-300 transition cursor-pointer"
          >
            Continue Assessment
          </button>
          <button 
            onClick={handleCompleteInterview} 
            className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs py-2 px-3.5 rounded-xl shadow-md transition cursor-pointer"
          >
            Finish & View Results
          </button>
        </div>
      </div>
    </div>
  );
};
