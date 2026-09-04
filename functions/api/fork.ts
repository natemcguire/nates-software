import { onRequestPost as gitPost } from './git';

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const rawBody = await request.clone().json().catch(() => ({}));
    const payload = {
      action: 'fork',
      ...rawBody
    };

    const gitRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(payload)
    });

    return gitPost({ request: gitRequest, env });
  } catch (err: any) {
    console.error('[FORK] error:', err?.message || err);
    return Response.json({ success: false, error: 'Fork request failed' }, { status: 500 });
  }
};
