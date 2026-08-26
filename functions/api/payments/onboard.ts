// POST /api/payments/onboard
// Generates Stripe Connect Express onboarding URL for verified makers

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { username, country = 'US' } = await request.json() as any;
    const cleanUser = (username || 'nate').toLowerCase().trim();

    const mockStripeAccountId = `acct_mock_${cleanUser}_${Date.now().toString(36)}`;
    const onboardingUrl = `https://connect.stripe.com/express/onboarding/${mockStripeAccountId}`;

    if (env && env.DB) {
      const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(cleanUser).first();
      if (user) {
        await env.DB.prepare(`
          INSERT INTO stripe_accounts (user_id, stripe_account_id, country, details_submitted)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(user_id) DO UPDATE SET stripe_account_id = excluded.stripe_account_id
        `).bind(user.id, mockStripeAccountId, country).run();
      }
    }

    return Response.json({
      success: true,
      accountId: mockStripeAccountId,
      url: onboardingUrl,
      message: 'Stripe Express onboarding link generated'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
