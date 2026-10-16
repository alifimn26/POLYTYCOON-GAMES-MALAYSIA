// Covers the two rules fixed in this pass:
//  - doubles grants another roll, and a third doubles in a row goes to Jail (doublesCount was dead before)
//  - build and mortgage require the END phase, like buy and end
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch } from '../helpers/loadGame.js';

// Rolls doubles (each die = 2) onto an unowned property so nothing else fires.
const ROLL_DOUBLES = `(function(){
  const st = PolyEngine.createInitialState();
  st.status = 'playing';
  const tiles = MAP_THEMES.malaysia.tiles;
  const land = tiles.findIndex(t => t.type === 'property');
  st.players[0].position = (land - 4 + tiles.length) % tiles.length;
  const rng = () => 0.25;
  const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, rng);
  return { phase: res.state.turnPhase, doubles: res.state.doublesCount, pos: res.state.players[0].position, turnId: res.state.turnId, land };
})()`;

describe('turn rules', () => {
  it('grants another roll and keeps the turn on doubles', async () => {
    const g = await loadGame();
    const out = g.win.eval(ROLL_DOUBLES);
    expect(out.pos).toBe(out.land);
    expect(out.phase).toBe('ROLL');
    expect(out.doubles).toBe(1);
    expect(out.turnId).toBe(1);
    g.close();
  });

  it('ends the turn and clears the streak on a non-doubles roll', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.doublesCount = 1;
      const tiles = MAP_THEMES.malaysia.tiles;
      const land = tiles.findIndex(t => t.type === 'property');
      st.players[0].position = (land - 5 + tiles.length) % tiles.length;
      const seq = [0.1, 0.5]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      return { phase: res.state.turnPhase, doubles: res.state.doublesCount };
    })()`);
    expect(out.phase).toBe('END');
    expect(out.doubles).toBe(0);
    g.close();
  });

  it('sends a third doubles in a row to Jail without moving', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.doublesCount = 2;
      const tiles = MAP_THEMES.malaysia.tiles;
      const land = tiles.findIndex(t => t.type === 'property');
      st.players[0].position = (land - 4 + tiles.length) % tiles.length;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => 0.25);
      const p = res.state.players[0];
      return { phase: res.state.turnPhase, doubles: res.state.doublesCount, pos: p.position, inJail: p.inJail };
    })()`);
    expect(out.pos).toBe(10);
    expect(out.inJail).toBe(true);
    expect(out.phase).toBe('END');
    expect(out.doubles).toBe(0);
    g.close();
  });

  it('rejects build and mortgage before the roll, allows build after it', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const tiles = MAP_THEMES.malaysia.tiles;
      const tid = tiles.findIndex(t => t.type === 'property');
      const make = (phase) => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnPhase = phase;
        st.properties[tid] = { owner: 'p1', houses: 0, mortgaged: false };
        return st;
      };
      const v = (phase) => PolyEngine.validateAction(make(phase), { seatId: 'p1', kind: 'build', tileId: tid, turnId: 0 }, { origin: 'local' }).ok;
      const m = (phase) => PolyEngine.validateAction(make(phase), { seatId: 'p1', kind: 'mortgage', tileId: tid, turnId: 0 }, { origin: 'local' }).ok;
      return { buildRoll: v('ROLL'), mortgageRoll: m('ROLL'), buildEnd: v('END') };
    })()`);
    expect(out.buildRoll).toBe(false);
    expect(out.mortgageRoll).toBe(false);
    expect(out.buildEnd).toBe(true);
    g.close();
  });

  it('drives an AI bot through its turn', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const botId = g.state.players.find(p => p.isBot).id;
    g.win.eval(`(function(){
      gameState.turnIndex = gameState.players.findIndex(p => p.isBot);
      gameState.turnPhase = 'ROLL';
      gameState.turnId = (Number(gameState.turnId)||0) + 1;
      scheduleBotTurn();
    })()`);
    await g.settle(3000);
    expect(g.state.players.find(p => p.id === botId).position).not.toBe(0);
    g.close();
  });
});
