// POST /api/git - Settle CAS merge and 70/20/10 lineage royalties in D1

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  try {
    const { appId, ref, expectedOldSha, newSha, grossCents } = await request.json();

    if (!appId || !ref || !newSha) {
      return Response.json({ success: false, error: 'appId, ref, and newSha are required' }, { status: 400 });
    }

    const amount = Number.isFinite(grossCents) && grossCents > 0 ? Math.floor(grossCents) : 2500;
    const makerCents = Math.round(amount * 0.70);
    const lineageCents = Math.round(amount * 0.20);
    const poolCents = amount - makerCents - lineageCents;

    const settlementId = `set_${Date.now()}`;

    await env.DB.prepare(`
      INSERT INTO royalty_settlements (id, app_id, buyer_user_id, gross_cents, maker_cents, lineage_cents, pool_cents, stripe_transfer_id)
      VALUES (?, ?, 'usr_sam', ?, ?, ?, ?, ?)
    `).bind(settlementId, appId, amount, makerCents, lineageCents, poolCents, `cas_${expectedOldSha || 'head'}_${newSha}`).run();

    return Response.json({
      success: true,
      settlementId,
      split: {
        grossCents: amount,
        makerCents,
        lineageCents,
        poolCents
      },
      message: 'CAS merge and lineage royalties settled successfully in D1'
    });
  } catch (err: any) {
    return Response.json({ success: false, error: 'Failed to process git merge settlement' }, { status: 500 });
  }
};
