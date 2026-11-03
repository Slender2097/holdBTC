# Hold BTC

Arcade game: fly a Bitcoin through candlestick obstacles.

- Play is free.
- 1000 sats on Lightning unlocks one ranked run.
- Or 500 sats from the in-game Cashu wallet (50% OFF button).
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

Create `.env.local`:

```
STRIKE_API_KEY=
STRIKE_API_URL=https://api.strike.me
RANKED_TOKEN_SECRET=
HOLD_BTC_NSEC=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
BANNED_PUBKEYS=
CASHU_MINT_URL=
CASHU_VAULT_KEY=
CASHU_ADMIN_USER=
CASHU_ADMIN_PASSWORD=
```

`HOLD_BTC_NSEC` is a dedicated key used only to sign paid scores. It is not a player account.

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` point at the Redis that enforces one payment, one ranked run. With the Vercel KV / Upstash integration, `KV_REST_API_URL` / `KV_REST_API_TOKEN` work instead. They are required on Vercel and in production (`next start`), where the server throws if neither pair is set; `next dev` falls back to an in-process Map.

`BANNED_PUBKEYS` is an optional comma-separated list of 64-char hex pubkeys (not npub). A listed key is hidden from Global Rank and cannot buy a ranked run, submit a score, or share a note. Entries that are not hex are ignored with a warning in the logs. When the variable is empty, the list in `lib/security/blockList.ts` is used instead. On Vercel, a changed value takes effect on the next deployment: use Redeploy, no code change needed.

Per-IP rate limits read only the `x-vercel-forwarded-for` header that Vercel sets. Off Vercel (including `next dev`) it is missing, so all clients share one limit.

`CASHU_MINT_URL` is the one Cashu mint the server accepts ecash from (hard allowlist; the browser is told this URL and never names one). `CASHU_VAULT_KEY` is 32 random bytes as 64 hex chars (`openssl rand -hex 32`). It encrypts the ecash the server receives (AES-256-GCM) and derives the server's NUT-13 output secrets, so a lost mint reply can be restored. Without both, the 50% OFF wallet shows "not available" and Lightning works as before. Keep the key: without it the collected ecash cannot be opened.

## Ranked runs

1. Log in with Nostr (extension recommended).
2. Pay 1000 sats.
3. Play one run. Flaps are recorded.
4. The server replays that run and publishes the result.
5. Global Rank lists only those events.

Free runs stay off the board.

## Cashu ranked entry (50% OFF)

1. Tap 50% OFF. The wallet opens: balance, Add sats, Play.
2. Add sats shows a Lightning invoice from the mint (NUT-04). Paid, the balance updates. The ecash lives in the browser (IndexedDB).
3. Play ranked costs 500 sats plus the mint's input fee (NUT-02), shown before you tap.
4. The browser sends a token and blinded outputs for its change. The server swaps the token at the mint (NUT-03): 500 sats to server outputs, the rest back to the player as change only the player can unblind. That swap is the payment.
5. The server then issues the same ranked token Lightning gets; the run, replay and Global Rank are unchanged.

One set of proofs is one run: a retry of a paid swap returns the same ranked token and seed. The spent proofs leave IndexedDB only after the server confirms.

### Cashu vault admin

`/admin/cashu` is an operator page, not linked from the game. Log in with `CASHU_ADMIN_USER` / `CASHU_ADMIN_PASSWORD` (at least 12 characters, its own secret: not `CASHU_VAULT_KEY`, `RANKED_TOKEN_SECRET` or a Nostr key). It shows the number of runs, proofs and unspent sats, and has one button, Export token: the same steps as `scripts/cashu-vault-export.mjs` (open the vault with `CASHU_VAULT_KEY`, ask the mint which proofs are UNSPENT, print one cashuB token). Export is read-only; spent proofs are skipped, so after you receive a token the next export no longer includes those sats.

The session is an httpOnly, sameSite=lax cookie scoped to `/admin/cashu` (secure in production, 8 hours). Changing the password logs every session out. Failed logins are counted in the same Redis: 5 per IP and 30 in total per 15 minutes, after which logins are refused until the window ends. In production, login and export refuse plain http.

Collected ecash is stored sealed in Redis (`cashu:vault:*`). To take it out:

```bash
node --env-file=.env.local scripts/cashu-vault-export.mjs   # prints one cashuB token
```

Receive that token in any Cashu wallet. The script never deletes anything.

### Local test mint

Any test mint works, for example `https://testnut.cashu.space` (fake Lightning, invoices pay themselves). For an offline mint on your machine, run Nutshell with the FakeWallet backend on port 3338 and set `CASHU_MINT_URL=http://127.0.0.1:3338` (plain http is accepted only for localhost, and only `next dev` lets the browser reach it).

## Layout

```
app/            pages and API
components/     UI and canvas
hooks/          Nostr and payment state
lib/game/       physics, replay, render
lib/nostr/      relays and site publish
lib/payments/   Strike
lib/cashu/      Cashu wallet (browser) and swap (server)
lib/security/   tokens and rate limits
```

## License

MIT
