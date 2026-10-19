// Covers the Jail gate added with the bribe option, plus the cell buyout and the 2-turn serve:
//  - landing on Go To Jail, or drawing the Jail card, parks the seat at the gate instead of locking it up
//  - the gate bribe charges the scaled cost and is a 50/50 roll: success frees the seat, failure jails it anyway
//  - inside the cell, after a failed roll, a dearer certain bribe buys the spent roll back
//  - three doubles and a botched gate bribe stay automatic lockups with no buyout that turn
//  - ending the turn at the gate, or idling there, serves the time; bail is paid instead of rolling
//  - two failed rolls release the seat with the bail collected, and an idle skip never serves the time out
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch, makeOnlineRoom, dieValue } from '../helpers/loadGame.js';

const GATE = 10;
const GOTOJAIL = 30;

// Rolls a fixed total onto Go To Jail (tile 30) from tile 25.
const rollOntoGate = (rngValues) => `(function(){
  const st = PolyEngine.createInitialState();
  st.status = 'playing';
  st.players[0].position = 25;
  const seq = ${JSON.stringify(rngValues)}; let i = 0;
  const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
  const p = res.state.players[0];
  return { position: p.position, inJail: p.inJail, pendingJail: p.pendingJail, phase: res.state.turnPhase };
})()`;

describe('jail gate bribe', () => {
  it('stops the player at the gate instead of jailing them on Go To Jail', async () => {
    const g = await loadGame();
    const out = g.win.eval(rollOntoGate([dieValue(3), dieValue(2)]));
    expect(out.position).toBe(GATE);
    expect(out.pendingJail).toBe(true);
    expect(out.inJail).toBe(false);
    expect(out.phase).toBe('END');
    g.close();
  });

  it('stops the player at the gate when the Chance card sends them to jail', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.players[0].position = 30;
      // 3 + 3 = 6 onto Nasib (Chance) at 36; the third draw picks the jail card.
      const seq = [${dieValue(3)}, ${dieValue(3)}, 0.99]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const p = res.state.players[0];
      return { position: p.position, inJail: p.inJail, pendingJail: p.pendingJail };
    })()`);
    expect(out.position).toBe(GATE);
    expect(out.pendingJail).toBe(true);
    expect(out.inJail).toBe(false);
    g.close();
  });

  it('lets a successful bribe walk free and charges the scaled cost', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ startingCash: 5000 });
      st.status = 'playing';
      st.turnPhase = 'END';
      st.players[0].position = ${GATE};
      st.players[0].pendingJail = true;
      st.players[0].cash = 2000;
      const cost = PolyEngine.scaledCash(st, 100);
      const ok = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, { origin: 'local' }).ok;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, () => 0.1);
      const p = res.state.players[0];
      return { ok, cost, cash: p.cash, inJail: p.inJail, pendingJail: p.pendingJail, phase: res.state.turnPhase };
    })()`);
    expect(out.ok).toBe(true);
    expect(out.cost).toBe(330);
    expect(out.cash).toBe(2000 - 330);
    expect(out.inJail).toBe(false);
    expect(out.pendingJail).toBe(false);
    expect(out.phase).toBe('END');
    g.close();
  });

  it('jails a failed bribe after taking the money', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.players[0].position = ${GATE};
      st.players[0].pendingJail = true;
      st.players[0].cash = 1500;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, () => 0.9);
      const p = res.state.players[0];
      return { cash: p.cash, inJail: p.inJail, pendingJail: p.pendingJail };
    })()`);
    expect(out.cash).toBe(1400);
    expect(out.inJail).toBe(true);
    expect(out.pendingJail).toBe(false);
    g.close();
  });

  it('rejects a bribe away from the gate, before the roll, or without the cash', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const base = () => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnPhase = 'END';
        st.players[0].position = ${GATE};
        st.players[0].pendingJail = true;
        st.players[0].cash = 1500;
        return st;
      };
      const check = (mutate) => {
        const st = base();
        mutate(st);
        return PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, { origin: 'local' }).ok;
      };
      return {
        atGate: check(() => {}),
        notAtGate: check(st => { st.players[0].position = 5; }),
        afterRoll: check(st => { st.turnPhase = 'ROLL'; }),
        broke: check(st => { st.players[0].cash = 50; })
      };
    })()`);
    expect(out.atGate).toBe(true);
    expect(out.notAtGate).toBe(false);
    expect(out.afterRoll).toBe(false);
    expect(out.broke).toBe(false);
    g.close();
  });

  it('serves the time when the player ends the turn at the gate', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.players[0].position = ${GATE};
      st.players[0].pendingJail = true;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 }, () => 0.5);
      const p = res.state.players[0];
      return { inJail: p.inJail, pendingJail: p.pendingJail, position: p.position };
    })()`);
    expect(out.inJail).toBe(true);
    expect(out.pendingJail).toBe(false);
    expect(out.position).toBe(GATE);
    g.close();
  });

  it('keeps the gate only on the Jail tile through a room-state round trip', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const make = (position) => {
        const st = PolyEngine.createInitialState({ roomCode: 'ABC123', hostClientId: 'client_host0001', hostTerm: 1, hostSeatId: 'p1', stateSeq: 1 });
        st.status = 'playing';
        st.players[0].tokenHash = 'aaaaaaaaaaaaaaaa';
        st.players[0].position = position;
        st.players[0].pendingJail = true;
        const clean = PolyEngine.validateRoomState(JSON.parse(JSON.stringify(st)), { roomCode: 'ABC123' });
        return clean ? clean.players[0].pendingJail : null;
      };
      return { onGate: make(${GATE}), elsewhere: make(${GOTOJAIL}) };
    })()`);
    expect(out.onGate).toBe(true);
    expect(out.elsewhere).toBe(false);
    g.close();
  });

  it('shows the bribe button and the serve-time label at the gate', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      const p = gameState.players[0];
      p.position = ${GATE};
      p.pendingJail = true;
      p.inJail = false;
      p.cash = 1500;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-bribe-guard').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-bribe-label').textContent).toBe('Bribe Guard $100 (50%)');
    expect(g.byId('btn-end-label').textContent).toBe('SERVE TIME');
    expect(g.byId('btn-3d-bribe').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-3d-end-label').textContent).toBe('SERVE TIME');
    // The ordinary END controls are not part of a gate decision.
    expect(g.byId('btn-buy-property').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-build-house').classList.contains('hidden')).toBe(true);
    g.close();
  });

  it('swaps the gate bribe for the cell bribe once the roll has failed', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      const p = gameState.players[0];
      p.position = ${GATE};
      p.pendingJail = false;
      p.inJail = true;
      p.jailTurns = 1;
      p.cash = 1500;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-bribe-guard').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-bribe-label').textContent).toBe('Bribe Cell Guard $150');
    expect(g.byId('btn-3d-bribe-label').textContent).toBe('Bribe $150');
    // Bail is a pre-roll choice, so it is not offered after the roll.
    expect(g.byId('btn-pay-bail').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-end-label').textContent).toBe('END TURN');
    g.close();
  });

  it('hides the cell bribe when the cash is short', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      const p = gameState.players[0];
      p.position = ${GATE};
      p.pendingJail = false;
      p.inJail = true;
      p.cash = 120;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-bribe-guard').classList.contains('hidden')).toBe(true);
    g.close();
  });

  it('charges the higher cell price and hands the spent roll back', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      const p = st.players[0];
      p.position = ${GATE};
      p.pendingJail = false;
      p.inJail = true;
      p.jailTurns = 1;
      p.cash = 1500;
      const ok = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, { origin: 'local' }).ok;
      // 0.99 would have failed the gate coin flip; the cell deal is certain.
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, () => 0.99);
      const p2 = res.state.players[0];
      return { ok, cash: p2.cash, inJail: p2.inJail, pendingJail: p2.pendingJail, jailTurns: p2.jailTurns, phase: res.state.turnPhase, turnId: res.state.turnId };
    })()`);
    expect(out.ok).toBe(true);
    expect(out.cash).toBe(1350);
    expect(out.inJail).toBe(false);
    expect(out.pendingJail).toBe(false);
    expect(out.jailTurns).toBe(0);
    expect(out.phase).toBe('ROLL');
    expect(out.turnId).toBe(1);
    g.close();
  });

  it('rejects a cell bribe before the roll, without a failed roll, or without the cash', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const base = () => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnPhase = 'END';
        const p = st.players[0];
        p.position = ${GATE};
        p.pendingJail = false;
        p.inJail = true;
        p.jailTurns = 1;
        p.cash = 1500;
        return st;
      };
      const check = (mutate) => {
        const st = base();
        mutate(st);
        return PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bribe', turnId: 0 }, { origin: 'local' }).ok;
      };
      return {
        inCell: check(() => {}),
        beforeRoll: check(st => { st.turnPhase = 'ROLL'; }),
        // Three doubles, and a botched gate bribe, both land here with no failed roll behind them.
        automatic: check(st => { st.players[0].jailTurns = 0; }),
        broke: check(st => { st.players[0].cash = 100; })
      };
    })()`);
    expect(out.inCell).toBe(true);
    expect(out.beforeRoll).toBe(false);
    expect(out.automatic).toBe(false);
    expect(out.broke).toBe(false);
    g.close();
  });

  it('refuses bail once the roll has failed, so the cell bribe is the only buyout', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      const p = st.players[0];
      p.inJail = true;
      p.cash = 1500;
      const before = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bail', turnId: 0 }, { origin: 'local' }).ok;
      st.turnPhase = 'END';
      const after = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bail', turnId: 0 }, { origin: 'local' }).ok;
      return { before, after };
    })()`);
    expect(out.before).toBe(true);
    expect(out.after).toBe(false);
    g.close();
  });

  it('releases a seat after two served turns and collects the bail', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'ROLL';
      const p = st.players[0];
      p.position = ${GATE};
      p.inJail = true;
      p.jailTurns = 1;
      p.cash = 1500;
      // 3 + 2 = 5 is not doubles; this is the second served turn, so the bail releases them.
      const seq = [${dieValue(3)}, ${dieValue(2)}]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const p2 = res.state.players[0];
      return { cash: p2.cash, inJail: p2.inJail, jailTurns: p2.jailTurns, position: p2.position };
    })()`);
    expect(out.cash).toBe(1450);
    expect(out.inJail).toBe(false);
    expect(out.jailTurns).toBe(0);
    expect(out.position).toBe(GATE + 5);
    g.close();
  });

  it('never lets a skipped turn serve the jail time out', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'ROLL';
      const p = st.players[0];
      p.position = ${GATE};
      p.inJail = true;
      p.jailTurns = 0;
      const first = PolyEngine.skipTurn(st, 'p1', 'timeout').state.players[0];
      const second = PolyEngine.skipTurn(st, 'p1', 'disconnected').state.players[0];
      return { first: first.jailTurns, second: second.jailTurns, inJail: second.inJail };
    })()`);
    expect(out.first).toBe(1);
    expect(out.second).toBe(1);
    expect(out.inJail).toBe(true);
    g.close();
  });

  it('drives the cell bribe through the UI dispatch and reopens the roll', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      const p = gameState.players[0];
      p.position = ${GATE};
      p.pendingJail = false;
      p.inJail = true;
      p.jailTurns = 1;
      p.cash = 1500;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-pay-bail').classList.contains('hidden')).toBe(true);
    g.win.handleBribeGuard();
    await g.settle(0);
    const p = g.state.players[0];
    expect(p.inJail).toBe(false);
    expect(p.cash).toBe(1350);
    expect(g.state.turnPhase).toBe('ROLL');
    g.close();
  });

  it('drives the gate through the UI dispatch and settles the seat', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      const p = gameState.players[0];
      p.position = ${GATE};
      p.pendingJail = true;
      p.cash = 1500;
    })()`);
    g.win.renderAllUI();
    g.win.handleBribeGuard();
    await g.settle(0);
    const p = g.state.players[0];
    expect(p.pendingJail).toBe(false);
    expect(p.cash).toBe(1400);
    g.close();
  });

  it('lets a rich bot bribe and makes a poor bot serve time', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const at = (cash) => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnPhase = 'END';
        const bot = st.players[1];
        bot.position = ${GATE};
        bot.pendingJail = true;
        bot.cash = cash;
        return PolyEngine.botChoice(st, bot.id);
      };
      return { rich: at(2000), poor: at(400) };
    })()`);
    expect(out.rich).toBe('bribe');
    expect(out.poor).toBe('end');
    g.close();
  });

  it('sends a bot out of the cell only when it has already served a roll', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const at = (cash, jailTurns) => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnPhase = 'END';
        const bot = st.players[1];
        bot.position = ${GATE};
        bot.pendingJail = false;
        bot.inJail = true;
        bot.jailTurns = jailTurns;
        bot.cash = cash;
        return PolyEngine.botChoice(st, bot.id);
      };
      return { rich: at(2000, 1), poor: at(400, 1), automatic: at(5000, 0) };
    })()`);
    expect(out.rich).toBe('bribe');
    expect(out.poor).toBe('end');
    expect(out.automatic).toBe('end');
    g.close();
  });

  it('lets a guest bribe through the host in an online room', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await guest.settle(0);
    const gid = guest.ev('myLocalSeatId');
    // Park the guest's seat at the gate and hand it the turn.
    host.win.eval(`(function(){
      const seat = gameState.players.find(p => p.id === ${JSON.stringify(gid)});
      seat.position = ${GATE};
      seat.pendingJail = true;
      seat.inJail = false;
      seat.cash = 1500;
      gameState.turnIndex = gameState.players.findIndex(p => p.id === ${JSON.stringify(gid)});
      gameState.turnPhase = 'END';
      gameState.turnId = (Number(gameState.turnId)||0) + 1;
      gameState.stateSeq = (Number(gameState.stateSeq)||0) + 1;
      lastAccepted = { term: authTerm, seq: gameState.stateSeq };
      broadcastRoomState(gameState, null);
    })()`);
    await guest.settle(0);
    expect(guest.byId('btn-bribe-guard').classList.contains('hidden')).toBe(false);
    guest.win.handleBribeGuard();
    await host.settle(0);
    await guest.settle(0);
    const seat = host.state.players.find(p => p.id === gid);
    expect(seat.pendingJail).toBe(false);
    expect(seat.cash).toBe(1400);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  });

  it('lets a guest buy out of the cell through the host and reopen its roll', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await guest.settle(0);
    const gid = guest.ev('myLocalSeatId');
    // Park the guest's seat in the cell after a failed roll and hand it the turn.
    host.win.eval(`(function(){
      const seat = gameState.players.find(p => p.id === ${JSON.stringify(gid)});
      seat.position = ${GATE};
      seat.pendingJail = false;
      seat.inJail = true;
      seat.jailTurns = 1;
      seat.cash = 1500;
      gameState.turnIndex = gameState.players.findIndex(p => p.id === ${JSON.stringify(gid)});
      gameState.turnPhase = 'END';
      gameState.turnId = (Number(gameState.turnId)||0) + 1;
      gameState.stateSeq = (Number(gameState.stateSeq)||0) + 1;
      lastAccepted = { term: authTerm, seq: gameState.stateSeq };
      broadcastRoomState(gameState, null);
    })()`);
    await guest.settle(0);
    expect(guest.byId('btn-bribe-guard').classList.contains('hidden')).toBe(false);
    expect(guest.byId('btn-bribe-label').textContent).toBe('Bribe Cell Guard $150');
    guest.win.handleBribeGuard();
    await host.settle(0);
    await guest.settle(0);
    const seat = host.state.players.find(p => p.id === gid);
    expect(seat.inJail).toBe(false);
    expect(seat.jailTurns).toBe(0);
    expect(seat.cash).toBe(1350);
    expect(host.state.turnPhase).toBe('ROLL');
    expect(guest.state.turnPhase).toBe('ROLL');
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
  });
});
