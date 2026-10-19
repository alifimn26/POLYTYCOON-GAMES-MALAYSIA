// Quick reactions: the emote bar mixes emoji with word chips (GG, Skill issue, ...).
// The same array is the network allow-list, so a packet with any other label is dropped.
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch, makeOnlineRoom } from '../helpers/loadGame.js';

const labels = (g) => [...g.byId('emote-bar-container').querySelectorAll('button')].map(b => b.textContent);

describe('quick reactions', () => {
  it('offers word reactions next to emoji, as buttons built from text', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const all = labels(g);
    expect(all).toContain('GG');
    expect(all).toContain('Skill issue');
    // Every label renders as its own button, with no stray markup from the label.
    expect(g.byId('emote-bar-container').querySelectorAll('button').length).toBe(all.length);
    expect(all.every(t => t && !t.includes('<'))).toBe(true);
    // The allow-list and the rendered bar can never drift apart.
    expect(g.win.eval('PREDEFINED_EMOTES')).toEqual(all);
    g.close();
  });

  it('shows a word reaction as text in the floating popup', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.sendQuickEmote('Skill issue');
    const popup = g.byId('floating-emote-container').querySelector('div');
    expect(popup.textContent).toContain('Skill issue');
    expect(popup.querySelector('b')).toBeNull();
    g.close();
  });

  it('ignores a reaction label that is not on the list', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const before = g.byId('floating-emote-container').children.length;
    g.win.handleEmotePacket({ emote: { emoji: 'free money', seatId: '', name: 'x', color: '#fff' } });
    g.win.sendQuickEmote('free money');
    expect(g.byId('floating-emote-container').children.length).toBe(before);
    g.close();
  });

  it('still accepts a reaction from an older copy of the game', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const before = g.byId('floating-emote-container').children.length;
    // 👑 was in the emoji-only set that shipped before the word reactions.
    g.win.handleEmotePacket({ emote: { emoji: '👑', seatId: '', name: 'Old copy', color: '#fff' } });
    expect(g.byId('floating-emote-container').children.length).toBe(before + 1);
    expect(g.byId('floating-emote-container').textContent).toContain('👑');
    g.close();
  });

  it('delivers a word reaction to the other seat in an online room', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    guest.win.sendQuickEmote('GG');
    await host.settle(0);
    const texts = [...host.byId('floating-emote-container').children].map(el => el.textContent);
    expect(texts.join(' ')).toContain('GG');
    host.close();
    guest.close();
  });
});
