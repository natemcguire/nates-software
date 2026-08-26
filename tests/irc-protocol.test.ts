import { describe, it, expect } from 'vitest';
import {
  parseRawIrcLine,
  formatRawIrcLine,
  parseUserChatInput,
  formatIrcTime,
  filterUnexpiredIrcMessages,
  INITIAL_ONLINE_USERS,
  IrcMessage
} from '../src/lib/ircProtocol';

describe('RFC 1459 / 2812 IRC Protocol Suite', () => {
  it('should parse incoming raw IRC lines with prefix, command, and trailing arguments', () => {
    const raw = ':nate!nate@nates-software.com PRIVMSG #lounge :Hello everyone in the lounge';
    const parsed = parseRawIrcLine(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe('nate!nate@nates-software.com');
    expect(parsed?.command).toBe('PRIVMSG');
    expect(parsed?.params).toEqual(['#lounge', 'Hello everyone in the lounge']);
  });

  it('should parse IRC server numeric replies and topic notices', () => {
    const raw = ':irc.nates-software.com 332 nate #lounge :Welcome to Nate\'s Software Global Lounge';
    const parsed = parseRawIrcLine(raw);

    expect(parsed?.prefix).toBe('irc.nates-software.com');
    expect(parsed?.command).toBe('332');
    expect(parsed?.params).toEqual(['nate', '#lounge', "Welcome to Nate's Software Global Lounge"]);
  });

  it('should format structured commands to valid raw IRC protocol lines', () => {
    const line1 = formatRawIrcLine('NICK', 'nate_coder');
    expect(line1).toBe('NICK nate_coder');

    const line2 = formatRawIrcLine('PRIVMSG', '#lounge', 'This has spaces in it');
    expect(line2).toBe('PRIVMSG #lounge :This has spaces in it');
  });

  it('should parse user slash commands (/nick, /me, /topic, /who, /clear, /join, /help)', () => {
    const cmd1 = parseUserChatInput('/nick josh_dev', 'nate', '#lounge');
    expect(cmd1.command).toBe('NICK');
    expect(cmd1.args).toEqual(['josh_dev']);

    const cmd2 = parseUserChatInput('/me is hacking on SQLite WAL', 'nate', '#lounge');
    expect(cmd2.command).toBe('ACTION');
    expect(cmd2.isAction).toBe(true);
    expect(cmd2.messageText).toBe('is hacking on SQLite WAL');

    const cmd3 = parseUserChatInput('/topic 12:01 AM Daily Drops Active', 'nate', '#lounge');
    expect(cmd3.command).toBe('TOPIC');
    expect(cmd3.args).toEqual(['#lounge', '12:01 AM Daily Drops Active']);

    const cmd4 = parseUserChatInput('/clear', 'nate', '#lounge');
    expect(cmd4.command).toBe('CLEAR');

    const cmd5 = parseUserChatInput('/who', 'nate', '#lounge');
    expect(cmd5.command).toBe('NAMES');
    expect(cmd5.args).toEqual(['#lounge']);
  });

  it('should default normal chat messages to PRIVMSG', () => {
    const normal = parseUserChatInput('DroneHunter 95 is live on the arcade canvas!', 'nate', '#lounge');
    expect(normal.command).toBe('PRIVMSG');
    expect(normal.args).toEqual(['#lounge', 'DroneHunter 95 is live on the arcade canvas!']);
    expect(normal.messageText).toBe('DroneHunter 95 is live on the arcade canvas!');
  });

  it('should seed authentic online presence with operator (@) and voiced (+) statuses', () => {
    expect(INITIAL_ONLINE_USERS.length).toBeGreaterThanOrEqual(3);
    const nate = INITIAL_ONLINE_USERS.find(u => u.nick === 'nate');
    expect(nate?.isOp).toBe(true);
    expect(nate?.avatar).toBe('🎯');

    const josh = INITIAL_ONLINE_USERS.find(u => u.nick === 'josh');
    expect(josh?.isOp).toBe(true);
  });

  it('should format standard timestamps to [HH:MM:SS]', () => {
    const timeStr = formatIrcTime(new Date(2026, 7, 26, 7, 38, 15));
    expect(timeStr).toBe('07:38:15');
  });

  it('should purge and filter messages older than 24 hours (24h Ephemeral Buffer)', () => {
    const now = Date.now();
    const mockMessages: IrcMessage[] = [
      {
        id: 'msg-old',
        channel: '#lounge',
        sender: 'sam',
        type: 'PRIVMSG',
        text: 'This is 25 hours old and should be purged',
        timestamp: new Date(now - 25 * 3600 * 1000).toISOString(),
        timeFormatted: '06:00:00'
      },
      {
        id: 'msg-fresh',
        channel: '#lounge',
        sender: 'nate',
        type: 'PRIVMSG',
        text: 'This is 2 hours old and is active',
        timestamp: new Date(now - 2 * 3600 * 1000).toISOString(),
        timeFormatted: '05:38:00'
      }
    ];

    const unexpired = filterUnexpiredIrcMessages(mockMessages, now);
    expect(unexpired.length).toBe(1);
    expect(unexpired[0].id).toBe('msg-fresh');
  });
});
