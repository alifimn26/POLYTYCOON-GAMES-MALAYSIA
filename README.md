# PolyTycoon

A Malaysian Monopoly-style board game in one static file (`index.html`). Play locally against bots, pass-and-play on the same screen, or online with friends over PeerJS with a public MQTT relay.

**Play:** https://alifimn26.github.io/POLYTYCOON-GAMES-MALAYSIA/

## Run locally

Open `index.html` in a browser, or serve this folder:

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080/

## Tests

```bash
npm install
npm run test:unit
```

`npm run test:unit` runs the Vitest suite in `tests/unit`.

## Styles

Tailwind is compiled ahead of time. `assets/tailwind.css` is what GitHub Pages serves. After changing classes in `index.html`, regenerate it:

```bash
npm run css:build
```

The stylesheet is scanned from `index.html`, including class strings built in JavaScript.
