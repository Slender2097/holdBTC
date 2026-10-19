"use client";

import { useEffect, useState } from "react";
import { ENTRY_FEE_SATS, type InvoiceData } from "@/lib/payments/lightning";

interface PaymentModalProps {
  invoice: InvoiceData;
  onClose: () => void;
  paid?: boolean;
  claiming?: boolean;
  claimError?: string | null;
  onRetryClaim?: () => void;
}

export default function PaymentModal({
  invoice,
  onClose,
  paid,
  claiming,
  claimError,
  onRetryClaim,
}: PaymentModalProps) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    if (!invoice?.payment_request) return;
    let cancelled = false;

    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(invoice.payment_request, {
          width: 260,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (!cancelled) {
          setQrDataUrl(url);
          setQrError(false);
        }
      } catch (err) {
        console.error("QR generate failed:", err);
        if (!cancelled) setQrError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(invoice.payment_request);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = invoice.payment_request;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm alien-panel rounded-xl p-6 shadow-glow relative border border-alien-cyan/20">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center text-alien-muted hover:text-white transition text-sm"
        >
          X
        </button>

        <div className="text-center mb-5">
          <p className="text-[10px] tracking-[0.3em] text-alien-cyan uppercase mb-1">
            Transmission
          </p>
          <h2 className="text-xl font-bold text-white tracking-wide">PAY TO PLAY</h2>
          <p className="text-alien-cyan font-mono font-semibold text-lg mt-1">
            {ENTRY_FEE_SATS} SATS
          </p>
        </div>

        {paid ? (
          <div className="mb-2 space-y-3 text-center font-mono">
            <div className="flex items-center justify-center gap-2 text-sm text-alien-green tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-alien-green" />
              PAYMENT RECEIVED
            </div>
            {claimError ? (
              <p className="text-xs text-red-400 leading-relaxed">{claimError}</p>
            ) : (
              <p className="text-xs text-alien-cyan/80 tracking-wide">CLAIMING RANKED RUN</p>
            )}
            {claimError && onRetryClaim && (
              <button
                onClick={onRetryClaim}
                disabled={claiming}
                className="w-full py-2.5 rounded-lg text-sm tracking-wide bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-white disabled:opacity-50 transition"
              >
                {claiming ? "CLAIMING..." : "RETRY CLAIM"}
              </button>
            )}
            <p className="text-[10px] text-alien-muted tracking-wide leading-relaxed">
              CLOSE THIS TO LOG IN OR KEEP PLAYING. YOUR PAYMENT STAYS SAVED.
            </p>
          </div>
        ) : (
          <>
            <div className="flex justify-center mb-5">
              <div className="p-3 bg-white rounded-lg">
                {qrDataUrl && !qrError ? (
                  <img
                    src={qrDataUrl}
                    alt="Lightning QR"
                    width={240}
                    height={240}
                    className="rounded"
                  />
                ) : (
                  <div className="w-[240px] h-[240px] flex flex-col items-center justify-center text-black/50 text-sm gap-2 font-mono">
                    <span>{qrError ? "QR ERROR" : "BUILDING QR"}</span>
                    <span className="text-xs">USE COPY BELOW</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 mb-4 text-xs text-alien-cyan/80 font-mono tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-alien-cyan animate-pulse" />
              SCANNING FOR PAYMENT
            </div>

            <button
              onClick={handleCopy}
              className="w-full py-2.5 rounded-lg text-sm font-mono tracking-wide bg-alien-panel hover:bg-white/5 border border-alien-border transition flex items-center justify-center gap-2 text-white/80"
            >
              {copied ? "COPIED" : "COPY INVOICE"}
            </button>

            <p className="mt-4 text-center text-[10px] text-alien-muted tracking-wide leading-relaxed">
              SCAN WITH ANY LIGHTNING WALLET
            </p>
          </>
        )}
      </div>
    </div>
  );
}
