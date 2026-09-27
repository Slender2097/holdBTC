Hold BTC

A Bitcoin-themed arcade game. Fly a coin through candlestick obstacles.

Play is free. A 1000-sat Lightning payment unlocks one Global Rank run. Identities come from Nostr. Ranked scores are attested by the server after Strike confirms payment.

Live intent: holdbtc.io

Stack

Next.js 15 · TypeScript · Tailwind CSS · Canvas · Strike Lightning · Nostr

Run locally

npm install
cp .env.local.example .env.local
npm run dev

Required in .env.local (never commit this file):

STRIKE_API_KEY=
STRIKE_API_URL=https://api.strike.me
RANKED_TOKEN_SECRET=
HOLD_BTC_NSEC=

HOLD_BTC_NSEC is a dedicated site key used only to stamp paid scores. Players still log in with their own Nostr account.

How ranked mode works





Player logs in with Nostr (extension recommended).



Player pays 1000 sats. Strike is checked on the server.



Server issues a short-lived token bound to that pubkey and invoice.



On game over, the server publishes one attested score.



Global Rank lists only those server-signed events.

Free games are not written to the leaderboard.

Layout

app/            pages and API routes
components/     UI and canvas
hooks/          Nostr and payment state
lib/game/       physics and rendering
lib/nostr/      relays and site publish
lib/payments/   Strike
lib/security/   tokens, rate limits, URL checks

Security review

Public source is meant to be reviewed. Do not request .env values or nsecs.

Start here: app/api/, lib/security/, lib/nostr/sitePublish.ts.

License

MIT