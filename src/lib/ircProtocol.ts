/**
 * IRC Protocol Client & Parser (RFC 1459 / RFC 2812 Standard)
 * Implements core channel mechanics, commands (/nick, /me, /topic, /who, /clear, /join),
 * raw IRC line serialization/deserialization, and presence management.
 */

export interface IrcUser {
  nick: string;
  ident?: string;
  host?: string;
  isOp?: boolean;
  isVoiced?: boolean;
  isAway?: boolean;
  avatar?: string;
}

export type IrcMessageType = 'PRIVMSG' | 'ACTION' | 'NOTICE' | 'JOIN' | 'PART' | 'QUIT' | 'NICK' | 'TOPIC' | 'SYSTEM' | 'ERROR';

export interface IrcMessage {
  id: string;
  channel: string;
  sender: string;
  type: IrcMessageType;
  text: string;
  timestamp: string;
  timeFormatted: string;
  isOp?: boolean;
}

export interface IrcChannelState {
  name: string;
  topic: string;
  topicSetter?: string;
  topicTimestamp?: string;
  users: IrcUser[];
  messages: IrcMessage[];
  connected: boolean;
  server: string;
  port: number;
}

/**
 * Format timestamp to IRC standard [HH:MM:SS]
 */
export function formatIrcTime(date: Date = new Date()): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Parse an incoming raw IRC protocol line into structured parameters
 * e.g. ":nate!nate@nates-software.com PRIVMSG #lounge :Hello world"
 */
export function parseRawIrcLine(line: string): { prefix?: string; command: string; params: string[] } | null {
  if (!line || !line.trim()) return null;

  let rest = line.trim();
  let prefix: string | undefined = undefined;

  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return null;
    prefix = rest.substring(1, spaceIdx);
    rest = rest.substring(spaceIdx + 1).trimStart();
  }

  const trailingIdx = rest.indexOf(' :');
  let trailing: string | undefined = undefined;
  if (trailingIdx !== -1) {
    trailing = rest.substring(trailingIdx + 2);
    rest = rest.substring(0, trailingIdx);
  }

  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const command = parts[0].toUpperCase();
  const params = parts.slice(1);
  if (trailing !== undefined) {
    params.push(trailing);
  }

  return { prefix, command, params };
}

/**
 * Format structured command to raw IRC wire format
 */
export function formatRawIrcLine(command: string, ...params: string[]): string {
  if (params.length === 0) return command;
  const last = params[params.length - 1];
  const middle = params.slice(0, -1);

  if (last.includes(' ') || last.startsWith(':') || last === '') {
    return `${command} ${middle.join(' ')} :${last}`.trim();
  }
  return `${command} ${params.join(' ')}`;
}

/**
 * Parses user input in the chat box:
 * - If starts with "/", extracts command and arguments (e.g. /nick, /me, /topic, /clear, /who)
 * - Otherwise defaults to a standard PRIVMSG
 */
export function parseUserChatInput(input: string, _currentNick: string = 'nate', currentChannel: string = '#lounge'): {
  command: string;
  args: string[];
  messageText?: string;
  isAction?: boolean;
} {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return {
      command: 'PRIVMSG',
      args: [currentChannel, trimmed],
      messageText: trimmed
    };
  }

  const match = trimmed.slice(1).match(/^(\S+)(?:\s+(.*))?$/s);
  if (!match) {
    return { command: 'UNKNOWN', args: [] };
  }

  const rawCmd = match[1].toLowerCase();
  const rest = (match[2] || '').trim();

  switch (rawCmd) {
    case 'me':
      return {
        command: 'ACTION',
        args: [currentChannel, rest],
        messageText: rest,
        isAction: true
      };
    case 'nick':
      return {
        command: 'NICK',
        args: [rest.replace(/^@/, '')]
      };
    case 'topic':
      return {
        command: 'TOPIC',
        args: rest ? [currentChannel, rest] : [currentChannel]
      };
    case 'join':
      return {
        command: 'JOIN',
        args: [rest.startsWith('#') ? rest : `#${rest}`]
      };
    case 'part':
    case 'leave':
      return {
        command: 'PART',
        args: [currentChannel]
      };
    case 'clear':
      return {
        command: 'CLEAR',
        args: []
      };
    case 'who':
    case 'names':
      return {
        command: 'NAMES',
        args: [currentChannel]
      };
    case 'help':
      return {
        command: 'HELP',
        args: []
      };
    case 'msg':
    case 'query': {
      const msgMatch = rest.match(/^(\S+)\s+(.*)$/s);
      if (msgMatch) {
        return {
          command: 'PRIVMSG',
          args: [msgMatch[1], msgMatch[2]],
          messageText: msgMatch[2]
        };
      }
      return { command: 'HELP', args: ['msg'] };
    }
    default:
      return {
        command: rawCmd.toUpperCase(),
        args: rest ? rest.split(/\s+/) : []
      };
  }
}

/**
 * Initial standard channel presence and default seed messages
 */
export const DEFAULT_CHANNEL: string = '#lounge';
export const DEFAULT_SERVER: string = 'irc.nates-software.com';
export const DEFAULT_PORT: number = 6667;

export const INITIAL_ONLINE_USERS: IrcUser[] = [
  { nick: 'nate', isOp: true, isVoiced: true, ident: 'nate', host: 'nates-software.com', avatar: '🎯' },
  { nick: 'josh', isOp: true, isVoiced: true, ident: 'josh', host: 'eastbay.dev', avatar: '⛵' },
  { nick: 'sam', isOp: false, isVoiced: true, ident: 'sam', host: 'ai.nates-software.com', avatar: '🤖' }
];

export const INITIAL_CHAT_MESSAGES: IrcMessage[] = [
  {
    id: 'msg-001',
    channel: '#lounge',
    sender: 'System',
    type: 'SYSTEM',
    text: '*** Connected to irc.nates-software.com:6667 (TLS/SSL active)',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    timeFormatted: '06:40:00'
  },
  {
    id: 'msg-002',
    channel: '#lounge',
    sender: 'System',
    type: 'TOPIC',
    text: "*** Topic for #lounge: Welcome to Nate's Software Global Lounge · 12:01 AM UTC Daily Releases & Indie Modding",
    timestamp: new Date(Date.now() - 3500000).toISOString(),
    timeFormatted: '06:41:00'
  },
  {
    id: 'msg-003',
    channel: '#lounge',
    sender: 'nate',
    type: 'PRIVMSG',
    text: 'Welcome everyone! DroneHunter 95, Certified Mailer, and PicFit are all running live on their own subdomains with local SQLite WAL.',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    timeFormatted: '07:10:22',
    isOp: true
  },
  {
    id: 'msg-004',
    channel: '#lounge',
    sender: 'josh',
    type: 'PRIVMSG',
    text: 'Just pulled dronehunter via git clone into /tmp/slop-dronehunter. The shotgun audio synthesis in Web Audio is snappy.',
    timestamp: new Date(Date.now() - 900000).toISOString(),
    timeFormatted: '07:25:14',
    isOp: true
  },
  {
    id: 'msg-005',
    channel: '#lounge',
    sender: 'nate',
    type: 'ACTION',
    text: 'is testing 1-click Claude Code and AGY agent pairing workflows',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    timeFormatted: '07:35:00',
    isOp: true
  },
  {
    id: 'msg-006',
    channel: '#lounge',
    sender: 'sam',
    type: 'PRIVMSG',
    text: 'Type /help to see all supported IRC commands like /nick, /me, /topic, /who.',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    timeFormatted: '07:38:00'
  }
];

/**
 * Purge helper: returns only messages created within the last 24 hours
 */
export const IRC_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

export function filterUnexpiredIrcMessages(messages: IrcMessage[], nowMs: number = Date.now()): IrcMessage[] {
  const cutoff = nowMs - IRC_MESSAGE_TTL_MS;
  return messages.filter(m => {
    const msgTime = new Date(m.timestamp).getTime();
    return !isNaN(msgTime) && msgTime >= cutoff;
  });
}
