import React from 'react';

export interface RightsCardProps {
  forkingEnabled?: boolean;
  resaleEnabled?: boolean;
  upstreamRoyaltyBps?: number;
  className?: string;
}

export const RightsCard: React.FC<RightsCardProps> = ({
  forkingEnabled = true,
  resaleEnabled = true,
  upstreamRoyaltyBps = 0,
  className = ''
}) => {
  const sourceIncluded = forkingEnabled;
  const canResell = forkingEnabled && resaleEnabled;
  const royaltyPercent = Math.max(0, upstreamRoyaltyBps) / 100;
  const rows = [
    ['Use forever', 'yes'],
    ['Source included', sourceIncluded ? 'yes' : 'no, source is private'],
    ['Modify privately', sourceIncluded ? 'yes' : 'no'],
    ['Resell your version', canResell ? 'yes' : 'no'],
    ['Upstream royalty owed', `${royaltyPercent.toFixed(2)}%`]
  ];

  return (
    <section className={`win95-field bg-white border border-gray-600 text-[11px] ${className}`} aria-label="Listing rights">
      <div className="bg-[#000080] text-white font-bold px-2 py-1 border-b border-black flex items-center justify-between">
        <span>RIGHTS.CARD</span>
        <span className="font-mono text-[9px]">ONE-TIME LICENSE</span>
      </div>
      <div className="p-2">
        <dl className="space-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[1fr_auto] gap-3 border-b border-dotted border-gray-300 py-0.5 last:border-b-0">
              <dt className="text-gray-700">{label}</dt>
              <dd className={`font-bold text-right ${value === 'no' || value.startsWith('no,') ? 'text-red-800' : 'text-green-800'}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 border border-[#808080] bg-[#ffffe1] p-1.5 leading-snug text-gray-800">
          <span className="font-bold">Hosting:</span>{' '}
          {sourceIncluded
            ? 'Best-effort free tier while it stays free; you own the source to self-host.'
            : 'Best-effort free tier while it stays free; source is private, so self-hosting source is not included.'}
        </div>
      </div>
    </section>
  );
};
