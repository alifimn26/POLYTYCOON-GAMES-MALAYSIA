// Covers the Ah Long loan shark:
//  - the near-broke gate (one loan at a time, only while cash is low, can be switched off)
//  - the interest applied on top of the principal
//  - repayment clearing the debt
//  - the deadline ticking down and the collection that fires when it lands
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch, makeOnlineRoom } from '../helpers/loadGame.js';

describe('ah long loans', () => {
  it('lets a near-broke player borrow and records principal + interest', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.players[0].cash = 100;
      const v = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'borrow', turnId: 0 }, { origin: 'local' });
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'borrow', turnId: 0 });
      const p = res.state.players[0];
      return { ok: v.ok, cash: p.cash, debt: p.debt, due: p.debtDueIn };
    })()`);
    expect(out.ok).toBe(true);
    expect(out.cash).toBe(1100);
    expect(out.debt).toBe(1300);
    expect(out.due).toBe(4);
    g.close();
  });

  it('refuses a loan when the player is not broke, already owes, or the rule is off', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const rich = PolyEngine.createInitialState();
      rich.status = 'playing';
      rich.players[0].cash = 1500;
      const owing = PolyEngine.createInitialState();
      owing.status = 'playing';
      owing.players[0].cash = 50;
      owing.players[0].debt = 1300;
      owing.players[0].debtDueIn = 3;
      const disabled = PolyEngine.createInitialState();
      disabled.status = 'playing';
      disabled.players[0].cash = 50;
      disabled.rules.ahlongEnabled = false;
      const v = (st) => PolyEngine.validateAction(st, { seatId: 'p1', kind: 'borrow', turnId: 0 }, { origin: 'local' }).ok;
      return { rich: v(rich), owing: v(owing), disabled: v(disabled) };
    })()`);
    expect(out.rich).toBe(false);
    expect(out.owing).toBe(false);
    expect(out.disabled).toBe(false);
    g.close();
  });

  it('clears the debt when repaid, and rejects repayment the player cannot cover', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.players[0].cash = 1400;
      st.players[0].debt = 1300;
      st.players[0].debtDueIn = 2;
      const v = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'repay', turnId: 0 }, { origin: 'local' });
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'repay', turnId: 0 });
      const p = res.state.players[0];

      const short = PolyEngine.createInitialState();
      short.status = 'playing';
      short.players[0].cash = 10;
      short.players[0].debt = 1300;
      const shortOk = PolyEngine.validateAction(short, { seatId: 'p1', kind: 'repay', turnId: 0 }, { origin: 'local' }).ok;
      return { ok: v.ok, cash: p.cash, debt: p.debt, due: p.debtDueIn, shortOk };
    })()`);
    expect(out.ok).toBe(true);
    expect(out.cash).toBe(100);
    expect(out.debt).toBe(0);
    expect(out.due).toBe(0);
    expect(out.shortOk).toBe(false);
    g.close();
  });

  it('counts the deadline down, then collects cash and bankrupts an empty debtor', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      const p = st.players[0];
      p.cash = 100;
      p.debt = 1300;
      p.debtDueIn = 2;
      let res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 });
      const afterFirst = { debt: res.state.players[0].debt, due: res.state.players[0].debtDueIn, cash: res.state.players[0].cash, bankrupt: res.state.players[0].bankrupt };
      res = PolyEngine.applyAction(res.state, { seatId: 'p1', kind: 'end', turnId: res.state.turnId });
      const q = res.state.players[0];
      return { afterFirst, cash: q.cash, debt: q.debt, due: q.debtDueIn, bankrupt: q.bankrupt };
    })()`);
    expect(out.afterFirst.debt).toBe(1300);
    expect(out.afterFirst.due).toBe(1);
    expect(out.afterFirst.cash).toBe(100);
    expect(out.afterFirst.bankrupt).toBe(false);
    expect(out.cash).toBe(0);
    expect(out.debt).toBe(0);
    expect(out.due).toBe(0);
    expect(out.bankrupt).toBe(true);
    g.close();
  });

  it('seizes the cheapest deed that covers the debt and spares the pricier one', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      const tiles = MAP_THEMES.malaysia.tiles;
      const props = tiles.map((t, i) => ({ t, i })).filter(x => x.t.type === 'property').sort((a, b) => a.t.price - b.t.price);
      const cheap = props[0].i;
      const pricey = props[props.length - 1].i;
      st.properties[cheap] = { owner: 'p1', houses: 0, mortgaged: false };
      st.properties[pricey] = { owner: 'p1', houses: 0, mortgaged: false };
      const p = st.players[0];
      p.cash = 0;
      p.debt = tiles[cheap].price;
      p.debtDueIn = 1;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 });
      return {
        hasCheap: Boolean(res.state.properties[cheap]),
        hasPricey: Boolean(res.state.properties[pricey]),
        debt: res.state.players[0].debt,
        bankrupt: res.state.players[0].bankrupt
      };
    })()`);
    expect(out.hasCheap).toBe(false);
    expect(out.hasPricey).toBe(true);
    expect(out.debt).toBe(0);
    expect(out.bankrupt).toBe(false);
    g.close();
  });

  it('carries debt and the rule through a room-state round trip', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ roomCode: 'ABC123', hostClientId: 'client_host0001', hostTerm: 1, hostSeatId: 'p1', stateSeq: 1 });
      st.status = 'playing';
      st.players[0].tokenHash = 'aaaaaaaaaaaaaaaa';
      st.players[0].debt = 1300;
      st.players[0].debtDueIn = 3;
      const clean = PolyEngine.validateRoomState(JSON.parse(JSON.stringify(st)), { roomCode: 'ABC123' });
      return clean ? { debt: clean.players[0].debt, due: clean.players[0].debtDueIn, rule: clean.rules.ahlongEnabled } : null;
    })()`);
    expect(out).not.toBeNull();
    expect(out.debt).toBe(1300);
    expect(out.due).toBe(3);
    expect(out.rule).toBe(true);
    g.close();
  });

  it('shows borrow only while broke and repay only once the debt is affordable', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      gameState.players[0].cash = 50;
      gameState.players[0].debt = 0;
      gameState.players[0].debtDueIn = 0;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-borrow-ahlong').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-repay-ahlong').classList.contains('hidden')).toBe(true);

    g.win.dispatchSeatAction('borrow');
    await g.settle(0);
    expect(g.state.players[0].cash).toBe(1050);
    expect(g.state.players[0].debt).toBe(1300);
    // Cash is still below the debt, so repay stays hidden.
    g.win.renderAllUI();
    expect(g.byId('btn-borrow-ahlong').classList.contains('hidden')).toBe(true);
    expect(g.byId('btn-repay-ahlong').classList.contains('hidden')).toBe(true);

    g.win.eval(`gameState.players[0].cash = 2000;`);
    g.win.renderAllUI();
    expect(g.byId('btn-repay-ahlong').classList.contains('hidden')).toBe(false);
    g.win.dispatchSeatAction('repay');
    await g.settle(0);
    expect(g.state.players[0].debt).toBe(0);
    expect(g.state.players[0].cash).toBe(700);
    g.close();
  });

  it('lets an online guest borrow through the host', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await guest.settle(0);
    const gid = guest.ev('myLocalSeatId');
    host.win.eval(`(function(){
      const st = gameState;
      const p = st.players.find(x => x.id === ${JSON.stringify(gid)});
      p.cash = 100;
      st.turnIndex = st.players.findIndex(x => x.id === ${JSON.stringify(gid)});
      st.turnPhase = 'ROLL';
      st.turnId = (Number(st.turnId) || 0) + 1;
      st.stateSeq = (Number(st.stateSeq) || 0) + 1;
      lastAccepted = { term: authTerm, seq: st.stateSeq };
      broadcastRoomState(st, null);
    })()`);
    await guest.settle(0);
    guest.win.dispatchSeatAction('borrow');
    await host.settle(2000);
    await guest.settle(2000);
    const gp = host.state.players.find(p => p.id === gid);
    expect(gp.cash).toBe(1100);
    expect(gp.debt).toBe(1300);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    host.close();
    guest.close();
  });
});
