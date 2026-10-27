import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | Hold BTC",
  description: "What Hold BTC stores, and what stays on Nostr.",
};

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10 text-sm text-alien-muted leading-relaxed">
      <a
        href="/"
        className="inline-flex items-center rounded-lg bg-alien-cyan px-4 py-2 text-[11px] font-mono tracking-[0.16em] uppercase text-alien-void"
      >
        Back to game
      </a>
      <h1 className="mt-4 text-2xl text-white tracking-wide">Privacy</h1>
      <p className="mt-2 text-xs">27 October 2026</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Free play</h2>
        <p>
          A free run stays in the browser. The server does not receive the score.
          Your personal best, games played, and local sats counter are saved in
          localStorage on that device. Clearing site data removes them.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Nostr login</h2>
        <p>
          Ranked play uses your Nostr public key. An extension login is preferred.
          A pasted private key is saved in that browser&apos;s localStorage until you
          log out, and is NOT sent to the server. The server reads your display
          name and picture from your public Nostr profile.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Paid runs</h2>
        <p>
          A ranked entry is 1000 sats. One payment is one ranked run.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">Analytics</h2>
        <p>
          Page views are counted with Vercel Web Analytics. Each view records the
          page address, the site that linked you, your approximate location, and
          your browser, operating system, and device type. Visitors are counted
          anonymously without third-party cookies, and a visitor session is
          discarded after 24 hours. Analytics does not record your Nostr key,
          your scores, or your payments. See{" "}
          <a
            href="https://vercel.com/docs/analytics/privacy-policy"
            className="text-alien-cyan/80 hover:text-alien-cyan"
          >
            Vercel&apos;s analytics privacy notes
          </a>
          .
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-white text-base">What we do not do</h2>
        <p>
          We do not sell this data. We do not ask for your Nostr 
          private key on the server. A share note is signed by your
          key and posted only if you press the share button.
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
