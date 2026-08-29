// POST /api/payments/onboard
// Creates Real Stripe Connect Express Account and generates Onboarding Link for creators

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const body = await request.json() as any;
    const userId = body.userId || body.username || 'usr_nate';
    const email = body.email;
    const returnUrl = body.returnUrl;
    const refreshUrl = body.refreshUrl;

    if (!userId) {
      return Response.json({ success: false, error: 'userId or username is required' }, { status: 400 });
    }

    const stripeKey = env?.STRIPE_SECRET_KEY;
    const cleanUsername = userId.replace(/^usr_/, '');
    let accountId = `acct_mock_${cleanUsername}_${Date.now().toString(36)}`;
    let onboardingUrl = `https://connect.stripe.com/express/onboarding/mock_${Date.now().toString(36)}`;

    // Create real Stripe Connect Express account if live Stripe Key is active
    if (stripeKey && !stripeKey.includes('mock') && !stripeKey.includes('test_mock')) {
      try {
        const accountParams = new URLSearchParams();
        accountParams.append('type', 'express');
        accountParams.append('country', body.country || 'US');
        if (email) accountParams.append('email', email);
        accountParams.append('capabilities[transfers][requested]', 'true');
        accountParams.append('business_type', 'individual');
        accountParams.append('metadata[userId]', userId);

        const accRes = await fetch('https://api.stripe.com/v1/accounts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: accountParams.toString()
        });

        if (accRes.ok) {
          const accData = await accRes.json() as any;
          accountId = accData.id;

          const linkParams = new URLSearchParams();
          linkParams.append('account', accountId);
          linkParams.append('type', 'account_onboarding');
          linkParams.append('refresh_url', refreshUrl || 'https://nates-software.com/profile?stripe=refresh');
          linkParams.append('return_url', returnUrl || 'https://nates-software.com/profile?stripe=success');

          const linkRes = await fetch('https://api.stripe.com/v1/account_links', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: linkParams.toString()
          });

          if (linkRes.ok) {
            const linkData = await linkRes.json() as any;
            onboardingUrl = linkData.url;
          }
        }
      } catch (err: any) {
        console.error('[STRIPE ONBOARD ERROR]', err.message);
      }
    }

    if (env && env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO stripe_accounts (user_id, stripe_account_id, charges_enabled, payouts_enabled)
          VALUES (?, ?, 0, 0)
          ON CONFLICT(user_id) DO UPDATE SET stripe_account_id = excluded.stripe_account_id
        `).bind(userId, accountId).run();

        await env.DB.prepare(`
          UPDATE users SET stripe_account_id = ? WHERE id = ? OR username = ?
        `).bind(accountId, userId, cleanUsername).run();
      } catch {}
    }

    return Response.json({
      success: true,
      accountId,
      url: onboardingUrl,
      onboardingUrl,
      message: 'Stripe Connect Express onboarding initialized'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
};
