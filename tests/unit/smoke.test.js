import { describe, it, expect } from 'vitest';
import { loadGame } from '../helpers/loadGame.js';

describe('page load smoke', () => {
  it('loads, renders roster and dice, and logs no errors', async () => {
    const g = await loadGame();
    expect(g.errors).toEqual([]);
    expect(g.doc.querySelectorAll('#players-roster-list > div').length).toBe(2);
    expect(g.doc.querySelectorAll('#die-face-1 .pip-dot').length).toBe(9);
    expect(g.doc.querySelectorAll('#board-2d-grid .board-tile').length).toBe(40);
    expect(g.state.players.length).toBe(2);
    g.close();
  });

  it('keeps every inline handler name defined as a global function', async () => {
    const g = await loadGame();
    const names = new Set();
    g.doc.querySelectorAll('[onclick],[onchange],[oninput]').forEach(el => {
      ['onclick', 'onchange', 'oninput'].forEach(a => {
        const v = el.getAttribute(a);
        if (v) for (const m of v.matchAll(/([A-Za-z_]\w*)\s*\(/g)) names.add(m[1]);
      });
    });
    const missing = [...names].filter(n => !['Number', 'String', 'event'].includes(n) && typeof g.win[n] !== 'function');
    expect(missing).toEqual([]);
    g.close();
  });
});
