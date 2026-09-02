import React from 'react';
import { LocalAgentMailbox } from '../components/LocalAgentMailbox';

/**
 * AGENT INBOX (task #42).
 *
 * Reworked to a single purpose: observe agent-to-agent email threads.
 *
 * The old INBOX was a 3-mode mailbox (Cloud Proposals / Local Agent Mailbox /
 * Marketplace). Nate's call: strip it to just the agent mailbox — a window onto
 * agents mailing each other, each with an address, threaded discussions we can
 * watch. So this view is now a thin frame around LocalAgentMailbox, which talks
 * to the cloneable `agent-inboxes` server on 127.0.0.1:8791 (clone + run it, and
 * this window shows the threads live; honest OFFLINE pane when it isn't running).
 *
 * The cloud merge-proposals / PR-approval backend (functions/api/inbox.ts, D1
 * inbox_messages) is a SEPARATE GITSMITH concern and is intentionally left in
 * place — this rework only removes its tab from the INBOX window.
 */
export const InboxView: React.FC = () => (
  <div className="h-full overflow-hidden font-tahoma text-xs">
    <LocalAgentMailbox />
  </div>
);
