// Chat notification bubbles: a room message pops in over the board when the thread is out of sight.
// These cover the visibility rule, the stack cap, the timeout, the exit path and text safety.
import { describe, it, expect } from 'vitest';
import { makeOnlineRoom } from '../helpers/loadGame.js';

// Delivers one message straight to the guest's receive path, the same shape a peer packet has.
async function receive(guest, text, id, sender = 'peer_other') {
  guest.win.handleChatMessage({
    senderClientId: sender,
    message: {
      id: id || `msg_${Math.random().toString(36).slice(2, 10)}`,
      seatId: 'seat_other',
      name: 'Other Tycoon',
      color: '#f59e0b',
      token: 'hat',
      text,
      ts: Date.now()
    }
  });
  await guest.settle(0);
}

// makeOnlineRoom leaves the lobby dialog open. Bubbles wait for it to close, so close it first.
async function guestInTable({ guests = 1 } = {}) {
  const room = await makeOnlineRoom({ guests });
  for (const g of room.guests) {
    g.win.closeStartMenuModal();
    await g.settle(0);
  }
  return room;
}

const bubbles = (g) => g.doc.querySelectorAll('#chat-bubble-stack [data-chat-bubble-id]');

describe('chat notification bubbles', () => {
  it('shows a bubble for an incoming message while the thread is closed', async () => {
    const { guests } = await guestInTable();
    const guest = guests[0];
    expect(guest.ev('chatActiveTab')).toBe('activity');

    await receive(guest, 'Rolling for the docks now');

    const list = bubbles(guest);
    expect(list.length).toBe(1);
    expect(list[0].textContent).toContain('Other Tycoon');
    expect(list[0].textContent).toContain('Rolling for the docks now');
    // The unread badge still runs alongside the bubble.
    expect(guest.ev('chatUnread')).toBe(1);
  });

  it('clears the bubble after its lifetime', async () => {
    const { guests, clock } = await guestInTable();
    const guest = guests[0];
    await receive(guest, 'Anybody buying the airport?');
    expect(bubbles(guest).length).toBe(1);

    await clock.tick(guest.ev('CHAT_BUBBLE_LIFE_MS'));
    await guest.settle(200);
    expect(bubbles(guest).length).toBe(0);
  });

  it('keeps at most three bubbles and drops the oldest', async () => {
    const { guests } = await guestInTable();
    const guest = guests[0];
    await receive(guest, 'one', 'msg_one', 'peer_a');
    await receive(guest, 'two', 'msg_two', 'peer_b');
    await receive(guest, 'three', 'msg_three', 'peer_c');
    expect(bubbles(guest).length).toBe(3);

    await receive(guest, 'four', 'msg_four', 'peer_d');
    await guest.settle(200);

    const ids = [...bubbles(guest)].map(n => n.dataset.chatBubbleId);
    expect(ids).toEqual(['msg_two', 'msg_three', 'msg_four']);
  });

  it('shows no bubble for the local user or while the thread is on screen', async () => {
    const { guests } = await guestInTable();
    const guest = guests[0];

    // Own messages never reach the notification path.
    guest.win.eval(`chatAddLive(chatSanitizeEntry({ id: 'own_1', seatId: myLocalSeatId, name: 'Me', text: 'mine', ts: Date.now() }, Date.now()), true)`);
    await guest.settle(0);
    expect(bubbles(guest).length).toBe(0);

    // With the Chat tab open, the page visible and no dialog covering the sidebar, the thread is on
    // screen, so only the badge path runs.
    guest.win.closeShareModal();
    guest.win.setLogTab('chat');
    guest.win.eval(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })`);
    guest.win.eval(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })`);
    await guest.settle(0);
    await receive(guest, 'visible in thread');
    expect(guest.ev('chatIsViewing()')).toBe(true);
    expect(bubbles(guest).length).toBe(0);
  });

  it('Open chat switches to the thread and removes the bubble', async () => {
    const { guests } = await guestInTable();
    const guest = guests[0];
    await receive(guest, 'reply when you can');
    const open = bubbles(guest)[0].querySelector('[data-chat-bubble-open]');
    open.click();
    await guest.settle(200);

    expect(guest.ev('chatActiveTab')).toBe('chat');
    expect(guest.byId('chat-panel').classList.contains('hidden')).toBe(false);
    expect(bubbles(guest).length).toBe(0);
    expect(guest.byId('chat-message-list').textContent).toContain('reply when you can');
  });

  it('holds bubbles while a dialog covers the board, then shows them when it closes', async () => {
    const { guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    // The lobby dialog is still open, so the board is covered.
    expect(guest.ev('chatSidebarObscured()')).toBe(true);
    await receive(guest, 'sent while the lobby was open');
    expect(bubbles(guest).length).toBe(0);
    expect(guest.ev('chatPendingBubbles.length')).toBe(1);

    guest.win.closeStartMenuModal();
    await guest.settle(0);
    expect(bubbles(guest).length).toBe(1);
    expect(bubbles(guest)[0].textContent).toContain('sent while the lobby was open');
    expect(guest.ev('chatPendingBubbles.length')).toBe(0);
  });

  it('writes message text as text, never as markup', async () => {
    const { guests } = await guestInTable();
    const guest = guests[0];
    await receive(guest, '<img src=x onerror=window.__pwned=1>');
    const bubble = bubbles(guest)[0];
    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.textContent).toContain('<img src=x onerror=window.__pwned=1>');
    expect(guest.win.__pwned).toBeUndefined();
    expect(guest.errors).toEqual([]);
  });
});

