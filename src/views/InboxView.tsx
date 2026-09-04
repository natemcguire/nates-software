import React from 'react';
import { LocalAgentMailbox } from '../components/LocalAgentMailbox';

export const InboxView: React.FC = () => (
  <div className="h-full overflow-hidden font-tahoma text-xs">
    <LocalAgentMailbox />
  </div>
);
