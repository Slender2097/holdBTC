import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Hold BTC",
  description: "Rules for free play and ranked entry on Hold BTC.",
};

export default function TermsPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-sm text-alien-muted leading-relaxed">
      <a
        href="/"
        className="inline-flex items-center rounded-lg bg-alien-cyan px-4 py-2 text-[11px] font-mono tracking-[0.16em] uppercase text-alien-void"
      >
        Back to game
      </a>
      <h1 className="mt-4 text-2xl text-white tracking-wide">Terms of Service</h1>
      <p className="mt-2 text-xs">7 October 2026</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">The service</h2>
        <p>
          Hold BTC is a game at holdbtc.io. Free play is available without an
          account. A ranked entry costs 1000 sats and buys one replay-checked
          run. The score on the board is the score the server replays, not
          whatever the browser displayed.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Payments</h2>
        <p>
          Nothing paid to Hold BTC is refunded. A failed share, a closed tab,
          a relay that does not accept the score, or a run you do not like 
          is not a refund. One payment is one ranked entry.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Nostr</h2>
        <p>
          You connect your own Nostr account. You are responsible for that key,
          the extension, and any note you sign. Hold BTC does not take
          responsibility for misuse of a Nostr account, a lost or pasted
          private key, or a note published from your key. A share note is sent
          only if you press the share button, and it is public.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Leaderboard</h2>
        <p>
          We may remove a public key from the leaderboard, and refuse another
          ranked entry, if that player breaks the norms of the community. That
          includes illegal content, harassment, a deceptive name or picture, or
          an attempt to put a false score on the board. 
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Changes</h2>
        <p>
          We may change these terms at any time. The page at /terms is the
          current version. Continued use of the service after a change is
          acceptance of the current terms. 
        </p>
      </section>

      <a
        href="/"
        className="inline-flex items-center mt-10 rounded-lg bg-alien-cyan px-4 py-2 text-[11px] font-mono tracking-[0.16em] uppercase text-alien-void"
      >
        Back to game
      </a>
    </main>
  );
}
