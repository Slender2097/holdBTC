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
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
BANNED_PUBKEYS=
```

`HOLD_BTC_NSEC` is a dedicated key used only to sign paid scores. It is not a player account.

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` point at the Redis that enforces one payment, one ranked run. With the Vercel KV / Upstash integration, `KV_REST_API_URL` / `KV_REST_API_TOKEN` work instead. They are required on Vercel and in production (`next start`), where the server throws if neither pair is set; `next dev` falls back to an in-process Map.

`BANNED_PUBKEYS` is an optional comma-separated list of 64-char hex pubkeys (not npub). A listed key is hidden from Global Rank and cannot buy a ranked run, submit a score, or share a note. Entries that are not hex are ignored with a warning in the logs. When the variable is empty, the list in `lib/security/blockList.ts` is used instead. On Vercel, a changed value takes effect on the next deployment: use Redeploy, no code change needed.

Per-IP rate limits read only the `x-vercel-forwarded-for` header that Vercel sets. Off Vercel (including `next dev`) it is missing, so all clients share one limit.

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
