// Regression cover for the defects fixed in this pass:
//  - the undefined updateTurnCountdown call that threw once a second in online rooms
//  - guests being told online play was read-only
//  - removeLobbySeat bypassing the engine (orphan properties, no removedSeats, host could self-remove)
//  - HTML injection through the game log and the floating emote popup
//  - presence forged for another seat stalling the disconnected-skip timer
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch, makeOnlineRoom } from '../helpers/loadGame.js';

describe('multiplayer and rendering defects', () => {
  it('renders the turn countdown without throwing in an online room', async () => {
    const { host, clock } = await makeOnlineRoom({ guests: 0 });
    host.win.addLobbySeat(true);
    await host.settle(0);
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await clock.tick(1500);
    await host.settle(0);
    expect(host.errors.filter(e => /updateTurnCountdown/.test(e))).toEqual([]);
    const el = host.byId('turn-countdown');
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.textContent).toMatch(/\d+s/);
  });

  it('lets a guest roll by forwarding the action to the host', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await guest.settle(0);
    const gid = guest.ev('myLocalSeatId');
    // Put the guest on the clock, then have it act through the normal control path.
    host.win.eval(`(function(){
      gameState.turnIndex = gameState.players.findIndex(p => p.id === ${JSON.stringify(gid)});
      gameState.turnPhase = 'ROLL';
      gameState.turnId = (Number(gameState.turnId)||0) + 1;
      gameState.stateSeq = (Number(gameState.stateSeq)||0) + 1;
      lastAccepted = { term: authTerm, seq: gameState.stateSeq };
      broadcastRoomState(gameState, null);
    })()`);
    await guest.settle(0);
    expect(guest.ev('canLocalUserActOnCurrentSeat()')).toBe(true);
    guest.win.dispatchSeatAction('roll');
    await host.settle(2000);
    await guest.settle(2000);
    expect(host.state.players.find(p => p.id === gid).position).not.toBe(0);
    expect(host.state.turnPhase).toBe('END');
    expect(guest.byId('banner-toast-text').textContent).not.toMatch(/read-only/i);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  });

  it('removes a lobby seat through the engine and keeps at least two seats', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.addLobbySeat(true);
    await g.settle(0);
    const third = g.state.players[2].id;
    g.win.eval(`gameState.properties['0'] = { owner: ${JSON.stringify(third)}, houses: 0, mortgaged: false };`);
    g.win.removeLobbySeat(third);
    await g.settle(0);
    expect(g.state.players.some(p => p.id === third)).toBe(false);
    expect(g.state.properties['0']).toBeUndefined();
    expect(g.state.removedSeats).toContain(third);
    g.win.removeLobbySeat(g.state.players[0].id);
    expect(g.state.players.length).toBe(2);
    expect(g.byId('banner-toast-text').textContent).toMatch(/at least 2 seats/i);
    g.close();
  });

  it('escapes log and float-emote text instead of injecting HTML', async () => {
    const g = await loadGame();
    const payload = '<img src=x onerror=window.__pwned=1>';
    g.win.eval(`gameState.logs.push({ time: 'Now', text: ${JSON.stringify(payload)}, type: 'system' });`);
    g.win.renderAllUI();
    expect(g.byId('game-log-list').innerHTML).not.toContain('<img');
    expect(g.byId('game-log-list').textContent).toContain(payload);
    g.win.showFloatingEmotePopup({ emoji: payload, sender: '<b>x</b>', color: '#fff' });
    const fx = g.byId('floating-emote-container');
    expect(fx.querySelector('img')).toBeNull();
    expect(fx.querySelector('b')).toBeNull();
    expect(fx.textContent).toContain(payload);
    expect(g.win.__pwned).toBeUndefined();
    g.close();
  });

  it('ignores presence from a client that never proved the seat token', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const gid = guests[0].ev('myLocalSeatId');
    const bound = host.win.eval(`seatClientIds[${JSON.stringify(gid)}] || ''`);
    expect(bound).toBeTruthy();
    host.win.eval(`delete lastSeenAt[${JSON.stringify(gid)}]`);
    host.win.handlePresence({ seatId: gid, senderClientId: 'client_attacker' });
    expect(host.win.eval(`lastSeenAt[${JSON.stringify(gid)}] || 0`)).toBe(0);
    host.win.handlePresence({ seatId: gid, senderClientId: bound });
    expect(host.win.eval(`lastSeenAt[${JSON.stringify(gid)}] || 0`)).toBeGreaterThan(0);
  });

  it('opens a multiplayer lobby with the host only and never auto-seats a bot', async () => {
    const { host } = await makeOnlineRoom({ guests: 0 });
    expect(host.state.players.map(p => p.isBot)).toEqual([false]);
    // Starting with one seat is refused, and adding a bot is the host's explicit choice.
    host.win.startMatchFromLobby();
    await host.settle(0);
    expect(host.state.status).toBe('setup');
    expect(host.state.players.length).toBe(1);
    expect(host.byId('banner-toast-text').textContent).toMatch(/waiting for players/i);
    host.win.addLobbySeat(true);
    await host.settle(0);
    host.win.startMatchFromLobby();
    await host.settle(0);
    expect(host.state.status).toBe('playing');
    expect(host.state.players.length).toBe(2);
  });

  it('hosting keeps a bot the player added on purpose but drops the default one', async () => {
    const g = await loadGame();
    const defaultBots = g.state.players.filter(p => p.isBot).map(p => p.id);
    g.win.addLobbySeat(true);
    await g.settle(0);
    const userBot = g.state.players.filter(p => p.isBot).map(p => p.id).find(id => !defaultBots.includes(id));
    expect(userBot).toBeTruthy();
    await g.win.createOnlineRoom();
    await g.settle(0);
    expect(g.state.players.filter(p => p.isBot).map(p => p.id)).toEqual([userBot]);
    g.close();
  });
});
