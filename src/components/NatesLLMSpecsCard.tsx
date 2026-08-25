import React from 'react';
import { AppListing } from '../data/mockData';

interface NatesLLMSpecsCardProps {
  app: AppListing;
}

export const NatesLLMSpecsCard: React.FC<NatesLLMSpecsCardProps> = ({ app }) => {
  return (
    <div className="bg-white border-2 border-gray-800 p-3 text-xs font-tahoma">
      <div className="flex items-center justify-between border-b pb-1.5 mb-2">
        <span className="font-bold text-w95-blue text-sm">📊 Nate's LLM Specs (Dyno Measurement)</span>
        <span className="bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded border border-green-400">
          Score: {app.moddabilityScore}/100
        </span>
      </div>

      <table className="w-full border-collapse">
        <tbody>
          <tr className="border-b border-gray-200">
            <td className="py-1 text-gray-600 font-medium">LLM Moddability Score</td>
            <td className="py-1 font-bold text-right">{app.moddabilityScore} / 100 (Claude/Codex Verified)</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1 text-gray-600 font-medium">AST Branch Cleanliness</td>
            <td className="py-1 font-bold text-right text-green-700">{app.mergeCleanliness}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="py-1 text-gray-600 font-medium">Persistence Layer</td>
            <td className="py-1 font-bold text-right">{app.storage}</td>
          </tr>
          <tr>
            <td className="py-1 text-gray-600 font-medium">Active Downstream Forks</td>
            <td className="py-1 font-bold text-right text-w95-blue">{app.forks} branches</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
