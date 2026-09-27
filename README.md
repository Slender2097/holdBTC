# CandleBird 🕯️₿

A Bitcoin-themed Flappy Bird clone built with **Next.js 15**, TypeScript, Tailwind CSS, **Nostr** and **Lightning**.

Fly a Bitcoin coin through Japanese candlesticks (green/red). Pay **10 sats** to play a round. Scores are published to Nostr and shown on a global leaderboard.

## Features

- 🎮 Smooth canvas game with gravity + flap physics
- 🕯️ Procedural realistic candlesticks (body + wicks)
- ⚡ Lightning entry fee (WebLN + demo simulation)
- 📡 Nostr login (NIP-07 / nsec / ephemeral)
- 🏆 Global leaderboard (kind `33333` events)
- 📱 Responsive (mobile + desktop)
- 🌙 Dark Bitcoin / Nostr aesthetic

## Quick start

```bash
cd candlebird
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
app/                  # Next.js App Router
  layout.tsx
  page.tsx            # Main UI
  globals.css
components/
  GameCanvas.tsx      # Canvas + rAF game loop
  Leaderboard.tsx
  NostrLogin.tsx
  PaymentButton.tsx
  GameOverModal.tsx
lib/
  game/
    constants.ts
    types.ts
    engine.ts         # Physics, collision, spawning
    renderer.ts       # Canvas drawing
  nostr/
    constants.ts
    client.ts         # publish + fetch leaderboard
    utils.ts
  payments/
    lightning.ts      # WebLN + simulation
hooks/
  useNostr.ts
  usePayment.ts
```

## Gameplay

1. (Optional) Login with Nostr extension, nsec, or anonymous key.
2. Click **Pay 10 sats to Play**.
3. Tap / click / press Space to flap.
4. Avoid the candlesticks. Score = distance in “pips”.
5. On crash the score is auto-published (if logged in) and the leaderboard updates.

## Payments (important)

The Lightning integration uses **WebLN** when available (Alby, etc.).  
For local development a **simulation** mode is enabled so you can play without a real wallet.

To go to production:

1. Generate real BOLT11 invoices for 10 sats (LNbits, Voltage, your node, etc.).
2. Replace the demo logic in `lib/payments/lightning.ts`.
3. Optionally add Cashu support via a mint + `cashu-ts`.

## Nostr

- Custom kind: **33333**
- Tag: `t = candlebird`
- Score tags: `score`, `distance`
- Relays: damus, nos.lol, nostr.band, etc.

Leaderboard aggregates the best score per pubkey.

## Tech notes

- Canvas + `requestAnimationFrame` for 60 fps feel
- Pure functions for game state (easy to test)
- No backend required for MVP (all client-side)
- Personal best stored in `localStorage`

## License

MIT – do whatever you want. Stack sats & have fun.
