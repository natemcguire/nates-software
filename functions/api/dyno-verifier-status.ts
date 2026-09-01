// Cloudflare Pages Function: GET /api/dyno-verifier-status
// Read-only capability signal for the DYNO independent-reproduction verifier.
//
// dyno-verifier.ts implements a real lease/claim/retry state machine, but it
// only accepts worker.* actions (worker.claim / worker.complete / worker.fail)
// when env.DYNO_VERIFIER_ENABLED === 'true'. There is currently no deployed
// worker process claiming jobs, so the flag is off in production. This
// endpoint exposes that reality directly so the UI never implies a run can
// become "verified" / "reproduced" when nothing is actually processing the
// verification queue. It intentionally does not require authentication and
// does not touch dyno_verifier_jobs — it is a static capability readout, not
// a job-status lookup.

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const onRequestGet = async ({ env }: { env: any }) => {
  const acceptingJobs = env?.DYNO_VERIFIER_ENABLED === 'true';

  return json({
    success: true,
    acceptingJobs,
    message: acceptingJobs
      ? 'Independent reproduction workers are commissioned and accepting jobs.'
      : 'No independent reproduction worker is currently running. Submitted runs remain self-reported (unverified) until a verifier is commissioned.'
  });
};
