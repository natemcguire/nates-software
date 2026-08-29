import React, { useState } from 'react';
import {
  REAL_WORLD_DEV_TASKS,
  LEADERBOARD_PRESETS,
  calculateDynoScore,
  generateBadgeMarkdown,
  DynoRunResult,
} from '../lib/dynoDomain';
import {
  Gauge,
  Copy,
  Check,
  RefreshCw,
  Trophy,
  Terminal,
  Play,
  CheckCircle2
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';

export const DynoView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'race' | 'leaderboard' | 'export'>('race');
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [isRunningRace, setIsRunningRace] = useState(false);
  const [activeTaskIndex, setActiveTaskIndex] = useState<number>(-1);

  // Current active benchmark subject
  const [currentResult, setCurrentResult] = useState<DynoRunResult>(LEADERBOARD_PRESETS[0]);

  const handleRunStreetRace = () => {
    setIsRunningRace(true);
    setActiveTaskIndex(0);
    playClickSound();

    let step = 0;
    const interval = setInterval(() => {
      step++;
      setActiveTaskIndex(step);

      if (step >= REAL_WORLD_DEV_TASKS.length) {
        clearInterval(interval);
        setIsRunningRace(false);
        playSuccessChime();

        // Calculate dynamic randomized real-world result
        const completed = Math.floor(42 + Math.random() * 6);
        const firstAttempt = 0.68 + Math.random() * 0.15;
        const hiddenTests = 0.90 + Math.random() * 0.08;
        const medianSec = Math.floor(125 + Math.random() * 25);
        const interventions = Math.floor(1 + Math.random() * 3);

        const { score, grade } = calculateDynoScore({
          tasksCompleted: completed,
          totalTasks: 50,
          firstAttemptSuccessRate: firstAttempt,
          hiddenTestsPassedRate: hiddenTests,
          medianCompletionSeconds: medianSec,
          humanInterventions: interventions,
          safetyViolations: 0,
          unnecessaryFilesChanged: 0
        });

        setCurrentResult(prev => ({
          ...prev,
          tasksCompleted: completed,
          completionRate: Math.round((completed / 50) * 100),
          firstAttemptSuccessRate: Math.round(firstAttempt * 100),
          hiddenTestsPassedRate: Math.round(hiddenTests * 100),
          medianCompletionSeconds: medianSec,
          totalHumanInterventions: interventions,
          medianCostPerTaskUsd: Number((0.35 + Math.random() * 0.12).toFixed(2)),
          overallDynoScore: score,
          grade
        }));
      }
    }, 450);
  };

  const formatReportMarkdown = () => {
    const r = currentResult;
    const mins = Math.floor(r.medianCompletionSeconds / 60);
    const secs = r.medianCompletionSeconds % 60;

    return `${r.subject.model} + ${r.subject.agentHarness} + ${r.subject.environment.split('/')[0].trim()}
${r.subject.suiteVersion}

Tasks completed:       ${r.tasksCompleted}/${r.totalTasks} (${r.completionRate}%)
Median completion:     ${mins}m ${secs.toString().padStart(2, '0')}s
First-attempt success: ${r.firstAttemptSuccessRate}%
Hidden tests passed:   ${r.hiddenTestsPassedRate}%
Human interventions:   ${r.totalHumanInterventions}
Median cost/task:      $${r.medianCostPerTaskUsd.toFixed(2)}
Safety violations:     ${r.totalSafetyViolations}
Overall DYNO score:    ${r.overallDynoScore} / 1000 (${r.grade})`;
  };

  const copyReport = () => {
    navigator.clipboard.writeText(formatReportMarkdown());
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const copyBadge = () => {
    navigator.clipboard.writeText(generateBadgeMarkdown('nate', currentResult.overallDynoScore));
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-xs">
      {/* Top Header */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-yellow-400" />
          <div>
            <div className="font-bold text-sm text-yellow-300 font-mono">DYNO AI DEVELOPER BENCHMARK</div>
            <div className="text-[10px] text-gray-300 font-sans">
              Independent benchmark of Model + Harness + Tools on common dev tasks (never app runtime performance)
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex gap-1 font-sans">
          <button
            onClick={() => setActiveTab('race')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'race' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🏁 Dev Task Race
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'leaderboard' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'export' ? 'btn-w95-primary' : 'text-black'}`}
          >
            📋 Report &amp; Badge
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Truthfulness Notice Banner */}
        <div className="bg-blue-50 border border-blue-300 p-2.5 rounded text-[11px] text-blue-950 flex items-start gap-2">
          <Gauge size={15} className="text-blue-700 shrink-0 mt-0.5" />
          <div>
            <strong>DYNO Benchmark Definition:</strong> DYNO is an independent, real-world benchmark evaluating the capabilities of an AI model + agent harness + developer tools on 50 common software engineering workflows (bug fixing, schema changes, AST feature splicing, test repair). <em>It measures developer tool stack autonomy and accuracy—never user application runtime performance or server latency.</em>
          </div>
        </div>

        {activeTab === 'race' && (
          <div className="space-y-3">
            {/* Subject Configuration Banner */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-300 pb-2 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Benchmark Subject</span>
                    <span className="bg-yellow-100 text-yellow-900 border border-yellow-400 font-bold px-1.5 py-0.2 rounded text-[9px] font-mono">
                      SIMULATED RUN
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-blue-900 flex items-center gap-2 mt-0.5">
                    <span>{currentResult.subject.model}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-purple-700">{currentResult.subject.agentHarness}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-700">{currentResult.subject.environment.split('/')[0]}</span>
                  </div>
                </div>

                <button
                  onClick={handleRunStreetRace}
                  disabled={isRunningRace}
                  className="btn-w95 btn-w95-primary py-1.5 px-4 font-bold flex items-center gap-2 text-xs"
                >
                  {isRunningRace ? (
                    <>
                      <RefreshCw size={14} className="animate-spin text-yellow-300" />
                      <span>Simulating Dev Tasks...</span>
                    </>
                  ) : (
                    <>
                      <Play size={14} className="text-green-300" />
                      <span>Run 50-Task Dev Benchmark (Simulated)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Real-World Key Performance Indicators */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-center pt-1">
                <div className="bg-blue-50 border border-blue-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">DYNO DEV SCORE</div>
                  <div className="text-lg font-bold font-mono text-blue-950">{currentResult.overallDynoScore} <span className="text-xs font-normal text-gray-500">/ 1000</span></div>
                  <div className="text-[9px] font-bold text-green-700">{currentResult.grade}</div>
                </div>

                <div className="bg-green-50 border border-green-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">TASKS COMPLETED</div>
                  <div className="text-lg font-bold font-mono text-green-800">{currentResult.tasksCompleted} / {currentResult.totalTasks}</div>
                  <div className="text-[9px] text-gray-500">{currentResult.completionRate}% Completion</div>
                </div>

                <div className="bg-purple-50 border border-purple-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">HIDDEN TESTS</div>
                  <div className="text-lg font-bold font-mono text-purple-800">{currentResult.hiddenTestsPassedRate}%</div>
                  <div className="text-[9px] text-gray-500">Zero Leak Verification</div>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">FIRST ATTEMPT</div>
                  <div className="text-lg font-bold font-mono text-amber-800">{currentResult.firstAttemptSuccessRate}%</div>
                  <div className="text-[9px] text-gray-500">One-Shot Accuracy</div>
                </div>

                <div className="bg-gray-50 border border-gray-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">MEDIAN SPEED</div>
                  <div className="text-lg font-bold font-mono text-gray-800">
                    {Math.floor(currentResult.medianCompletionSeconds / 60)}m {currentResult.medianCompletionSeconds % 60}s
                  </div>
                  <div className="text-[9px] text-gray-500">{currentResult.medianToolCallsPerTask} Tools / Task</div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">MEDIAN COST</div>
                  <div className="text-lg font-bold font-mono text-emerald-800">${currentResult.medianCostPerTaskUsd.toFixed(2)}</div>
                  <div className="text-[9px] text-gray-500">Per Successful Fix</div>
                </div>

                <div className="bg-red-50 border border-red-200 p-2 rounded">
                  <div className="text-[10px] text-gray-600 font-bold">SAFETY VIOLATIONS</div>
                  <div className="text-lg font-bold font-mono text-red-800">{currentResult.totalSafetyViolations}</div>
                  <div className="text-[9px] text-gray-500">{currentResult.totalHumanInterventions} Interventions</div>
                </div>
              </div>
            </div>

            {/* 10 Real-World Workflow Task Execution Matrix */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                  <Terminal size={14} className="text-blue-700" />
                  10 Core Real-World Engineering Workflows Under Test
                </span>
                <span className="text-gray-500 text-[11px] font-mono">DYNO Dev Suite v2026.1</span>
              </div>

              <div className="space-y-1.5">
                {REAL_WORLD_DEV_TASKS.map((task, idx) => {
                  const isActive = isRunningRace && activeTaskIndex === idx;
                  const isDone = activeTaskIndex > idx;

                  return (
                    <div
                      key={task.id}
                      className={`border p-2 rounded transition-colors flex items-center justify-between gap-3 ${
                        isActive
                          ? 'bg-yellow-50 border-yellow-400 ring-1 ring-yellow-400'
                          : isDone
                          ? 'bg-green-50/50 border-green-200'
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="font-mono text-gray-400 text-[10px] font-bold w-5">
                          {(idx + 1).toString().padStart(2, '0')}
                        </span>
                        <div>
                          <div className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
                            <span>{task.name}</span>
                            <span className="bg-gray-200 text-gray-700 px-1.5 py-0.2 rounded text-[9px] font-mono">
                              {task.category}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 truncate">{task.description}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 font-mono text-[11px] shrink-0">
                        <span className="text-gray-500 text-[10px] hidden sm:inline">
                          {task.hiddenTestCount} hidden tests
                        </span>

                        {isActive ? (
                          <span className="text-yellow-700 font-bold flex items-center gap-1">
                            <RefreshCw size={12} className="animate-spin" /> Running
                          </span>
                        ) : isDone ? (
                          <span className="text-green-700 font-bold flex items-center gap-1">
                            <CheckCircle2 size={12} /> 100% Passed
                          </span>
                        ) : (
                          <span className="text-gray-400">Queued</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'leaderboard' && (
          <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-3">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                    <Trophy size={16} className="text-yellow-500" />
                    DYNO Real-World AI Developer Leaderboard
                  </h3>
                  <span className="bg-amber-100 text-amber-900 border border-amber-400 font-bold px-1.5 py-0.2 rounded text-[9px] font-mono">
                    PRESET DEMO DATA
                  </span>
                </div>
                <p className="text-[11px] text-gray-600">
                  Ranking autonomous agent configurations (Model + Harness + Tools) on 50 real-world engineering task completions.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead>
                  <tr className="bg-[#000080] text-white font-mono text-[11px]">
                    <th className="p-2">Rank</th>
                    <th className="p-2">Model &amp; Agent Harness</th>
                    <th className="p-2">Environment</th>
                    <th className="p-2 text-center">Tasks</th>
                    <th className="p-2 text-center">First Attempt</th>
                    <th className="p-2 text-center">Hidden Tests</th>
                    <th className="p-2 text-center">Median Time</th>
                    <th className="p-2 text-center">Cost/Task</th>
                    <th className="p-2 text-center">DYNO Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {LEADERBOARD_PRESETS.map((entry, idx) => (
                    <tr key={entry.id} className="hover:bg-blue-50/50 font-mono text-[11px]">
                      <td className="p-2 font-bold text-blue-900">#{idx + 1}</td>
                      <td className="p-2 font-bold text-gray-900 font-sans">
                        <div>{entry.subject.model}</div>
                        <div className="text-[10px] text-purple-700 font-mono font-normal">
                          {entry.subject.agentHarness}
                        </div>
                      </td>
                      <td className="p-2 text-gray-600 text-[10px]">{entry.subject.environment}</td>
                      <td className="p-2 text-center font-bold text-green-800">
                        {entry.tasksCompleted}/{entry.totalTasks} ({entry.completionRate}%)
                      </td>
                      <td className="p-2 text-center text-amber-800">{entry.firstAttemptSuccessRate}%</td>
                      <td className="p-2 text-center text-purple-800">{entry.hiddenTestsPassedRate}%</td>
                      <td className="p-2 text-center text-gray-700">
                        {Math.floor(entry.medianCompletionSeconds / 60)}m {entry.medianCompletionSeconds % 60}s
                      </td>
                      <td className="p-2 text-center text-emerald-800">${entry.medianCostPerTaskUsd.toFixed(2)}</td>
                      <td className="p-2 text-center font-bold text-blue-900 bg-blue-50/80">
                        {entry.overallDynoScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'export' && (
          <div className="space-y-3">
            {/* Markdown Report Card */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs uppercase tracking-wide text-gray-800">
                    Credible Benchmark Report Output
                  </span>
                  <span className="bg-purple-100 text-purple-900 border border-purple-400 font-bold px-1.5 py-0.2 rounded text-[9px] font-mono">
                    SIMULATED EXPORT
                  </span>
                </div>
                <button
                  onClick={copyReport}
                  className="btn-w95 py-1 px-3 font-bold flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-white"
                >
                  {copiedReport ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  <span>{copiedReport ? 'Copied Markdown!' : 'Copy Report Markdown'}</span>
                </button>
              </div>

              <pre className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed border border-gray-700">
                {formatReportMarkdown()}
              </pre>
            </div>

            {/* Dynamic SVG Badge */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800">
                  GitHub README Dynamic Badge
                </span>
                <button
                  onClick={copyBadge}
                  className="btn-w95 py-1 px-3 font-bold flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-white"
                >
                  {copiedBadge ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  <span>{copiedBadge ? 'Copied Badge Code!' : 'Copy Badge Markdown'}</span>
                </button>
              </div>

              <div className="p-3 bg-gray-100 rounded border border-gray-300 flex items-center gap-3">
                <div className="bg-[#000080] text-white px-3 py-1 rounded font-mono text-xs font-bold flex items-center gap-2 shadow">
                  <Gauge size={14} className="text-yellow-400" />
                  <span>DYNO Dev Benchmark: {currentResult.overallDynoScore} / 1000</span>
                </div>
                <span className="text-xs text-gray-600 font-mono">
                  Markdown: `[![DYNO AI Developer Benchmark](...)]`
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
