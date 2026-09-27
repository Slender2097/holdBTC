import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hold BTC | Alien Technology",
  description:
    "Fly through Bitcoin history. Pay with Lightning. Publish scores on Nostr. holdbtc.io",
  keywords: ["bitcoin", "lightning", "nostr", "game", "hold btc"],
  authors: [{ name: "Hold BTC" }],
  openGraph: {
    title: "Hold BTC",
    description: "Alien-tech Bitcoin game. Pay sats. Survive. Stack.",
    type: "website",
    url: "https://holdbtc.io",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#03040a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-alien-void text-white antialiased alien-grid">
        {children}
      </body>
    </html>
  );
}