import React, { useEffect, useState } from 'react';
import {
  NEUTRAL_DEV_FIXTURES,
  NON_SUBMITTABLE_SCHEMA_EXAMPLE,
  calculateDynoScore,
  generateBadgeMarkdown,
  DynoFixture
} from '../lib/dynoDomain';
import {
  Gauge,
  Copy,
  Check,
  RefreshCw,
  Trophy,
  Terminal,
  FileCode,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Upload,
  Search,
  Layers,
  ArrowRight,
  Code,
  Info
} from 'lucide-react';
import { playClickSound, playSuccessChime } from '../lib/soundEngine';
import { useAuth } from '../context/AuthContext';

export const DynoView: React.FC = () => {
  const { user, requireAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<'setup' | 'import' | 'leaderboard' | 'inspector' | 'export'>('setup');
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedBadge, setCopiedBadge] = useState(false);
  const [showSchemaExample, setShowSchemaExample] = useState(false);

  // Leaderboard data
  const [leaderboardRuns, setLeaderboardRuns] = useState<any[]>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | 'mine'>('all');
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardSuite, setLeaderboardSuite] = useState<any | null>(null);

  // Selected run for deep inspection / export
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState<number>(0);

  // Import Tab state
  const [importJsonText, setImportJsonText] = useState('');
  const [importValidation, setImportValidation] = useState<{
    valid: boolean;
    errors: string[];
    parsedPayload?: any;
    calculatedScore?: number;
    calculatedGrade?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitFeedback, setSubmitFeedback] = useState<{ success: boolean; message: string; runId?: string } | null>(null);

  // Setup tab state
  // DYNO does not ship pre-integrated model adapters — the form starts blank
  // so the product never implies a "supported" model/harness/command that
  // does not exist. The user configures their own subject.
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedHarness, setSelectedHarness] = useState('');
  const [agentCommand, setAgentCommand] = useState('');
  const [selectedRepetitions, setSelectedRepetitions] = useState<number>(2);
  const [selectedNetworkPolicy, setSelectedNetworkPolicy] = useState<'none' | 'local_only' | 'isolated'>('none');
  const [activeFixtureIndex, setActiveFixtureIndex] = useState<number>(0);

  // Verifier availability (Part 2 — honest verified-tier status)
  const [verifierStatus, setVerifierStatus] = useState<{ acceptingJobs: boolean; message: string } | null>(null);
  const [loadingVerifierStatus, setLoadingVerifierStatus] = useState(false);

  const fetchVerifierStatus = async () => {
    setLoadingVerifierStatus(true);
    try {
      const res = await fetch('/api/dyno-verifier-status');
      const data = await res.json();
      if (data && data.success) {
        setVerifierStatus({ acceptingJobs: !!data.acceptingJobs, message: data.message || '' });
      } else {
        setVerifierStatus({ acceptingJobs: false, message: 'Unable to determine verifier availability.' });
      }
    } catch {
      setVerifierStatus({ acceptingJobs: false, message: 'Unable to reach the verifier status endpoint.' });
    } finally {
      setLoadingVerifierStatus(false);
    }
  };

  useEffect(() => {
    fetchVerifierStatus();
  }, []);

  // Fetch canonical leaderboard on tab change or mount
  const fetchLeaderboard = async () => {
    setLoadingLeaderboard(true);
    setLeaderboardError(null);
    try {
      const res = await fetch('/api/dyno');
      const data = await res.json();
      if (data.success) {
        setLeaderboardRuns(data.leaderboard || []);
        setLeaderboardSuite(data.suite || null);
      } else {
        setLeaderboardError(data.error || 'Failed to query canonical leaderboard');
      }
    } catch (err: any) {
      setLeaderboardError(err.message || 'Network error querying leaderboard');
    } finally {
      setLoadingLeaderboard(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'leaderboard') {
      fetchLeaderboard();
    }
  }, [activeTab]);

  // Toggle Non-Submittable Schema Reference Example
  const handleToggleSchemaExample = () => {
    playClickSound();
    setShowSchemaExample(prev => !prev);
  };

  // Validate Imported JSON Bundle
  const handleValidateBundle = () => {
    playClickSound();
    setSubmitFeedback(null);

    const errors: string[] = [];
    let parsed: any = null;

    try {
      parsed = JSON.parse(importJsonText);
    } catch {
      setImportValidation({
        valid: false,
        errors: ['Invalid JSON: Unable to parse payload text.']
      });
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      setImportValidation({ valid: false, errors: ['Payload must be a valid JSON object.'] });
      return;
    }

    const { run, subject, environment, suite, attempts } = parsed;

    if (!run) errors.push('Missing top-level "run" record.');
    if (!subject) errors.push('Missing top-level "subject" record.');
    if (!environment) errors.push('Missing top-level "environment" record.');
    if (!suite) errors.push('Missing top-level "suite" record.');
    if (!Array.isArray(attempts) || attempts.length === 0) {
      errors.push('Missing or empty "attempts" array.');
    }

    if (run?.id === 'run_example_non_submittable_doc_only' || parsed.is_example === true) {
      errors.push('Cannot submit non-submittable schema reference example. Execute a real local benchmark via ./bin/slop dyno.');
    }

    const sha256Regex = /^[0-9a-f]{64}$/i;
    if (run) {
      if (run.status !== 'completed') {
        errors.push(`Run status must be "completed". Found: "${run.status}"`);
      }
      if (!run.runner_attestation_digest || !sha256Regex.test(run.runner_attestation_digest)) {
        errors.push('runner_attestation_digest must be a valid 64-character SHA-256 string.');
      }
      if (!run.raw_trace_sha256 || !sha256Regex.test(run.raw_trace_sha256)) {
        errors.push('raw_trace_sha256 must be a valid 64-character SHA-256 string.');
      }
    }

    let calculatedScore = 0;
    let calculatedGrade = 'Unscored';

    if (Array.isArray(attempts) && attempts.length > 0) {
      let passed = 0;
      let firstAttempt = 0;
      let hiddenPassed = 0;
      let hiddenTotal = 0;
      let safety = 0;
      let unnecessary = 0;
      let interventions = 0;
      const durations: number[] = [];

      attempts.forEach((a: any, idx: number) => {
        const att = a.attempt || a;
        if (!att.result_digest || !sha256Regex.test(att.result_digest)) {
          errors.push(`Attempt #${idx + 1} (${att.task_id || 'unknown'}) missing valid 64-char result_digest.`);
        }
        if (att.status === 'passed') passed++;
        if (att.first_attempt_success === 1) firstAttempt++;
        hiddenPassed += att.hidden_tests_passed || 0;
        hiddenTotal += att.hidden_tests_total || 0;
        safety += att.safety_violations || 0;
        unnecessary += att.unnecessary_files_changed || 0;
        interventions += att.human_interventions || 0;
        durations.push((att.duration_ms || 0) / 1000);
      });

      const totalAttempts = attempts.length;
      const firstAttemptRate = totalAttempts > 0 ? firstAttempt / totalAttempts : 0;
      const hiddenPassedRate = hiddenTotal > 0 ? hiddenPassed / hiddenTotal : 0;
      const medianSec = durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : 60;

      const scoreCalc = calculateDynoScore({
        tasksCompleted: passed,
        totalTasks: totalAttempts,
        firstAttemptSuccessRate: firstAttemptRate,
        hiddenTestsPassedRate: hiddenPassedRate,
        medianCompletionSeconds: medianSec,
        humanInterventions: interventions,
        safetyViolations: safety,
        unnecessaryFilesChanged: unnecessary
      });

      calculatedScore = scoreCalc.score;
      calculatedGrade = scoreCalc.grade;

      if (run && typeof run.overall_score === 'number') {
        const diff = Math.abs(run.overall_score - calculatedScore);
        if (diff > 1) {
          errors.push(`Score mismatch: Claimed score (${run.overall_score}) does not match deterministically computed score (${calculatedScore}).`);
        }
      }
    }

    const isValid = errors.length === 0;
    setImportValidation({
      valid: isValid,
      errors,
      parsedPayload: isValid ? parsed : undefined,
      calculatedScore,
      calculatedGrade
    });

    if (isValid) {
      setSelectedRun(parsed);
      playSuccessChime();
    }
  };

  // Submit Validated Bundle to /api/dyno
  const handleSubmitBundle = async () => {
    if (!importValidation?.valid || !importValidation.parsedPayload) return;

    requireAuth('submit a self-reported benchmark run', async () => {
      setIsSubmitting(true);
      setSubmitFeedback(null);
      playClickSound();

      try {
        const res = await fetch('/api/dyno', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(importValidation.parsedPayload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
          playSuccessChime();
          setSubmitFeedback({
            success: true,
            message: `Successfully ingested run "${data.runId}" into canonical DYNO database. Score: ${data.score} (${data.verificationStatus}).`,
            runId: data.runId
          });
          fetchLeaderboard();
        } else {
          setSubmitFeedback({
            success: false,
            message: data.error || 'Server rejected submission payload.'
          });
        }
      } catch (err: any) {
        setSubmitFeedback({
          success: false,
          message: err.message || 'Failed to connect to /api/dyno'
        });
      } finally {
        setIsSubmitting(false);
      }
    });
  };

  // Formatted Markdown report
  const formatReportMarkdown = () => {
    if (!selectedRun) {
      return '# DYNO LLM Dynamometer Report\n\nNo run selected. Import a Street measurement or select an official result.';
    }

    const r = selectedRun.run || selectedRun;
    const sub = selectedRun.subject || {
      model_id: 'Claude 3.7 Sonnet',
      agent_harness: 'Antigravity CLI',
      model_provider: 'anthropic'
    };
    const env = selectedRun.environment || {
      os_name: 'macOS',
      architecture: 'arm64',
      cpu_model: 'Apple Silicon'
    };
    const summary = selectedRun.summary || {};
    const attempts = selectedRun.attempts || [];

    const tasksCompleted = summary.tasksPassed ?? attempts.filter((a: any) => (a.attempt?.status || a.status) === 'passed').length;
    const totalTasks = summary.totalTasks ?? attempts.length;
    const score = r.overall_score ?? summary.dynoScore ?? 0;
    const verificationStatus = r.verification_status || 'unverified';

    return `# DYNO LLM Dynamometer Report
**Subject:** ${sub.model_id || sub.model} + ${sub.agent_harness}
**Environment:** ${env.os_name} (${env.architecture}) ${env.cpu_model || ''}
**Verification Status:** ${verificationStatus.toUpperCase()}
**Attestation Digest:** \`${r.runner_attestation_digest || 'none'}\`
**Raw Trace Digest:**   \`${r.raw_trace_sha256 || 'none'}\`

---

### Core Performance Metrics
- **Overall DYNO Score:**    **${score} / 1000** (${summary.grade || 'Standard'})
- **Tasks Completed:**       ${tasksCompleted} / ${totalTasks} (${summary.completionRate ?? Math.round((tasksCompleted / (totalTasks || 1)) * 100)}%)
- **First-Attempt Accuracy:** ${summary.firstAttemptSuccessRate ?? 0}%
- **Hidden Tests Passed:**   ${summary.hiddenTestsPassedRate ?? 0}%
- **Median Duration:**       ${Math.round((summary.medianDurationMs || 0) / 1000)}s
- **Safety Violations:**     ${summary.totalSafetyViolations ?? 0} (Strict Zero-Tolerance)
- **Human Interventions:**   ${summary.totalHumanInterventions ?? 0}
- **Unnecessary Changes:**   ${summary.totalUnnecessaryFilesChanged ?? 0}

---
*Evaluated deterministically via isolated local sandbox runner with SHA-256 attestation.*`;
  };

  const isSubjectConfigured = selectedModel.trim() !== '' && selectedHarness.trim() !== '' && agentCommand.trim() !== '';

  const getCliCommand = () => {
    if (!isSubjectConfigured) {
      return '# Enter your model, agent harness, and run command above to generate a CLI command.';
    }
    const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
    const reps = selectedRepetitions > 1 ? ` --repetitions=${selectedRepetitions}` : '';
    const pol = selectedNetworkPolicy !== 'none' ? ` --policy=${selectedNetworkPolicy}` : '';
    return `./bin/slop dyno --command=${shellQuote(agentCommand)} --model=${shellQuote(selectedModel)} --harness=${shellQuote(selectedHarness)}${reps}${pol}`;
  };

  const copyCommand = () => {
    if (!isSubjectConfigured) return;
    navigator.clipboard.writeText(getCliCommand());
    setCopiedCommand(true);
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const copyReport = () => {
    navigator.clipboard.writeText(formatReportMarkdown());
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const copyBadge = () => {
    const score = selectedRun?.run?.overall_score ?? selectedRun?.overall_score;
    const username = selectedRun?.run?.username ?? selectedRun?.username ?? user?.username;
    if (typeof score !== 'number' || !username) return;
    navigator.clipboard.writeText(generateBadgeMarkdown(username, score));
    setCopiedBadge(true);
    setTimeout(() => setCopiedBadge(false), 2000);
  };

  const activeFixture: DynoFixture = NEUTRAL_DEV_FIXTURES[activeFixtureIndex] || NEUTRAL_DEV_FIXTURES[0];

  return (
    <div className="flex flex-col h-full bg-[#ece9d8] font-tahoma text-xs">
      {/* Top Windows 95 Header */}
      <div className="bg-gradient-to-r from-gray-900 via-blue-950 to-gray-900 text-white p-2.5 flex items-center justify-between border-b-2 border-gray-700 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-yellow-400" />
          <div>
            <div className="font-bold text-sm text-yellow-300 font-mono">DYNO — LLM DYNAMOMETER</div>
            <div className="text-[10px] text-gray-300 font-sans">
              Model + Harness + Tools measured under real developer load
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        {/* Tab Controls */}
        <div className="flex gap-1 font-sans flex-wrap">
          <button
            onClick={() => { playClickSound(); setActiveTab('setup'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'setup' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🏁 Runner Setup &amp; CLI
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('import'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'import' ? 'btn-w95-primary' : 'text-black'}`}
          >
            📥 Import &amp; Ingest Run
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('leaderboard'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'leaderboard' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('inspector'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'inspector' ? 'btn-w95-primary' : 'text-black'}`}
          >
            🔍 Run Inspector
          </button>
          <button
            onClick={() => { playClickSound(); setActiveTab('export'); }}
            className={`btn-w95 text-xs py-1 px-3 ${activeTab === 'export' ? 'btn-w95-primary' : 'text-black'}`}
          >
            📋 Report &amp; Badge
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Host Execution Boundary Notice */}
        <div className="bg-blue-50 border border-blue-300 p-2.5 rounded text-[11px] text-blue-950 flex items-start gap-2">
          <ShieldCheck size={16} className="text-blue-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div>
              <strong>The LLM Dynamometer:</strong> DYNO measures Model + Harness + Tools against common developer work, completely unrelated to marketplace app runtimes.
            </div>
            <div className="text-[10px] text-blue-900">
              Public <strong>Street</strong> measurements run locally via <code>./bin/slop dyno</code> and remain self-reported after upload. Only Nate-run private evaluations can receive <strong>DYNO Certified</strong>; independent replay can mark a Street run <strong>Reproduced</strong>.
            </div>
          </div>
        </div>

        {/* Verifier Availability Notice — honest, live status, no fabricated "path to verified" */}
        {!loadingVerifierStatus && verifierStatus && (
          <div className={`border p-2.5 rounded text-[11px] flex items-start gap-2 ${
            verifierStatus.acceptingJobs
              ? 'bg-green-50 border-green-300 text-green-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}>
            <ShieldCheck size={16} className={`shrink-0 mt-0.5 ${verifierStatus.acceptingJobs ? 'text-green-700' : 'text-amber-700'}`} />
            <div>
              <strong>{verifierStatus.acceptingJobs ? 'Independent verification: online.' : 'Independent verification: offline.'}</strong>{' '}
              {verifierStatus.message}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1: RUNNER SETUP & CLI GUIDE */}
        {/* ========================================================================= */}
        {activeTab === 'setup' && (
          <div className="space-y-3">
            {/* Configuration Box */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-3">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                  <Terminal size={14} className="text-blue-700" />
                  Local Workstation Benchmark Configuration
                </span>
                <span className="text-gray-500 text-[10px] font-mono">DYNO Dev Suite v2026.2</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Benchmark Model</label>
                  <input
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    placeholder="e.g. claude-opus-4-8"
                    className="w-full border border-gray-400 p-1 rounded font-mono text-xs bg-gray-50"
                    aria-label="Benchmark model identifier"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Agent Harness</label>
                  <input
                    value={selectedHarness}
                    onChange={e => setSelectedHarness(e.target.value)}
                    placeholder="your agent harness"
                    className="w-full border border-gray-400 p-1 rounded font-mono text-xs bg-gray-50"
                    aria-label="Agent harness name"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Repetitions (Verification)</label>
                  <select
                    value={selectedRepetitions}
                    onChange={e => setSelectedRepetitions(Number(e.target.value))}
                    className="w-full border border-gray-400 p-1 rounded font-mono text-xs bg-gray-50"
                  >
                    <option value={1}>1 Street Pull (Fast)</option>
                    <option value={2}>2 Street Pulls (Variance Check)</option>
                    <option value={3}>3 Street Pulls (Confidence Band)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">Sandbox Network Policy</label>
                  <select
                    value={selectedNetworkPolicy}
                    onChange={e => setSelectedNetworkPolicy(e.target.value as any)}
                    className="w-full border border-gray-400 p-1 rounded font-mono text-xs bg-gray-50"
                  >
                    <option value="none">none (Strictly Isolated - Block all egress)</option>
                    <option value="local_only">local_only (Localhost mocks only)</option>
                    <option value="isolated">isolated (Ephemeral network)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">Agent Command</label>
                <input
                  value={agentCommand}
                  onChange={e => setAgentCommand(e.target.value)}
                  placeholder="your run command, e.g. my-agent -p &quot;$DYNO_TASK_PROMPT&quot;"
                  className="w-full border border-gray-400 p-1.5 rounded font-mono text-xs bg-gray-50"
                  aria-label="Agent command executed for each benchmark task"
                />
                <p className="mt-1 text-[10px] text-gray-600">
                  DYNO supplies <code>$DYNO_TASK_PROMPT</code> and runs this command from a temporary fixture directory with secrets removed from its environment. This is workspace confinement, not an OS security boundary; use your agent's sandbox or a disposable machine for untrusted models.
                </p>
              </div>

              {/* CLI Command Generator */}
              <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs border border-gray-700 relative">
                <div className="text-[10px] text-gray-400 mb-1"># Execute local benchmark via CLI runner:</div>
                <div className="select-all">
                  {getCliCommand()}
                </div>
                <button
                  onClick={copyCommand}
                  disabled={!isSubjectConfigured}
                  className="absolute top-2.5 right-2.5 btn-w95 text-[10px] py-0.5 px-2 bg-gray-800 text-gray-200 hover:bg-gray-700 border-gray-600 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {copiedCommand ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  <span>{copiedCommand ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Local Storage & Non-Submittable Schema Notice */}
              <div className="flex items-center justify-between pt-1 border-t border-gray-200 flex-wrap gap-2 text-[11px]">
                <div className="text-gray-600 flex items-center gap-1.5">
                  <Info size={14} className="text-blue-700 shrink-0" />
                  <span>Output saved to <code>~/.dyno/report.json</code>. Remains strictly local until submitted.</span>
                </div>
                <button
                  onClick={handleToggleSchemaExample}
                  className="btn-w95 text-[11px] py-0.5 px-2.5 bg-gray-100 flex items-center gap-1"
                >
                  <Code size={12} />
                  <span>{showSchemaExample ? 'Hide Schema Example' : 'View Non-Submittable Schema Example'}</span>
                </button>
              </div>

              {/* Schema Example Box */}
              {showSchemaExample && (
                <div className="p-2.5 bg-gray-900 text-gray-200 rounded font-mono text-[10px] space-y-1.5 border border-yellow-500/50">
                  <div className="flex items-center justify-between text-yellow-400 font-bold border-b border-gray-700 pb-1">
                    <span>[NON-SUBMITTABLE SCHEMA EXAMPLE — Reference Format Only]</span>
                    <span className="text-[9px] text-gray-400">Do not submit: rejected by server</span>
                  </div>
                  <pre className="max-h-56 overflow-auto text-green-300">
                    {JSON.stringify(NON_SUBMITTABLE_SCHEMA_EXAMPLE, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Neutral Dev Tasks Matrix */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                  <Layers size={14} className="text-purple-700" />
                  {NEUTRAL_DEV_FIXTURES.length} Canonical Neutral Developer Tasks Under Test
                </span>
                <span className="text-gray-500 text-[11px]">Click task to inspect fixture specs</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {/* Task List */}
                <div className="md:col-span-1 space-y-1 overflow-y-auto max-h-72 border p-1 rounded bg-gray-50">
                  {NEUTRAL_DEV_FIXTURES.map((task, idx) => (
                    <button
                      key={task.key}
                      onClick={() => { playClickSound(); setActiveFixtureIndex(idx); }}
                      className={`w-full text-left p-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                        activeFixtureIndex === idx
                          ? 'bg-blue-100 text-blue-900 font-bold border border-blue-300'
                          : 'hover:bg-gray-200 text-gray-800'
                      }`}
                    >
                      <div className="truncate">
                        <span className="font-mono text-gray-400 mr-1.5">{(idx + 1).toString().padStart(2, '0')}.</span>
                        <span>{task.title}</span>
                      </div>
                      <span className="bg-gray-200 text-gray-700 px-1 py-0.2 rounded text-[9px] font-mono shrink-0 ml-1">
                        {task.category}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Selected Task Details */}
                <div className="md:col-span-2 border p-3 rounded bg-white space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b pb-1">
                    <span className="font-bold text-sm text-gray-900">{activeFixture.title}</span>
                    <span className="bg-purple-100 text-purple-900 border border-purple-300 px-1.5 py-0.5 rounded text-[10px] font-mono">
                      Category: {activeFixture.category}
                    </span>
                  </div>

                  <div>
                    <div className="font-bold text-gray-700 text-[10px]">DESCRIPTION:</div>
                    <div className="text-gray-800">{activeFixture.description}</div>
                  </div>

                  <div>
                    <div className="font-bold text-gray-700 text-[10px]">AGENT PROMPT:</div>
                    <div className="bg-gray-100 p-2 rounded font-mono text-[11px] text-gray-900 border">
                      {activeFixture.prompt}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="font-bold text-gray-700">Time Limit:</span> {activeFixture.timeLimitSeconds}s
                    </div>
                    <div>
                      <span className="font-bold text-gray-700">Hidden Tests:</span> {activeFixture.hiddenTests.length} verification checks
                    </div>
                    <div>
                      <span className="font-bold text-gray-700">Target Files:</span> {activeFixture.expectedModifiedFiles.join(', ')}
                    </div>
                    <div>
                      <span className="font-bold text-gray-700">Graders:</span> {activeFixture.graders.map(g => g.key).join(', ')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: IMPORT & VALIDATE EXECUTION BUNDLE */}
        {/* ========================================================================= */}
        {activeTab === 'import' && (
          <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-3">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2 flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                  <Upload size={16} className="text-blue-700" />
                  Import Local Benchmark Execution Bundle
                </h3>
                <p className="text-[11px] text-gray-600">
                  Paste the JSON report generated by <code>./bin/slop dyno</code> (saved at <code>~/.dyno/report.json</code>). Submissions require sign-in and are recorded as <strong>Unverified (Self-Reported)</strong>.
                </p>
              </div>
              <button
                onClick={handleToggleSchemaExample}
                className="btn-w95 text-xs py-1 px-3 bg-gray-100 text-gray-800 hover:bg-white border-gray-400 flex items-center gap-1"
              >
                <Code size={13} />
                <span>{showSchemaExample ? 'Hide Schema Example' : '📖 View Schema Format'}</span>
              </button>
            </div>

            {/* Schema Example Box */}
            {showSchemaExample && (
              <div className="p-2.5 bg-gray-900 text-gray-200 rounded font-mono text-[10px] space-y-1 border border-yellow-500/50">
                <div className="flex items-center justify-between text-yellow-400 font-bold border-b border-gray-700 pb-1">
                  <span>[NON-SUBMITTABLE SCHEMA EXAMPLE — Documentation Reference Only]</span>
                  <span className="text-[9px] text-gray-400">Do not submit: rejected by server</span>
                </div>
                <pre className="max-h-48 overflow-auto text-green-300">
                  {JSON.stringify(NON_SUBMITTABLE_SCHEMA_EXAMPLE, null, 2)}
                </pre>
              </div>
            )}

            {/* Textarea for JSON payload */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-gray-700">
                Run Execution JSON Payload (`DynoRunExecutionResult` from `~/.dyno/report.json`):
              </label>
              <textarea
                value={importJsonText}
                onChange={e => { setImportJsonText(e.target.value); setImportValidation(null); setSubmitFeedback(null); }}
                placeholder="Paste contents of ~/.dyno/report.json here..."
                rows={10}
                className="w-full border border-gray-400 p-2 rounded font-mono text-[11px] bg-gray-50 focus:bg-white"
              />
            </div>

            {/* Validation & Ingest Actions */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <button
                onClick={handleValidateBundle}
                disabled={!importJsonText.trim()}
                className="btn-w95 btn-w95-primary py-1.5 px-4 font-bold flex items-center gap-1.5 text-xs"
              >
                <CheckCircle2 size={14} />
                <span>Validate Local Bundle</span>
              </button>

              {importValidation?.valid && (
                <button
                  onClick={handleSubmitBundle}
                  disabled={isSubmitting}
                  className="btn-w95 py-1.5 px-4 font-bold flex items-center gap-1.5 text-xs bg-green-100 text-green-900 border-green-500 hover:bg-green-200"
                >
                  {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                  <span>{isSubmitting ? 'Recording self-report...' : 'Submit Self-Reported Run'}</span>
                </button>
              )}
            </div>

            {/* Validation Outcome Report */}
            {importValidation && (
              <div className={`p-3 rounded border text-xs ${
                importValidation.valid ? 'bg-amber-50 border-amber-300 text-amber-950' : 'bg-red-50 border-red-300 text-red-950'
              }`}>
                {importValidation.valid ? (
                  <div className="space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <CheckCircle2 size={16} className="text-amber-700" />
                      Local Execution Bundle Format Valid (Unverified Client Evidence)
                    </div>
                    <p className="text-[11px] text-amber-800">
                      Bundle structure and deterministic digests are valid. Submitting will record this run under your account with <code>unverified</code> status. Client evidence is never self-promoted to verified.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px] pt-1 border-t border-amber-200">
                      <div><span className="text-gray-600">Deterministic Score:</span> <strong>{importValidation.calculatedScore} / 1000</strong></div>
                      <div><span className="text-gray-600">Grade:</span> <strong>{importValidation.calculatedGrade}</strong></div>
                      <div><span className="text-gray-600">Attestation SHA:</span> <span className="text-[10px] truncate block">{importValidation.parsedPayload?.run?.runner_attestation_digest?.substring(0, 16)}...</span></div>
                      <div><span className="text-gray-600">Verification Level:</span> <strong className="text-amber-800">UNVERIFIED (SELF-REPORTED)</strong></div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-red-800">
                      <XCircle size={16} />
                      Bundle Validation Failed ({importValidation.errors.length} errors)
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px] text-red-900">
                      {importValidation.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Submission Feedback */}
            {submitFeedback && (
              <div className={`p-3 rounded border text-xs ${
                submitFeedback.success ? 'bg-green-50 border-green-300 text-green-950' : 'bg-red-50 border-red-300 text-red-950'
              }`}>
                <div className="font-bold flex items-center justify-between">
                  <span>{submitFeedback.message}</span>
                  {submitFeedback.success && (
                    <button
                      onClick={() => { playClickSound(); setActiveTab('leaderboard'); }}
                      className="btn-w95 text-xs py-0.5 px-2 bg-white flex items-center gap-1 font-normal"
                    >
                      <span>View Leaderboard</span>
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: VERIFIED LEADERBOARD */}
        {/* ========================================================================= */}
        {activeTab === 'leaderboard' && (() => {
          const displayedRuns = leaderboardFilter === 'mine' && user?.username
            ? leaderboardRuns.filter(r => (r.username === user.username || r.owner === user.username))
            : leaderboardRuns;

          return (
          <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-3">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2 flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">
                  <Trophy size={16} className="text-yellow-500" />
                  Official DYNO Results
                </h3>
                <p className="text-[11px] text-gray-600">
                  Reproduced Street measurements and Nate-run Certified evaluations. Self-reported Street uploads remain outside ranked comparisons.
                </p>
                <p className="text-[10px] font-mono text-blue-800 mt-0.5">
                  {leaderboardSuite
                    ? `Comparison cohort: ${leaderboardSuite.name} ${leaderboardSuite.version} (${leaderboardSuite.status})`
                    : 'No active comparison suite is currently published.'}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { playClickSound(); setLeaderboardFilter('all'); }}
                    className={`btn-w95 text-xs py-1 px-2.5 ${leaderboardFilter === 'all' ? 'btn-w95-primary' : 'bg-gray-100 hover:bg-white'}`}
                  >
                    All Runs ({leaderboardRuns.length})
                  </button>
                  {user?.username && (
                    <button
                      onClick={() => { playClickSound(); setLeaderboardFilter('mine'); }}
                      className={`btn-w95 text-xs py-1 px-2.5 ${leaderboardFilter === 'mine' ? 'btn-w95-primary' : 'bg-gray-100 hover:bg-white'}`}
                    >
                      My Runs ({leaderboardRuns.filter(r => r.username === user.username || r.owner === user.username).length})
                    </button>
                  )}
                </div>

                <button
                  onClick={fetchLeaderboard}
                  disabled={loadingLeaderboard}
                  className="btn-w95 text-xs py-1 px-3 flex items-center gap-1.5 bg-gray-100 hover:bg-white"
                >
                  <RefreshCw size={13} className={loadingLeaderboard ? 'animate-spin' : ''} />
                  <span>{loadingLeaderboard ? 'Querying D1...' : 'Refresh Leaderboard'}</span>
                </button>
              </div>
            </div>

            {leaderboardError && (
              <div className="p-2.5 bg-red-50 border border-red-300 text-red-950 rounded text-xs">
                {leaderboardError}
              </div>
            )}

            {leaderboardRuns.length === 0 && !loadingLeaderboard ? (
              <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded space-y-2">
                <Gauge size={28} className="mx-auto text-gray-400" />
                <div className="font-bold text-gray-700 text-sm">No Reproducible Benchmark Runs Yet</div>
                <p className="text-[11px] text-gray-500 max-w-md mx-auto">
                  Run DYNO locally and submit a self-report. Self-reported uploads do not appear in ranked comparisons
                  {verifierStatus && !verifierStatus.acceptingJobs
                    ? ' and independent replay is not currently available (verification offline).'
                    : ' until independently reproduced.'}
                </p>
                <button
                  onClick={() => { playClickSound(); setActiveTab('import'); }}
                  className="btn-w95 btn-w95-primary text-xs py-1 px-4 mt-2 font-bold"
                >
                  Go to Import Tab
                </button>
              </div>
            ) : leaderboardFilter === 'mine' && displayedRuns.length === 0 ? (
              <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded space-y-2">
                <Gauge size={28} className="mx-auto text-gray-400" />
                <div className="font-bold text-gray-700 text-sm">No Runs Recorded For @{user?.username}</div>
                <p className="text-[11px] text-gray-500 max-w-md mx-auto">
                  Import a local benchmark execution bundle in the Import tab to submit and track your runs.
                </p>
                <button
                  onClick={() => { playClickSound(); setActiveTab('import'); }}
                  className="btn-w95 btn-w95-primary text-xs py-1 px-4 mt-2 font-bold"
                >
                  Go to Import Tab
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="bg-[#000080] text-white font-mono text-[11px]">
                      <th className="p-2">Rank</th>
                      <th className="p-2">Model &amp; Harness</th>
                      <th className="p-2">Owner</th>
                      <th className="p-2">Environment</th>
                      <th className="p-2 text-center">Tasks</th>
                      <th className="p-2 text-center">Repetitions</th>
                      <th className="p-2 text-center">Verification</th>
                      <th className="p-2 text-center">DYNO Score</th>
                      <th className="p-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {displayedRuns.map((run, idx) => (
                      <tr key={run.id} className="hover:bg-blue-50/50 font-mono text-[11px]">
                        <td className="p-2 font-bold text-blue-900">#{idx + 1}</td>
                        <td className="p-2 font-bold text-gray-900 font-sans">
                          <div>{run.model_id}</div>
                          <div className="text-[10px] text-purple-700 font-mono font-normal">
                            {run.agent_harness}
                          </div>
                        </td>
                        <td className="p-2 text-gray-700 text-[10px] font-mono">
                          {run.username === user?.username ? (
                            <span className="font-bold text-emerald-800">@{run.username} (you)</span>
                          ) : run.username ? (
                            <span>@{run.username}</span>
                          ) : (
                            <span className="text-gray-400">official</span>
                          )}
                        </td>
                        <td className="p-2 text-gray-600 text-[10px]">
                          {run.os_name} {run.architecture}
                        </td>
                        <td className="p-2 text-center font-bold text-green-800">
                          {run.passed_attempts ?? '-'}/{run.total_attempts ?? '-'}
                        </td>
                        <td className="p-2 text-center text-gray-700">{run.repetition}x</td>
                        <td className="p-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            run.verification_status === 'verified'
                              ? 'bg-green-100 text-green-900 border border-green-400'
                              : run.verification_status === 'reproducible'
                              ? 'bg-blue-100 text-blue-900 border border-blue-400'
                              : 'bg-yellow-100 text-yellow-900 border border-yellow-400'
                          }`}>
                            {run.verification_status}
                          </span>
                          <div className="mt-1 text-[9px] font-bold uppercase text-gray-600">
                            {run.evaluation_class || 'reproduced'}
                          </div>
                        </td>
                        <td className="p-2 text-center font-bold text-blue-900 bg-blue-50/80">
                          {run.overall_score}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => {
                              playClickSound();
                              setSelectedRun(run);
                              setActiveTab('inspector');
                            }}
                            className="btn-w95 text-[10px] py-0.5 px-2 bg-gray-100 hover:bg-white"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          );
        })()}

        {/* ========================================================================= */}
        {/* TAB 4: RUN INSPECTOR & CRYPTOGRAPHIC EVIDENCE */}
        {/* ========================================================================= */}
        {activeTab === 'inspector' && (
          <div className="space-y-3">
            {!selectedRun ? (
              <div className="bg-white border-2 border-gray-400 p-8 text-center shadow-inner rounded-sm space-y-2">
                <Search size={28} className="mx-auto text-gray-400" />
                <div className="font-bold text-gray-700 text-sm">No Run Selected for Inspection</div>
                <p className="text-[11px] text-gray-500 max-w-md mx-auto">
                  Select a run from the Leaderboard tab or import an execution bundle in the Import tab to inspect full task attempts, grader results, and cryptographic digests.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <button
                    onClick={() => { playClickSound(); setActiveTab('import'); }}
                    className="btn-w95 text-xs py-1 px-3"
                  >
                    Import Bundle
                  </button>
                  <button
                    onClick={() => { playClickSound(); setActiveTab('leaderboard'); }}
                    className="btn-w95 text-xs py-1 px-3"
                  >
                    View Leaderboard
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Run Metadata & Key KPI Summary */}
                <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2 flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">Inspecting Run</span>
                        <span className="font-mono text-xs font-bold text-blue-900">{selectedRun.run?.id || selectedRun.id}</span>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase font-mono ${
                          (selectedRun.run?.verification_status || selectedRun.verification_status) === 'reproducible'
                            ? 'bg-blue-100 text-blue-900 border border-blue-400'
                            : 'bg-yellow-100 text-yellow-900 border border-yellow-400'
                        }`}>
                          {selectedRun.run?.verification_status || selectedRun.verification_status || 'unverified'}
                        </span>
                      </div>
                      <div className="text-sm font-bold font-mono text-blue-950 mt-0.5">
                        <span>{selectedRun.subject?.model_id || selectedRun.subject?.model}</span>
                        <span className="text-gray-400 mx-1.5">·</span>
                        <span className="text-purple-700">{selectedRun.subject?.agent_harness}</span>
                        <span className="text-gray-400 mx-1.5">·</span>
                        <span className="text-gray-700">{selectedRun.environment?.os_name} {selectedRun.environment?.architecture}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => { playClickSound(); setActiveTab('export'); }}
                      className="btn-w95 text-xs py-1 px-3 bg-gray-100 hover:bg-white flex items-center gap-1 font-bold"
                    >
                      <Copy size={13} />
                      <span>Export Report &amp; Badge</span>
                    </button>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-center pt-1">
                    <div className="bg-blue-50 border border-blue-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">DYNO DEV SCORE</div>
                      <div className="text-lg font-bold font-mono text-blue-950">
                        {selectedRun.run?.overall_score ?? selectedRun.overall_score} <span className="text-xs font-normal text-gray-500">/ 1000</span>
                      </div>
                      <div className="text-[9px] font-bold text-green-700">{selectedRun.summary?.grade || 'Server-scored'}</div>
                    </div>

                    <div className="bg-green-50 border border-green-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">TASKS PASSED</div>
                      <div className="text-lg font-bold font-mono text-green-800">
                        {selectedRun.summary?.tasksPassed ?? (selectedRun.attempts?.filter((a: any) => (a.attempt?.status || a.status) === 'passed').length)} / {selectedRun.summary?.totalTasks ?? selectedRun.attempts?.length}
                      </div>
                      <div className="text-[9px] text-gray-500">{selectedRun.summary?.completionRate != null ? `${selectedRun.summary.completionRate}% Completion` : 'Open full run details'}</div>
                    </div>

                    <div className="bg-purple-50 border border-purple-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">HIDDEN TESTS</div>
                      <div className="text-lg font-bold font-mono text-purple-800">
                        {selectedRun.summary?.hiddenTestsPassedRate != null ? `${selectedRun.summary.hiddenTestsPassedRate}%` : '—'}
                      </div>
                      <div className="text-[9px] text-gray-500">Deterministic Checks</div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">FIRST ATTEMPT</div>
                      <div className="text-lg font-bold font-mono text-amber-800">
                        {selectedRun.summary?.firstAttemptSuccessRate != null ? `${selectedRun.summary.firstAttemptSuccessRate}%` : '—'}
                      </div>
                      <div className="text-[9px] text-gray-500">One-Shot Accuracy</div>
                    </div>

                    <div className="bg-gray-50 border border-gray-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">MEDIAN SPEED</div>
                      <div className="text-lg font-bold font-mono text-gray-800">
                        {selectedRun.summary?.medianDurationMs != null ? `${Math.round(selectedRun.summary.medianDurationMs / 1000)}s` : '—'}
                      </div>
                      <div className="text-[9px] text-gray-500">{selectedRun.summary?.medianToolCalls != null ? `${selectedRun.summary.medianToolCalls} Tools / Task` : 'Not in public aggregate'}</div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">TOTAL TOKENS</div>
                      <div className="text-lg font-bold font-mono text-emerald-800">
                        {selectedRun.summary?.totalTokens?.toLocaleString() ?? '—'}
                      </div>
                      <div className="text-[9px] text-gray-500">Input + Output</div>
                    </div>

                    <div className="bg-red-50 border border-red-200 p-2 rounded">
                      <div className="text-[10px] text-gray-600 font-bold">SAFETY VIOLATIONS</div>
                      <div className="text-lg font-bold font-mono text-red-800">
                        {selectedRun.summary?.totalSafetyViolations ?? 0}
                      </div>
                      <div className="text-[9px] text-gray-500">Strict Zero Penalty</div>
                    </div>
                  </div>
                </div>

                {/* Cryptographic Digests Box */}
                <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-2">
                  <span className="font-bold text-xs uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-green-700" />
                    Cryptographic Attestation &amp; Trace Evidence
                  </span>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2 bg-gray-50 border rounded">
                      <div className="text-[10px] text-gray-500 font-bold">RUNNER ATTESTATION SHA-256:</div>
                      <div className="text-gray-900 break-all select-all text-[11px]">
                        {selectedRun.run?.runner_attestation_digest || selectedRun.runner_attestation_digest || 'none'}
                      </div>
                    </div>

                    <div className="p-2 bg-gray-50 border rounded">
                      <div className="text-[10px] text-gray-500 font-bold">RAW TRACE SHA-256:</div>
                      <div className="text-gray-900 break-all select-all text-[11px]">
                        {selectedRun.run?.raw_trace_sha256 || selectedRun.raw_trace_sha256 || 'none'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Task Attempts Matrix */}
                <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-2">
                  <span className="font-bold text-xs uppercase tracking-wide text-gray-800 flex items-center gap-1.5">
                    <FileCode size={14} className="text-blue-700" />
                    Task Attempts Breakdown &amp; Grader Details
                  </span>

                  <div className="space-y-1.5">
                    {(selectedRun.attempts || []).map((item: any, idx: number) => {
                      const att = item.attempt || item;
                      const isPassed = att.status === 'passed';
                      const isExpanded = selectedAttemptIndex === idx;

                      return (
                        <div key={att.id || idx} className="border rounded overflow-hidden">
                          <button
                            onClick={() => { playClickSound(); setSelectedAttemptIndex(isExpanded ? -1 : idx); }}
                            className={`w-full p-2 text-left flex items-center justify-between text-xs transition-colors ${
                              isPassed ? 'bg-green-50/50 hover:bg-green-50' : 'bg-red-50/50 hover:bg-red-50'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-gray-400 font-bold w-5">{(idx + 1).toString().padStart(2, '0')}</span>
                              <span className="font-bold text-gray-900 font-mono">{att.task_id}</span>
                              <span className="bg-gray-200 text-gray-700 px-1 py-0.2 rounded text-[9px] font-mono">
                                Execution #{att.attempt_number}
                              </span>
                            </div>

                            <div className="flex items-center gap-3 font-mono text-[11px]">
                              <span>{Math.round((att.duration_ms || 0) / 1000)}s</span>
                              <span>{att.tool_calls || 0} tools</span>
                              <span className={`font-bold flex items-center gap-1 ${isPassed ? 'text-green-700' : 'text-red-700'}`}>
                                {isPassed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                                {att.status.toUpperCase()}
                              </span>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="p-3 bg-white border-t space-y-2 text-xs">
                              <div className="text-[10px] font-bold text-gray-700">GRADER OUTCOMES:</div>
                              <div className="space-y-1">
                                {(item.graderResults || item.grader_results || []).map((g: any, gIdx: number) => (
                                  <div key={gIdx} className="bg-gray-50 border p-2 rounded font-mono text-[11px] space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-gray-900">{g.grader_key}</span>
                                      <span className={g.passed === 1 || g.passed === true ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
                                        {g.passed === 1 || g.passed === true ? '[PASS]' : '[FAIL]'} Score: {g.score}/{g.max_score}
                                      </span>
                                    </div>
                                    <div className="text-gray-600 whitespace-pre-wrap text-[10px]">{g.detail}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: REPORT & DYNAMIC BADGE */}
        {/* ========================================================================= */}
        {activeTab === 'export' && (
          <div className="space-y-3">
            {/* Markdown Report Card */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-2">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800">
                  Credible Benchmark Markdown Report Output
                </span>
                <button
                  onClick={copyReport}
                  className="btn-w95 py-1 px-3 font-bold flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-white"
                >
                  {copiedReport ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  <span>{copiedReport ? 'Copied Markdown!' : 'Copy Report Markdown'}</span>
                </button>
              </div>

              <pre className="bg-gray-900 text-green-400 p-3 rounded font-mono text-xs overflow-x-auto leading-relaxed border border-gray-700 max-h-72">
                {formatReportMarkdown()}
              </pre>
            </div>

            {/* Dynamic SVG Badge */}
            <div className="bg-white border-2 border-gray-400 p-3 shadow-inner rounded-sm space-y-2">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-bold text-xs uppercase tracking-wide text-gray-800">
                  GitHub README Dynamic Badge Snippet
                </span>
                <button
                  onClick={copyBadge}
                  className="btn-w95 py-1 px-3 font-bold flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-white"
                >
                  {copiedBadge ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  <span>{copiedBadge ? 'Copied Badge Code!' : 'Copy Badge Markdown'}</span>
                </button>
              </div>

              <div className="p-3 bg-gray-100 rounded border border-gray-300 flex items-center gap-3 flex-wrap">
                <div className="bg-[#000080] text-white px-3 py-1.5 rounded font-mono text-xs font-bold flex items-center gap-2 shadow">
                  <Gauge size={14} className="text-yellow-400" />
                  <span>DYNO Dev Benchmark: {selectedRun?.run?.overall_score ?? selectedRun?.overall_score ?? 'UNSCORED'} / 1000</span>
                </div>
                {(() => {
                  const badgeUser = selectedRun?.run?.username ?? selectedRun?.username ?? user?.username;
                  const badgeScore = selectedRun?.run?.overall_score ?? selectedRun?.overall_score;
                  const badgeMarkdown = typeof badgeScore === 'number' && badgeUser
                    ? generateBadgeMarkdown(badgeUser, badgeScore)
                    : null;
                  return (
                    <span className="text-xs text-gray-600 font-mono select-all break-all">
                      {badgeMarkdown ? `Markdown: ${badgeMarkdown}` : 'Markdown: [![DYNO Real-World AI Benchmark](...)] (select a scored run)'}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
