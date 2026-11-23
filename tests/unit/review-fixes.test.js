// Covers the rule and room-authority fixes:
//  1. rent/tax opens a raise-funds step; bankruptcy pays only what the seat has, plus deeds
//  2. building needs the full colour set and stays even, including the bot
//  3. an unimproved monopoly doubles base rent
//  4. rent is collected while the owner is in jail
//  5. a deed with houses cannot be mortgaged; houses sell at half cost
//  6. the Ah Long sells houses, then mortgages, then seizes at net-worth value
//  7. a higher host term on the public relay is ignored until a token-proven HOST_CLAIM
import { describe, it, expect } from 'vitest';
import { loadGame, startLocalMatch, makeOnlineRoom, dieValue } from '../helpers/loadGame.js';

describe('bankruptcy and raise funds', () => {
  it('lets a short player mortgage instead of going broke, and pays the creditor only the rent', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.properties[1] = { owner: 'p1', houses: 0, mortgaged: false };
      st.properties[16] = { owner: 'bot_1', houses: 0, mortgaged: false };
      st.players[0].cash = 10;
      st.players[0].position = 11;
      st.players[1].cash = 1500;
      const seq = [${dieValue(2)}, ${dieValue(3)}]; let i = 0;
      let res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const mid = res.state;
      const owed = mid.players[0].obligation;
      res = PolyEngine.applyAction(mid, { seatId: 'p1', kind: 'mortgage', tileId: 1, turnId: mid.turnId });
      const p1 = res.state.players[0];
      const p2 = res.state.players[1];
      gameState.players[0].cash = p1.cash;
      gameState.players[1].cash = p2.cash;
      renderAllUI();
      return {
        phase: mid.turnPhase,
        owed: owed && owed.amount,
        creditorUnchanged: mid.players[1].cash,
        cash: p1.cash,
        creditor: p2.cash,
        mortgaged: Boolean(res.state.properties[1] && res.state.properties[1].mortgaged),
        owner: res.state.properties[1] && res.state.properties[1].owner,
        bankrupt: p1.bankrupt,
        stillOwes: p1.obligation,
        roster: document.getElementById('players-roster-list').textContent
      };
    })()`);
    expect(out.phase).toBe('RAISE');
    expect(out.owed).toBe(14);
    expect(out.creditorUnchanged).toBe(1500);
    expect(out.cash).toBe(26);
    expect(out.creditor).toBe(1514);
    expect(out.mortgaged).toBe(true);
    expect(out.owner).toBe('p1');
    expect(out.bankrupt).toBe(false);
    expect(out.stillOwes).toBeFalsy();
    expect(out.roster).not.toMatch(/\$-/);
    g.close();
  });

  it('bankrupts only when selling and mortgaging cannot cover, and hands the creditor the cash plus the deeds', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.properties[1] = { owner: 'p1', houses: 0, mortgaged: false };
      st.properties[16] = { owner: 'bot_1', houses: 5, mortgaged: false };
      st.players[0].cash = 30;
      st.players[0].position = 11;
      st.players[1].cash = 1500;
      const seq = [${dieValue(2)}, ${dieValue(3)}]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const p1 = res.state.players[0];
      const p2 = res.state.players[1];
      return {
        cash: p1.cash,
        bankrupt: p1.bankrupt,
        creditor: p2.cash,
        deed: res.state.properties[1] ? res.state.properties[1].owner : null,
        phase: res.state.turnPhase
      };
    })()`);
    expect(out.cash).toBe(0);
    expect(out.bankrupt).toBe(true);
    expect(out.creditor).toBe(1530);
    expect(out.deed).toBe('bot_1');
    expect(out.phase).toBe('END');
    g.close();
  });

  it('pays the bank only the cash on hand for a tax the player cannot raise', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.properties[1] = { owner: 'p1', houses: 0, mortgaged: false };
      st.players[0].cash = 50;
      st.players[0].position = 0;
      st.players[1].cash = 1500;
      const seq = [${dieValue(1)}, ${dieValue(3)}]; let i = 0;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      return {
        cash: res.state.players[0].cash,
        bankrupt: res.state.players[0].bankrupt,
        other: res.state.players[1].cash,
        deed: res.state.properties[1] || null,
        pot: res.state.freeParkingPot
      };
    })()`);
    expect(out.cash).toBe(0);
    expect(out.bankrupt).toBe(true);
    expect(out.other).toBe(1500);
    expect(out.deed).toBeNull();
    expect(out.pot).toBe(50);
    g.close();
  });

  it('sells a house at half cost to cover the rent', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.properties[1] = { owner: 'p1', houses: 1, mortgaged: false };
      st.properties[3] = { owner: 'p1', houses: 0, mortgaged: false };
      st.properties[16] = { owner: 'bot_1', houses: 0, mortgaged: false };
      st.players[0].cash = 0;
      st.players[0].position = 11;
      const seq = [${dieValue(2)}, ${dieValue(3)}]; let i = 0;
      let res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const raised = res.state.turnPhase;
      res = PolyEngine.applyAction(res.state, { seatId: 'p1', kind: 'sellhouse', tileId: 1, turnId: res.state.turnId });
      const p = res.state.players[0];
      return {
        phase: raised,
        cash: p.cash,
        houses: res.state.properties[1].houses,
        creditor: res.state.players[1].cash,
        bankrupt: p.bankrupt
      };
    })()`);
    expect(out.phase).toBe('RAISE');
    expect(out.cash).toBe(11);
    expect(out.houses).toBe(0);
    expect(out.creditor).toBe(1514);
    expect(out.bankrupt).toBe(false);
    g.close();
  });

  it('keeps a doubles roll waiting until the debt is paid', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.properties[1] = { owner: 'p1', houses: 0, mortgaged: false };
      st.properties[16] = { owner: 'bot_1', houses: 0, mortgaged: false };
      st.players[0].cash = 0;
      st.players[0].position = 12;
      const seq = [${dieValue(2)}, ${dieValue(2)}]; let i = 0;
      let res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'roll', turnId: 0 }, () => seq[i++]);
      const mid = { phase: res.state.turnPhase, extra: res.state.players[0].pendingExtraRoll, doubles: res.state.doublesCount };
      res = PolyEngine.applyAction(res.state, { seatId: 'p1', kind: 'mortgage', tileId: 1, turnId: res.state.turnId });
      return { mid, phase: res.state.turnPhase, doubles: res.state.doublesCount, cash: res.state.players[0].cash };
    })()`);
    expect(out.mid.phase).toBe('RAISE');
    expect(out.mid.extra).toBe(true);
    expect(out.mid.doubles).toBe(0);
    expect(out.phase).toBe('ROLL');
    expect(out.doubles).toBe(1);
    expect(out.cash).toBe(16);
    g.close();
  });
});

describe('building, rent and jail', () => {
  it('refuses a build without the colour set and without an even build', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const bare = PolyEngine.createInitialState();
      bare.status = 'playing';
      bare.turnPhase = 'END';
      bare.properties[1] = { owner: 'p1', houses: 0, mortgaged: false };
      const set = PolyEngine.createInitialState();
      set.status = 'playing';
      set.turnPhase = 'END';
      set.properties[1] = { owner: 'p1', houses: 1, mortgaged: false };
      set.properties[3] = { owner: 'p1', houses: 0, mortgaged: false };
      const v = (st, tileId) => PolyEngine.validateAction(st, { seatId: 'p1', kind: 'build', tileId, turnId: 0 }, { origin: 'local' }).ok;
      const res = PolyEngine.applyAction(set, { seatId: 'p1', kind: 'build', tileId: 3, turnId: 0 });
      return {
        alone: v(bare, 1),
        uneven: v(set, 1),
        even: v(set, 3),
        houses: res.state.properties[3].houses
      };
    })()`);
    expect(out.alone).toBe(false);
    expect(out.uneven).toBe(false);
    expect(out.even).toBe(true);
    expect(out.houses).toBe(1);
    g.close();
  });

  it('stops the bot building outside a monopoly and points it at the even deed', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const kindOf = (choice) => typeof choice === 'string' ? choice : (choice && choice.kind);
      const tileOf = (choice) => choice && typeof choice === 'object' ? choice.tileId : null;
      const alone = PolyEngine.createInitialState();
      alone.status = 'playing';
      alone.turnPhase = 'END';
      alone.turnIndex = 1;
      alone.players[1].position = 1;
      alone.players[1].cash = 5000;
      alone.properties[1] = { owner: 'bot_1', houses: 0, mortgaged: false };
      const set = PolyEngine.createInitialState();
      set.status = 'playing';
      set.turnPhase = 'END';
      set.turnIndex = 1;
      set.players[1].cash = 5000;
      set.properties[1] = { owner: 'bot_1', houses: 1, mortgaged: false };
      set.properties[3] = { owner: 'bot_1', houses: 0, mortgaged: false };
      const a = PolyEngine.botChoice(alone, 'bot_1');
      const b = PolyEngine.botChoice(set, 'bot_1');
      return { alone: kindOf(a), evenKind: kindOf(b), evenTile: tileOf(b) };
    })()`);
    expect(out.alone).not.toBe('build');
    expect(out.evenKind).toBe('build');
    expect(out.evenTile).toBe(3);
    g.close();
  });

  it('doubles unimproved rent only for a full unmortgaged colour set', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const roll = (setup) => {
        const st = PolyEngine.createInitialState();
        st.status = 'playing';
        st.turnIndex = 1;
        st.players[1].position = 11;
        st.players[1].isBot = false;
        setup(st);
        const seq = [${dieValue(2)}, ${dieValue(3)}]; let i = 0;
        const res = PolyEngine.applyAction(st, { seatId: 'bot_1', kind: 'roll', turnId: 0 }, () => seq[i++]);
        return res.state.players[0].cash - 1500;
      };
      const own = (st, houses, mortgagedId) => {
        [16, 18, 19].forEach(id => { st.properties[id] = { owner: 'p1', houses: houses[id] || 0, mortgaged: id === mortgagedId }; });
      };
      return {
        single: roll(st => { st.properties[16] = { owner: 'p1', houses: 0, mortgaged: false }; }),
        monopoly: roll(st => own(st, {}, null)),
        house: roll(st => own(st, { 16: 1 }, null)),
        mortgaged: roll(st => own(st, {}, 18)),
        siblingHouse: roll(st => own(st, { 18: 1 }, null)),
        jailed: roll(st => { st.players[0].inJail = true; st.properties[16] = { owner: 'p1', houses: 0, mortgaged: false }; })
      };
    })()`);
    expect(out.single).toBe(14);
    expect(out.monopoly).toBe(28);
    expect(out.house).toBe(70);
    expect(out.mortgaged).toBe(14);
    expect(out.siblingHouse).toBe(28);
    expect(out.jailed).toBe(14);
    g.close();
  });
});

describe('sell houses and the Ah Long', () => {
  it('refuses a mortgage while houses stand and sells a house at half cost', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.properties[39] = { owner: 'p1', houses: 5, mortgaged: false };
      st.properties[37] = { owner: 'p1', houses: 0, mortgaged: false };
      const v = (kind, tileId) => PolyEngine.validateAction(st, { seatId: 'p1', kind, tileId, turnId: 0 }, { origin: 'local' }).ok;
      const blocked = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'mortgage', tileId: 39, turnId: 0 });
      const sold = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'sellhouse', tileId: 39, turnId: 0 });
      return {
        mortgageHotel: v('mortgage', 39),
        mortgageSibling: v('mortgage', 37),
        sell: v('sellhouse', 39),
        stayed: blocked.state.properties[39].mortgaged,
        hotelLeft: blocked.state.properties[39].houses,
        cash: sold.state.players[0].cash,
        houses: sold.state.properties[39].houses
      };
    })()`);
    expect(out.mortgageHotel).toBe(false);
    expect(out.mortgageSibling).toBe(false);
    expect(out.sell).toBe(true);
    expect(out.stayed).toBe(false);
    expect(out.hotelLeft).toBe(5);
    expect(out.cash).toBe(1600);
    expect(out.houses).toBe(4);
    g.close();
  });

  it('shows a sell-house control and hides mortgage while the hotel is standing', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    g.win.eval(`(function(){
      gameState.turnPhase = 'END';
      gameState.turnIndex = 0;
      gameState.properties[39] = { owner: 'p1', houses: 5, mortgaged: false };
      gameState.properties[37] = { owner: 'p1', houses: 0, mortgaged: false };
      selectTileInspector(39);
    })()`);
    const html = g.byId('tile-inspector-panel').innerHTML;
    expect(html).toContain('Sell (+$100)');
    expect(html).not.toContain('Mortgage');
    g.win.handleSellHouse(39);
    await g.settle(0);
    expect(g.state.properties[39].houses).toBe(4);
    expect(g.state.players[0].cash).toBe(1600);
    g.close();
  });

  it('sells the KLCC hotel down before it mortgages or seizes it', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState();
      st.status = 'playing';
      st.turnPhase = 'END';
      st.properties[39] = { owner: 'p1', houses: 5, mortgaged: false };
      const p = st.players[0];
      p.cash = 0;
      p.debt = 400;
      p.debtDueIn = 1;
      const res = PolyEngine.applyAction(st, { seatId: 'p1', kind: 'end', turnId: 0 });
      const prop = res.state.properties[39];
      return {
        houses: prop ? prop.houses : null,
        mortgaged: prop ? prop.mortgaged : null,
        owner: prop ? prop.owner : null,
        cash: res.state.players[0].cash,
        debt: res.state.players[0].debt,
        bankrupt: res.state.players[0].bankrupt
      };
    })()`);
    expect(out.houses).toBe(1);
    expect(out.mortgaged).toBe(false);
    expect(out.owner).toBe('p1');
    expect(out.cash).toBe(0);
    expect(out.debt).toBe(0);
    expect(out.bankrupt).toBe(false);
    g.close();
  });
});

describe('host takeover', () => {
  it('ignores a higher host term until the sender proves the seat token', async () => {
    const { host, guests } = await makeOnlineRoom({ guests: 1 });
    const guest = guests[0];
    await host.win.startMatchFromLobby();
    await host.settle(0);
    await guest.settle(0);
    expect(host.state.status).toBe('playing');
    const gid = guest.ev('myLocalSeatId');
    const gclient = guest.ev('myClientUniqueId');
    const token = guest.ev('mySeatToken');
    const seat = host.state.players.find(p => p.id === gid);
    expect(seat).toBeTruthy();
    expect(seat.tokenHash).toBe(host.win.PolyEngine.fnv1a64(token));
    const beforeTerm = host.state.hostTerm;
    const beforeCash = seat.cash;

    const attacker = JSON.parse(JSON.stringify(host.state));
    attacker.hostTerm = beforeTerm + 4;
    attacker.hostClientId = 'client_attacker_takeover';
    attacker.hostSeatId = gid;
    attacker.stateSeq = (host.state.stateSeq || 1) + 3;
    attacker.players.forEach(p => { if (p.id === gid) p.cash = 999999; });
    expect(host.win.PolyEngine.validateRoomState(attacker, { roomCode: host.state.roomCode })).not.toBeNull();
    host.win.handleIncomingRoomPacket({
      type: 'ROOM_STATE', senderClientId: 'client_attacker_takeover', roomCode: host.state.roomCode,
      state: attacker, msgId: 'atk-state'
    });
    await host.settle(0);
    expect(host.ev('isRoomHost')).toBe(true);
    expect(host.state.hostTerm).toBe(beforeTerm);
    expect(host.state.players.find(p => p.id === gid).cash).toBe(beforeCash);

    host.win.handleIncomingRoomPacket({
      type: 'HOST_CLAIM', senderClientId: 'client_attacker_takeover', hostTerm: beforeTerm + 4,
      seatId: gid, seatToken: '00'.repeat(16), stateSeq: 1, roomCode: host.state.roomCode, msgId: 'atk-claim'
    });
    await host.settle(0);
    expect(host.ev('authTerm')).toBe(beforeTerm);
    expect(host.state.players.find(p => p.id === gid).cash).toBe(beforeCash);

    const legit = JSON.parse(JSON.stringify(host.state));
    const term = beforeTerm + 1;
    legit.hostTerm = term;
    legit.hostClientId = gclient;
    legit.hostSeatId = gid;
    legit.stateSeq = (host.state.stateSeq || 1) + 1;
    legit.players.forEach(p => { if (p.id === gid) p.cash = 4321; });
    host.win.handleIncomingRoomPacket({
      type: 'ROOM_STATE', senderClientId: gclient, roomCode: host.state.roomCode,
      state: legit, msgId: 'legit-state'
    });
    await host.settle(0);
    expect(host.state.players.find(p => p.id === gid).cash).toBe(beforeCash);

    host.win.handleIncomingRoomPacket({
      type: 'HOST_CLAIM', senderClientId: gclient, hostTerm: term, seatId: gid,
      seatToken: token, stateSeq: host.state.stateSeq, roomCode: host.state.roomCode, msgId: 'legit-claim'
    });
    await host.settle(200);
    expect(host.ev('authTerm')).toBe(term);
    expect(host.ev('authHostClientId')).toBe(gclient);
    expect(host.state.players.find(p => p.id === gid).cash).toBe(4321);
    host.close();
    guest.close();
  });

  it('keeps a raise-funds obligation through a room-state round trip', async () => {
    const g = await loadGame();
    const out = g.win.eval(`(function(){
      const st = PolyEngine.createInitialState({ roomCode: 'ABC123', hostClientId: 'client_host0001', hostTerm: 1, hostSeatId: 'p1', stateSeq: 1 });
      st.status = 'playing';
      st.turnPhase = 'RAISE';
      st.players[0].tokenHash = 'aaaaaaaaaaaaaaaa';
      st.players[0].cash = -990;
      st.players[0].obligation = { amount: 40, to: 'bot_1', kind: 'rent', tileName: 'Batu Ferringhi' };
      st.players[0].pendingExtraRoll = true;
      const clean = PolyEngine.validateRoomState(JSON.parse(JSON.stringify(st)), { roomCode: 'ABC123' });
      return clean && { phase: clean.turnPhase, cash: clean.players[0].cash, obligation: clean.players[0].obligation, extra: clean.players[0].pendingExtraRoll };
    })()`);
    expect(out.phase).toBe('RAISE');
    expect(out.cash).toBe(0);
    expect(out.obligation).toEqual({ amount: 40, to: 'bot_1', kind: 'rent', tileName: 'Batu Ferringhi' });
    expect(out.extra).toBe(true);
    g.close();
  });
});

describe('local match', () => {
  it('plays several turns against a bot with no negative cash and no console errors', async () => {
    const g = await loadGame();
    await startLocalMatch(g, ['human', 'bot']);
    const startTurn = g.state.turnId;
    for (let n = 0; n < 8; n++) {
      if (g.state.winnerId) break;
      const st = g.state;
      const p = st.players[st.turnIndex % st.players.length];
      if (p.isBot) {
        g.win.scheduleBotTurn();
        await g.settle(5000);
      } else if (st.turnPhase === 'ROLL') {
        g.win.handleRollDice();
        await g.settle(4000);
      } else if (st.turnPhase === 'RAISE') {
        const tileId = g.win.eval(`(function(){
          const me = getCurrentPlayer();
          for (const t of BOARD_TILES) {
            if (PolyEngine.validateAction(gameState, { seatId: me.id, kind: 'sellhouse', tileId: t.id, turnId: gameState.turnId }, { origin: 'local' }).ok) return t.id;
          }
          for (const t of BOARD_TILES) {
            const prop = gameState.properties[t.id];
            if (prop && !prop.mortgaged && PolyEngine.validateAction(gameState, { seatId: me.id, kind: 'mortgage', tileId: t.id, turnId: gameState.turnId }, { origin: 'local' }).ok) return t.id + 1000;
          }
          return -1;
        })()`);
        if (tileId >= 1000) g.win.dispatchSeatAction('mortgage', tileId - 1000);
        else if (tileId >= 0) g.win.dispatchSeatAction('sellhouse', tileId);
        else g.win.handleBorrowAhLong();
        await g.settle(800);
      } else {
        g.win.handleEndTurn();
        await g.settle(5000);
      }
      expect(g.state.players.every(pl => pl.cash >= 0)).toBe(true);
    }
    expect(g.state.turnId).not.toBe(startTurn);
    expect(g.errors).toEqual([]);
    g.close();
  });
});
