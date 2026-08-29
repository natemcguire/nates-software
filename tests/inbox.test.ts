import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import * as inboxApi from '../functions/api/inbox';
import { AuthProvider } from '../src/context/AuthContext';
import { InboxView } from '../src/views/InboxView';
import { calculateFolderCounts, conversationForThread, filterThreadsByCategory, formatProposalStatus, InboxThread } from '../src/lib/inboxDomain';
import { createTestD1Database, TestD1Context } from './fixtures/d1Harness';

const authHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer valid_test_token' };
const ownMessage = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'usr_nate', sender_id: 'usr_sam', title: 'Message', preview: 'Preview',
  content: 'Body', unread: 1, message_kind: 'feedback', ...extra
});

describe('INBOX.EXE live-mode integrity', () => {
  let ctx: TestD1Context;
  beforeEach(async () => { ctx = await createTestD1Database({ foreignKeys: true }); });

  async function insertMessage(row: Record<string, unknown>) {
    await ctx.d1.prepare(`INSERT INTO inbox_messages
      (id,user_id,sender_id,title,preview,content,unread,message_kind,feature_ref,merge_attempt_id,is_merged,in_reply_to_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`).bind(
      row.id, row.user_id, row.sender_id ?? null, row.title, row.preview, row.content,
      row.unread ?? 1, row.message_kind ?? 'feedback', row.feature_ref ?? null,
      row.merge_attempt_id ?? null, row.is_merged ?? 0, row.in_reply_to_id ?? null, row.created_at ?? null
    ).run();
  }

  const get = (url = 'http://localhost/api/inbox', authenticated = true) => inboxApi.onRequestGet({
    request: new Request(url, authenticated ? { headers: authHeaders } : undefined), env: { DB: ctx.d1 }
  });
  const post = (body: unknown) => inboxApi.onRequestPost({
    request: new Request('http://localhost/api/inbox', { method: 'POST', headers: authHeaders, body: JSON.stringify(body) }),
    env: { DB: ctx.d1 }
  });

  it('computes folders from authoritative thread categories', () => {
    const threads = [
      { id: 'a', category: 'proposals', unread: true },
      { id: 'b', category: 'feedback', unread: false }
    ] as InboxThread[];
    expect(calculateFolderCounts(threads)).toEqual({ all: 2, proposals: 1, agent_logs: 0, royalties: 0, feedback: 1, unread: 1 });
    expect(filterThreadsByCategory(threads, 'proposals')).toEqual([threads[0]]);
  });

  it('builds a conversation only from persisted reply ancestry', () => {
    const threads = [
      { id: 'other', time: '2026-01-01T00:00:00Z' },
      { id: 'reply-2', inReplyToId: 'reply-1', time: '2026-01-01T00:03:00Z' },
      { id: 'root', time: '2026-01-01T00:01:00Z' },
      { id: 'reply-1', inReplyToId: 'root', time: '2026-01-01T00:02:00Z' }
    ] as InboxThread[];
    expect(conversationForThread(threads, 'reply-2').map(thread => thread.id)).toEqual(['root', 'reply-1', 'reply-2']);
  });

  it('distinguishes unbound, approved, and authoritatively landed proposals', () => {
    const base = { id: 'p', category: 'proposals', from: 'Sam', fromAvatar: '', subject: 'P', time: '', body: '', unread: false, featureRef: 'x' } as InboxThread;
    expect(formatProposalStatus(base).canApprove).toBe(false);
    expect(formatProposalStatus({ ...base, mergeAttemptId: 'a', mergeStatus: 'preview_ready' }).canApprove).toBe(true);
    expect(formatProposalStatus({ ...base, mergeAttemptId: 'a', mergeStatus: 'approved', approvalStatus: 'approved' }).badgeLabel).toContain('Awaiting');
    expect(formatProposalStatus({ ...base, mergeAttemptId: 'a', mergeStatus: 'landed', isMerged: true }).badgeLabel).toContain('Landed');
  });

  it('requires authentication and never honors username impersonation', async () => {
    expect((await get(undefined, false)).status).toBe(401);
    await insertMessage(ownMessage('nate'));
    await insertMessage({ ...ownMessage('sam'), user_id: 'usr_sam' });
    const response = await get('http://localhost/api/inbox?username=sam');
    const data: any = await response.json();
    expect(data.threads.map((thread: any) => thread.id)).toEqual(['nate']);
  });

  it('returns a truthful empty inbox and 503 without storage', async () => {
    expect((await (await get()).json() as any).threads).toEqual([]);
    const response = await inboxApi.onRequestGet({ request: new Request('http://localhost/api/inbox', { headers: authHeaders }), env: {} });
    expect(response.status).toBe(503);
  });

  it('uses persisted message_kind rather than guessing from message prose', async () => {
    await insertMessage(ownMessage('royalty-words', { title: 'Royalty proposal agent report', message_kind: 'feedback' }));
    const data: any = await (await get()).json();
    expect(data.threads[0].category).toBe('feedback');
  });

  it('scopes read mutations to the owning mailbox and is idempotent', async () => {
    await insertMessage(ownMessage('mine'));
    await insertMessage({ ...ownMessage('theirs'), user_id: 'usr_sam' });
    expect((await post({ action: 'mark_read', messageId: 'theirs' })).status).toBe(404);
    expect((await post({ action: 'mark_read', messageId: 'mine' })).status).toBe(200);
    expect((await post({ action: 'mark_read', messageId: 'mine' })).status).toBe(200);
    expect(await ctx.d1.prepare('SELECT unread FROM inbox_messages WHERE id=?').bind('mine').first('unread')).toBe(0);
  });

  it('replies only to the verified sender of an owned message', async () => {
    await insertMessage(ownMessage('parent', { title: 'Feature review' }));
    const response = await post({ action: 'reply', messageId: 'parent', text: 'Ship the next revision.' });
    expect(response.status).toBe(200);
    const data: any = await response.json();
    const reply: any = await ctx.d1.prepare('SELECT * FROM inbox_messages WHERE id=?').bind(data.messageId).first();
    expect(reply.user_id).toBe('usr_sam');
    expect(reply.sender_id).toBe('usr_nate');
    expect(reply.in_reply_to_id).toBe('parent');
    expect(reply.unread).toBe(1);
  });

  it('shows sent replies to their sender and allows continuing the real conversation', async () => {
    await insertMessage(ownMessage('parent', { title: 'Feature review' }));
    const first: any = await (await post({ action: 'reply', messageId: 'parent', text: 'Please revise this.' })).json();
    const data: any = await (await get()).json();
    const sent = data.threads.find((thread: any) => thread.id === first.messageId);
    expect(sent).toMatchObject({ direction: 'sent', from: 'Sam Altman (@sam)', inReplyToId: 'parent', unread: false });
    expect(first.thread).toMatchObject({
      id: first.messageId, direction: 'sent', from: 'Sam Altman (@sam)', body: 'Please revise this.',
      inReplyToId: 'parent', unread: false
    });

    const response = await post({ action: 'reply', messageId: first.messageId, text: 'One more detail.' });
    expect(response.status).toBe(200);
    const second: any = await response.json();
    expect(await ctx.d1.prepare('SELECT user_id FROM inbox_messages WHERE id=?').bind(second.messageId).first('user_id')).toBe('usr_sam');
  });

  it('paginates inbox and sent messages with a stable user-bound cursor', async () => {
    for (let index = 0; index < 4; index += 1) {
      await insertMessage(ownMessage(`page-${index}`, { created_at: '2026-01-01 00:00:00' }));
    }
    const first: any = await (await get('http://localhost/api/inbox?limit=2')).json();
    expect(first.threads.map((thread: any) => thread.id)).toEqual(['page-3', 'page-2']);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    const second: any = await (await get(`http://localhost/api/inbox?limit=2&cursor=${encodeURIComponent(first.page.nextCursor)}`)).json();
    expect(second.threads.map((thread: any) => thread.id)).toEqual(['page-1', 'page-0']);
    expect(second.page.hasMore).toBe(false);
    expect((await get('http://localhost/api/inbox?cursor=not-a-cursor')).status).toBe(400);
  });

  it('rejects replies to another mailbox or a senderless system message', async () => {
    await insertMessage({ ...ownMessage('theirs'), user_id: 'usr_sam' });
    await insertMessage(ownMessage('system', { sender_id: null }));
    expect((await post({ action: 'reply', messageId: 'theirs', text: 'x' })).status).toBe(404);
    expect((await post({ action: 'reply', messageId: 'system', text: 'x' })).status).toBe(409);
  });

  it('fails closed when asked to merge or approve an unbound notification', async () => {
    await insertMessage(ownMessage('proposal', { message_kind: 'proposal', feature_ref: 'refs/features/x/v1' }));
    expect((await post({ action: 'merge', messageId: 'proposal' })).status).toBe(409);
    expect((await post({ action: 'approve', messageId: 'proposal' })).status).toBe(409);
    expect(await ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('proposal').first('is_merged')).toBe(0);
  });

  it('approves one exact owned preview attempt idempotently without claiming it landed', async () => {
    const resultOid = '4'.repeat(40);
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES ('repo-inbox','dronehunter','usr_nate','nate/inbox-test','private','refs/heads/main','repos/inbox','active')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-inbox','repo-inbox','refs/heads/main','usr_sam','preview_ready','inbox-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-inbox','job-inbox',1,? ,?,'tool-v1','policy-v1','preview_ready')`)
      .bind('3'.repeat(40), resultOid).run();
    await insertMessage(ownMessage('proposal', { message_kind: 'proposal', feature_ref: 'refs/features/x/v1', merge_attempt_id: 'attempt-inbox' }));

    expect((await post({ action: 'approve', messageId: 'proposal' })).status).toBe(200);
    expect((await post({ action: 'approve', messageId: 'proposal' })).status).toBe(200);
    expect(await ctx.d1.prepare('SELECT count(*) AS count FROM merge_approvals WHERE merge_attempt_id=?').bind('attempt-inbox').first('count')).toBe(1);
    expect(await ctx.d1.prepare("SELECT count(*) AS count FROM forge_outbox_events WHERE aggregate_id=? AND event_type='merge.approved'").bind('attempt-inbox').first('count')).toBe(1);
    expect(await ctx.d1.prepare('SELECT status FROM merge_jobs WHERE id=?').bind('job-inbox').first('status')).toBe('landing');
    expect(await ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('proposal').first('is_merged')).toBe(0);
    const data: any = await (await get()).json();
    expect(data.threads[0]).toMatchObject({ approvalStatus: 'approved', mergeStatus: 'approved', isMerged: false, casNewSha: resultOid });
  });

  it('does not allow a queued approval to be reversed while GITSMITH may be landing it', async () => {
    const resultOid = 'b'.repeat(40);
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES ('repo-locked','dronehunter','usr_nate','nate/locked-test','private','refs/heads/main','repos/locked','active')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-locked','repo-locked','refs/heads/main','usr_sam','preview_ready','locked-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-locked','job-locked',1,?,?,'tool','policy','preview_ready')`)
      .bind('a'.repeat(40), resultOid).run();
    await insertMessage(ownMessage('locked-proposal', { message_kind: 'proposal', merge_attempt_id: 'attempt-locked' }));

    expect((await post({ action: 'approve', messageId: 'locked-proposal' })).status).toBe(200);
    expect((await post({ action: 'reject', messageId: 'locked-proposal', comment: 'Changed my mind.' })).status).toBe(409);
    expect(await ctx.d1.prepare('SELECT decision FROM merge_approvals WHERE merge_attempt_id=?').bind('attempt-locked').first('decision')).toBe('approved');
  });

  it('requires a rejection comment and records an exact idempotent rejection without landing', async () => {
    const resultOid = '6'.repeat(40);
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES ('repo-reject','dronehunter','usr_nate','nate/reject-test','private','refs/heads/main','repos/reject','active')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key)
      VALUES ('job-reject','repo-reject','refs/heads/main','usr_sam','preview_ready','reject-test')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-reject','job-reject',1,?,?,'tool','policy','preview_ready')`)
      .bind('5'.repeat(40), resultOid).run();
    await insertMessage(ownMessage('reject-proposal', { message_kind: 'proposal', merge_attempt_id: 'attempt-reject' }));

    expect((await post({ action: 'reject', messageId: 'reject-proposal', comment: ' ' })).status).toBe(400);
    expect((await post({ action: 'reject', messageId: 'reject-proposal', comment: 'Tests fail on Windows.' })).status).toBe(200);
    expect((await post({ action: 'reject', messageId: 'reject-proposal', comment: 'Tests fail on Windows.' })).status).toBe(200);
    const review: any = await ctx.d1.prepare('SELECT * FROM merge_approvals WHERE merge_attempt_id=?').bind('attempt-reject').first();
    expect(review).toMatchObject({ decision: 'rejected', comment: 'Tests fail on Windows.', result_commit_oid: resultOid });
    expect(await ctx.d1.prepare('SELECT status FROM merge_attempts WHERE id=?').bind('attempt-reject').first('status')).toBe('rejected');
    expect(await ctx.d1.prepare('SELECT is_merged FROM inbox_messages WHERE id=?').bind('reject-proposal').first('is_merged')).toBe(0);
    const data: any = await (await get()).json();
    expect(data.threads.find((thread: any) => thread.id === 'reject-proposal')).toMatchObject({
      approvalStatus: 'rejected', approvalComment: 'Tests fail on Windows.', mergeStatus: 'rejected', isMerged: false
    });
  });

  it('only reports landed when job and exact result OIDs agree', async () => {
    const oid = '8'.repeat(40);
    await ctx.d1.prepare(`INSERT INTO repositories
      (id,app_id,owner_user_id,slug,visibility,default_ref,storage_key,status)
      VALUES ('repo-landed','dronehunter','usr_nate','nate/landed-test','private','refs/heads/main','repos/landed','active')`).run();
    await ctx.d1.prepare(`INSERT INTO merge_jobs
      (id,target_repository_id,target_ref,requested_by_user_id,status,idempotency_key,landed_commit_oid)
      VALUES ('job-landed','repo-landed','refs/heads/main','usr_nate','landed','landed-test',?)`).bind(oid).run();
    await ctx.d1.prepare(`INSERT INTO merge_attempts
      (id,merge_job_id,attempt_number,input_target_oid,result_commit_oid,toolchain_version,test_policy_version,status)
      VALUES ('attempt-landed','job-landed',1,?,?,'tool','policy','landed')`).bind('7'.repeat(40), oid).run();
    await insertMessage(ownMessage('landed', { message_kind: 'proposal', merge_attempt_id: 'attempt-landed' }));
    const data: any = await (await get()).json();
    expect(data.threads[0]).toMatchObject({ mergeStatus: 'landed', isMerged: true });
  });

  it('renders a truthful first frame without demo mail or fake merge claims', () => {
    const html = renderToString(React.createElement(AuthProvider, null, React.createElement(InboxView)));
    expect(html).toContain('INBOX.EXE');
    expect(html).toContain('SYNCING');
    expect(html).toContain('No Message Selected');
    expect(html).not.toContain('$340.00');
    expect(html).not.toContain('Executes atomic git update-ref');
  });
});
