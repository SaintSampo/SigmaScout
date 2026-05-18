import React from 'react';

/**
 * PredictionBar — horizontal split bar showing red/blue win probabilities.
 * redProb: 0.0–1.0
 * compact: smaller font + tighter padding
 */
export default function PredictionBar({ redProb, blueProb, compact = false }) {
  const rPct = Math.round((redProb ?? 0.5) * 100);
  const bPct = 100 - rPct;

  return (
    <div className={`w-full ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
      {/* Labels */}
      <div className={`flex justify-between font-semibold ${compact ? 'text-xs' : 'text-sm'}`}>
        <span className="text-red-400">Red {rPct}%</span>
        <span className="text-blue-400">Blue {bPct}%</span>
      </div>

      {/* Bar */}
      <div className="relative h-3 rounded-full overflow-hidden flex">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${rPct}%`, background: 'linear-gradient(90deg, #7f1d1d, #dc2626)' }}
        />
        <div
          className="h-full flex-1 transition-all duration-500"
          style={{ background: 'linear-gradient(90deg, #1d4ed8, #2563eb)' }}
        />
        {/* Center tick */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-900/60" />
      </div>
    </div>
  );
}
