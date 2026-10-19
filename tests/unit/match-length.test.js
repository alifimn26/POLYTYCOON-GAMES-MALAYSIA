// Covers match length:
//  - classic mode ends only when one tycoon is left standing
//  - rounds mode ends after a set number of rounds and crowns the richest seat
//  - net worth (cash + deeds + houses, half price when mortgaged)
//  - the round pill, the result overlay, and the "no actions after a winner" guard
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch } from '../helpers/loadGame.js';

describe('match length', () => {
  it('ends a classic match when only one tycoon is left standing', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.players[1].bankrupt = true;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 });
      return { winnerId: res.state.winnerId, reason: res.state.winReason };
    })()`);
    expect(out.winnerId).toBe('p1');
    expect(out.reason).toBe('last_standing');
    g.close();
  });

  it('ends a rounds match exactly at the limit and crowns the richest seat', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.rules.endMode = 'rounds';
      st.rules.maxRounds = 2;
      st.players[0].cash = 100;
      st.players[1].cash = 900;
      let cur = st;
      const winners = [];
      for (let i = 0; i < 4; i++) {
        cur = PolyEngine.applyAction(cur, { seatId: cur.players[0].id, kind: 'end', turnId: 0 }).state;
        winners.push(cur.winnerId);
      }
      return { winners, winnerId: cur.winnerId, reason: cur.winReason, turnCount: cur.turnCount };
    })()`);
    // Two seats times two rounds is four turns; nobody wins until the fourth ends.
    expect(out.winners).toEqual([null, null, null, 'bot_1']);
    expect(out.winnerId).toBe('bot_1');
    expect(out.reason).toBe('rounds');
    expect(out.turnCount).toBe(4);
    g.close();
  });

  it('ranks a rounds winner by net worth, not raw cash', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.rules.endMode = 'rounds';
      st.rules.maxRounds = 1;
      st.turnCount = 1;
      st.players[0].cash = 0;
      st.players[1].cash = 0;
      const tiles = MAP_THEMES.malaysia.tiles;
      const best = tiles.map((t, i) => ({ t, i })).filter(x => x.t.type === 'property').sort((a, b) => b.t.price - a.t.price)[0];
      st.properties[best.i] = { owner: 'p1', houses: 0, mortgaged: false };
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 });
      return { winnerId: res.state.winnerId };
    })()`);
    expect(out.winnerId).toBe('p1');
    g.close();
  });

  it('values cash, houses and half-price mortgaged deeds', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      const tiles = MAP_THEMES.malaysia.tiles;
      const p = st.players[0];
      p.cash = 100;
      const props = tiles.map((t, i) => ({ t, i })).filter(x => x.t.type === 'property');
      const houseTile = props[0];
      st.properties[houseTile.i] = { owner: 'p1', houses: 2, mortgaged: false };
      const mortTile = props[1];
      st.properties[mortTile.i] = { owner: 'p1', houses: 0, mortgaged: true };
      const expected = 100 + houseTile.t.price + 2 * (houseTile.t.houseCost || 0) + Math.floor(mortTile.t.price / 2);
      return { got: PolyEngine.netWorth(st, p), expected };
    })()`);
    expect(out.got).toBe(out.expected);
    g.close();
  });

  it('refuses every action once a winner is decided', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.winnerId = 'p1';
      const v = (kind) => PolyEngine.validateAction(st, { seatId: 'p1', kind, turnId: 0 }, { origin: 'local' }).ok;
      return { roll: v('roll'), end: v('end'), borrow: v('borrow') };
    })()`);
    expect(out.roll).toBe(false);
    expect(out.end).toBe(false);
    expect(out.borrow).toBe(false);
    g.close();
  });

  it('carries the end mode, round count and winner through a room-state round trip', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ roomCode: 'ABC123', hostClientId: 'client_host0001', hostTerm: 1, hostSeatId: 'p1', stateSeq: 1 });
      st.status = 'playing';
      st.players[0].tokenHash = 'aaaaaaaaaaaaaaaa';
      st.rules.endMode = 'rounds';
      st.rules.maxRounds = 20;
      st.turnCount = 7;
      st.winnerId = 'p1';
      st.winReason = 'rounds';
      const clean = PolyEngine.validateRoomState(JSON.parse(JSON.stringify(st)), { roomCode: 'ABC123' });
      return clean ? { endMode: clean.rules.endMode, maxRounds: clean.rules.maxRounds, turnCount: clean.turnCount, winnerId: clean.winnerId, winReason: clean.winReason } : null;
    })()`);
    expect(out).not.toBeNull();
    expect(out.endMode).toBe('rounds');
    expect(out.maxRounds).toBe(20);
    expect(out.turnCount).toBe(7);
    expect(out.winnerId).toBe('p1');
    expect(out.winReason).toBe('rounds');
    g.close();
  });

  it('shows the round pill only in rounds mode', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){ gameState.rules.endMode = 'rounds'; gameState.rules.maxRounds = 10; gameState.turnCount = 0; })()`);
    g.win.renderAllUI();
    const pill = g.byId('round-pill');
    expect(pill.classList.contains('hidden')).toBe(false);
    expect(pill.textContent).toBe('Round 1/10');

    g.win.eval(`(function(){ gameState.rules.endMode = 'classic'; })()`);
    g.win.renderAllUI();
    expect(g.byId('round-pill').classList.contains('hidden')).toBe(true);
    g.close();
  });

  it('shows the result overlay with the winner and offers both exits', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const winner = g.state.players[0];
    g.win.eval(`(function(){
      gameState.winnerId = ${JSON.stringify(winner.id)};
      gameState.winReason = 'last_standing';
    })()`);
    g.win.renderAllUI();
    const overlay = g.byId('match-result');
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(g.byId('match-result-title').textContent).toBe(`${winner.name} wins!`);
    expect(g.byId('match-result-table').textContent).toContain(winner.name);
    expect(g.byId('btn-start-next-round').disabled).toBe(false);
    expect(g.byId('match-result-guest-note').classList.contains('hidden')).toBe(true);

    // Back to lobby hides the result and opens the lobby, where the next round starts.
    g.byId('btn-match-to-lobby').click();
    await g.settle(0);
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(g.byId('start-menu-modal').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-launch-match').textContent).toBe('Start next round');
    g.close();
  });

  it('starts the next round from the result screen', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.winnerId = 'p1';
      gameState.winReason = 'last_standing';
      gameState.players[0].cash = 12;
      gameState.players[0].position = 7;
      gameState.players[1].bankrupt = true;
      gameState.properties['1'] = { owner: 'p1', houses: 0, mortgaged: false };
    })()`);
    g.win.renderAllUI();
    g.byId('btn-start-next-round').click();
    await g.settle(0);
    expect(g.state.winnerId).toBeNull();
    expect(g.state.status).toBe('playing');
    expect(g.state.players[0].cash).toBe(g.state.rules.startingCash);
    expect(g.state.players[0].position).toBe(0);
    expect(g.state.players[1].bankrupt).toBe(false);
    expect(Object.keys(g.state.properties).length).toBe(0);
    expect(g.byId('match-result').classList.contains('hidden')).toBe(true);
    g.close();
  });

  it('leaves a finished board with no dead controls, only the result action', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){ gameState.winnerId = 'p1'; gameState.winReason = 'last_standing'; })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-roll-dice').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-end-turn').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-buy-property').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-show-match-result').classList.contains('hidden')).toBe(false);
    expect(g.byId('center-status-subtitle').textContent).toMatch(/match over/i);

    // Reopening from the board console brings the result back.
    g.byId('btn-show-match-result').click();
    await g.settle(0);
    expect(g.byId('match-result').classList.contains('hidden')).toBe(false);
    g.close();
  });

  it('sends Escape on the result screen to the lobby instead of a dead board', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){ gameState.winnerId = 'p1'; gameState.winReason = 'last_standing'; })()`);
    g.win.renderAllUI();
    const ev = new g.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    g.doc.dispatchEvent(ev);
    await g.settle(0);
    expect(g.byId('match-result').classList.contains('hidden')).toBe(true);
    expect(g.byId('start-menu-modal').classList.contains('hidden')).toBe(false);
    g.close();
  });

  it('ends a local rounds match through the normal dispatch path', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.rules.endMode = 'rounds';
      gameState.rules.maxRounds = 1;
      gameState.turnCount = 1;
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
    })()`);
    g.win.dispatchSeatAction('end');
    await g.settle(0);
    expect(g.state.winnerId).toBeTruthy();
    expect(g.state.winReason).toBe('rounds');
    expect(g.byId('match-result').classList.contains('hidden')).toBe(false);
    g.close();
  });
});
