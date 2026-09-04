

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
