"use client";

import { ENTRY_FEE_SATS } from "@/lib/payments/lightning";

interface PaymentButtonProps {
  hasPaid: boolean;
  paying: boolean;
  onPay: () => void;
  disabled?: boolean;
}

export default function PaymentButton({
  hasPaid,
  paying,
  onPay,
  disabled,
}: PaymentButtonProps) {
  if (hasPaid) {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-alien-green/10 border border-alien-green/40 text-alien-green text-sm font-mono tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-alien-green animate-pulse" />
        RANKED READY
      </div>
    );
  }

  return (
    <button
      onClick={onPay}
      disabled={paying || disabled}
      className="gold-border-btn relative inline-flex items-center justify-center rounded-xl p-[2px] disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-2 rounded-[10px] bg-alien-cyan px-5 py-2.5 text-sm font-semibold tracking-wide text-alien-void shadow-glow">
        {paying ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-alien-void/30 border-t-alien-void rounded-full animate-spin" />
            CONNECTING
          </>
        ) : (
          <>RANKED ENTRY — {ENTRY_FEE_SATS} SATS</>
        )}
      </span>

      <style jsx>{`
        .gold-border-btn {
          background: #0c1220;
          overflow: hidden;
        }
        .gold-border-btn::before {
          content: "";
          position: absolute;
          inset: -100%;
          background: conic-gradient(
            from 0deg,
            transparent 0%,
            transparent 72%,
            #b8860b 80%,
            #ffd700 86%,
            #fff8dc 90%,
            #ffd700 94%,
            #b8860b 98%,
            transparent 100%
          );
          animation: gold-line-spin 2.2s linear infinite;
          transition: filter 0.2s ease, opacity 0.2s ease;
          opacity: 0.95;
        }
        /* Hover: stronger gold, NO padding change */
        .gold-border-btn:hover:not(:disabled)::before {
          filter: saturate(1.4) brightness(1.35);
          opacity: 1;
        }
        .gold-border-btn:hover:not(:disabled) {
          box-shadow: 0 0 14px rgba(255, 215, 0, 0.45);
        }
        /* Click / tap: brighter */
        .gold-border-btn:active:not(:disabled)::before {
          filter: saturate(1.7) brightness(1.75);
          opacity: 1;
        }
        .gold-border-btn:active:not(:disabled) {
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.7);
        }
        @keyframes gold-line-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </button>
  );
}