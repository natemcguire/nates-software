// GET /api/pipeline - Query SLOPSHOP AI Feature Modification Pipeline Preflight Status
// POST /api/pipeline - Preflight & Validate Feature Package, Generating Unified Patches & Evidence

import { SlopshopPipelineEngine, FileModification } from '../../src/lib/slopshopPipeline';

export const onRequestGet = async () => {
  return Response.json({
    success: true,
    service: 'SLOPSHOP AI Feature Modification Pipeline',
    status: 'online',
    mode: 'preflight_and_planning_only',
    stages: [
      '1. Target Package & Relative Path Validation',
      '2. Collision Detection (Paths, Routes, Exports, Schemas)',
      '3. Reversible Forward & Inverse Unified Patch Generation',
      '4. Deterministic SHA-256 Evidence Digest Computation',
      '5. Local Worktree Execution Blueprint Generation (Host Required for Landing/Revert)'
    ],
    landingPolicy: 'Edge runtime cannot execute Git. CAS landing and rollback must be executed on local host machine with cryptographic evidence.'
  });
};

export const onRequestPost = async ({ request }: { request: Request; env?: any }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      appId,
      featureName,
      prompt,
      modifications,
      migrationSql,
      agentName,
      action
    } = body;

    // Reject land and revert actions truthfully because Cloudflare Edge cannot execute Git
    if (action === 'land' || action === 'revert') {
      return Response.json(
        {
          success: false,
          status: 'rejected_edge_runtime_unsupported',
          action,
          error: `Edge runtime cannot execute Git ${action} operations. In-browser and Cloudflare edge environments cannot invoke local shells or manipulate local git working trees. Execute ${action} operations locally on your host machine.`
        },
        { status: 400 }
      );
    }

    if (!appId || typeof appId !== 'string' || !featureName || typeof featureName !== 'string' || !prompt || typeof prompt !== 'string') {
      return Response.json(
        { success: false, error: 'appId, featureName, and prompt are required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(modifications) || modifications.length === 0) {
      return Response.json(
        { success: false, error: 'modifications must be a non-empty array with explicit file contents' },
        { status: 400 }
      );
    }
    const submittedMods = modifications as FileModification[];

    const engine = new SlopshopPipelineEngine(appId);

    const preflight = engine.preflightPipeline({
      appId,
      featureName,
      prompt,
      modifications: submittedMods,
      migrationSql,
      agentName
    });

    if (!preflight.success) {
      return Response.json(
        {
          success: false,
          status: preflight.status,
          error: preflight.message,
          validation: preflight.validation
        },
        { status: 400 }
      );
    }

    return Response.json({
      success: true,
      pipeline: 'SLOPSHOP AI Feature Modification Pipeline (Preflight)',
      status: preflight.status,
      appId: preflight.appId,
      featureName: preflight.featureName,
      validation: preflight.validation,
      diff: preflight.diff,
      inverseDiff: preflight.inverseDiff,
      evidenceDigest: preflight.evidenceDigest,
      message: preflight.message
    });
  } catch (err: any) {
    return Response.json(
      { success: false, error: 'Pipeline preflight failed: ' + (err.message || 'Unknown error') },
      { status: 500 }
    );
  }
};
