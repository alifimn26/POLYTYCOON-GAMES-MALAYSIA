// Covers the money scale that arrives with the wider starting-cash range:
//  - scaledCash quotes every flat amount against the table's starting cash (1500 is the no-op baseline)
//  - tax, GO salary, bail, Chance/Chest payouts and the Ah Long loan all move with it
//  - the lobby offers the new starts and keeps the select in sync
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch } from '../helpers/loadGame.js';

describe('economy scale', () => {
  it('scales a flat amount with the starting cash and is a no-op at the 1500 baseline', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const at = (cash, amount) => PolyEngine.scaledCash(PolyEngine.createInitialState({ startingCash: cash }), amount);
      return {
        baseline: at(1500, 200),
        poor: at(500, 200),
        rich: at(5000, 200),
        poorFine: at(500, -50),
        tinyFine: at(500, -10),
        zero: at(5000, 0),
        offList: at(1234, 200)
      };
    })()`);
    expect(out.baseline).toBe(200);
    expect(out.poor).toBe(70);
    expect(out.rich).toBe(670);
    expect(out.poorFine).toBe(-20);
    expect(out.tinyFine).toBe(-10);
    expect(out.zero).toBe(0);
    expect(out.offList).toBe(200);
    g.close();
  });

  it('charges tax from the scaled table, not the printed board amount', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ startingCash: 5000 });
      st.status = 'playing';
      st.players[0].position = 0;
      const seq = [0.05, 0.42]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      return { pos: res.state.players[0].position, cash: res.state.players[0].cash };
    })()`);
    expect(out.pos).toBe(4);
    expect(out.cash).toBe(5000 - 670);
    g.close();
  });

  it('pays a scaled GO salary on a poor table', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ startingCash: 500 });
      st.status = 'playing';
      st.rules.doubleOnGo = false;
      st.players[0].position = 36;
      const seq = [0.05, 0.42]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      return { pos: res.state.players[0].position, cash: res.state.players[0].cash };
    })()`);
    expect(out.pos).toBe(0);
    expect(out.cash).toBe(500 + 70);
    g.close();
  });

  it('scales a Chance/Chest payout to the table', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const draw = (cash) => {
        const st = PolyEngine.createInitialState({ startingCash: cash });
        st.status = 'playing';
        st.players[0].position = 0;
        // 1 + 1 = 2 onto Tabung Kebajikan; the third roll picks card #0 (LHDN Tax Refund, +100).
        const seq = [0.05, 0.05, 0.05]; let i = 0;
        const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
        return res.state.players[0].cash;
      };
      return { baseline: draw(1500), rich: draw(5000) };
    })()`);
    expect(out.baseline).toBe(1600);
    expect(out.rich).toBe(5000 + 330);
    g.close();
  });

  it('requires and charges the scaled bail', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ startingCash: 5000 });
      st.status = 'playing';
      st.players[0].inJail = true;
      st.players[0].jailTurns = 0;
      st.players[0].cash = 100;
      const lowOk = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bail', turnId: 0 }, { origin: 'local' }).ok;
      st.players[0].cash = 170;
      const okOk = PolyEngine.validateAction(st, { seatId: 'p1', kind: 'bail', turnId: 0 }, { origin: 'local' }).ok;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'bail', turnId: 0 });
      const p = res.state.players[0];
      return { lowOk, okOk, cash: p.cash, inJail: p.inJail };
    })()`);
    expect(out.lowOk).toBe(false);
    expect(out.okOk).toBe(true);
    expect(out.cash).toBe(0);
    expect(out.inJail).toBe(false);
    g.close();
  });

  it('quotes the Ah Long loan, debt and gate against the table', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const rich = PolyEngine.createInitialState({ startingCash: 5000 });
      rich.status = 'playing';
      rich.players[0].cash = 1000;
      const gateAt1000 = PolyEngine.validateAction(rich, { seatId: 'p1', kind: 'borrow', turnId: 0 }, { origin: 'local' }).ok;
      rich.players[0].cash = 900;
      const gateAt900 = PolyEngine.validateAction(rich, { seatId: 'p1', kind: 'borrow', turnId: 0 }, { origin: 'local' }).ok;
      const rp = PolyEngine.applyAction(rich, { seatId: 'p1', kind: 'borrow', turnId: 0 }).state.players[0];

      const poor = PolyEngine.createInitialState({ startingCash: 500 });
      poor.status = 'playing';
      poor.players[0].cash = 90;
      const pp = PolyEngine.applyAction(poor, { seatId: 'p1', kind: 'borrow', turnId: 0 }).state.players[0];
      return { gateAt1000, gateAt900, cash: rp.cash, debt: rp.debt, lowCash: pp.cash, lowDebt: pp.debt };
    })()`);
    expect(out.gateAt1000).toBe(false);
    expect(out.gateAt900).toBe(true);
    expect(out.cash).toBe(900 + 3330);
    expect(out.debt).toBe(4330);
    expect(out.lowCash).toBe(90 + 330);
    expect(out.lowDebt).toBe(430);
    g.close();
  });

  it('offers $500-$5000 in the lobby and keeps the select in sync', async () => {
    const g = await loadGame();
    const opts = [...g.byId('rule-starting-cash').options].map(o => Number(o.value));
    expect(opts).toEqual([500, 750, 1000, 1500, 2000, 3000, 5000]);

    g.win.updateHouseRule('startingCash', 3000);
    g.win.renderStartMenuUI();
    expect(g.byId('rule-starting-cash').value).toBe('3000');
    expect(g.state.rules.startingCash).toBe(3000);
    expect(g.state.players.every(p => p.cash === 3000)).toBe(true);
    g.close();
  });

  it('shows the scaled bail and loan amounts on the buttons', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnIndex = 0;
      gameState.turnPhase = 'END';
      gameState.rules.startingCash = 5000;
      const p = gameState.players[0];
      p.inJail = true;
      p.cash = 900;
    })()`);
    g.win.renderAllUI();
    expect(g.byId('btn-bail-label').textContent).toBe('Pay $170 Bail');
    expect(g.byId('btn-pay-bail').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-borrow-ahlong-label').textContent).toBe('Borrow $3330 from Ah Long');
    expect(g.byId('btn-borrow-ahlong').classList.contains('hidden')).toBe(false);
    expect(g.byId('btn-3d-borrow-label').textContent).toBe('Ah Long +$3330');
    g.close();
  });

  it('shows the scaled tax on the tile inspector instead of the printed amount', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const taxId = g.win.eval(`MAP_THEMES.malaysia.tiles.find(t => t.type === 'tax').id`);
    g.win.eval(`gameState.rules.startingCash = 3000;`);
    g.win.selectTileInspector(taxId);
    const text = g.byId('tile-inspector-panel').textContent;
    expect(text).toContain('Tax due');
    expect(text).toContain('$400');
    expect(text).not.toContain('$200');
    g.close();
  });

  it('clamps an unlisted starting cash on the wire', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const make = (cash) => {
        const st = PolyEngine.createInitialState({ roomCode: 'ABC123', hostClientId: 'client_host0001', hostTerm: 1, hostSeatId: 'p1', stateSeq: 1 });
        st.status = 'playing';
        st.players[0].tokenHash = 'aaaaaaaaaaaaaaaa';
        st.rules.startingCash = cash;
        const clean = PolyEngine.validateRoomState(JSON.parse(JSON.stringify(st)), { roomCode: 'ABC123' });
        return clean ? clean.rules.startingCash : null;
      };
      return { listed: make(3000), unlisted: make(1234) };
    })()`);
    expect(out.listed).toBe(3000);
    expect(out.unlisted).toBe(1500);
    g.close();
  });
});
