# Hold BTC

Arcade game: fly a Bitcoin through candlestick obstacles.

- Play is free.
- 1000 sats on Lightning unlocks one ranked run.
- Ranked scores are replayed on the server, then published with a site Nostr key.
- Players log in with their own Nostr account.
- Site: [holdbtc.io](https://holdbtc.io)

## Stack

Next.js 15, TypeScript, Tailwind CSS, Canvas, Strike, Nostr.

## Run

```bash
npm install
npm run dev
```

Create `.env.local` (do not commit it):

```
STRIKE_API_KEY=
STRIKE_API_URL=https://api.strike.me
RANKED_TOKEN_SECRET=
HOLD_BTC_NSEC=
```

`HOLD_BTC_NSEC` is a dedicated key used only to sign paid scores. It is not a player account.

## Ranked runs

1. Log in with Nostr (extension recommended).
2. Pay 1000 sats.
3. Play one run. Flaps are recorded.
4. The server replays that run and publishes the result.
5. Global Rank lists only those events.

Free runs stay off the board.

## Layout

```
app/            pages and API
components/     UI and canvas
hooks/          Nostr and payment state
lib/game/       physics, replay, render
lib/nostr/      relays and site publish
lib/payments/   Strike
lib/security/   tokens and rate limits
```

## License

MIT
