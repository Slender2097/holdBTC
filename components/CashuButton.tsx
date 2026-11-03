"use client";

import { CASHU_ENTRY_FEE_SATS } from "@/lib/cashu/constants";

/** The Cashu nut: an ecash coin with a nut inside. */
export function CashuMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="10.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.3 6.4c-2.3.9-3.4 3.5-2.7 6.2.8 3 3.6 5 6.6 4.8 2-.1 3.6-1.2 3.4-2.5-.1-1.1-1.4-1.5-2.8-1.6-1.6-.1-2.7-1-2.8-2.4-.1-1.1.5-2 .2-3-.3-1.1-1.1-1.8-1.9-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

interface CashuButtonProps {
  onOpen: () => void;
  disabled?: boolean;
  /**
   * "bar": next to the Lightning button (desktop, and phone in landscape).
   * "row": a slim full-width row under the phone bar in portrait, where the bar has
   * no room left beside the Lightning button without clipping its label.
   * globals.css shows exactly one of the two at any size.
   */
  variant?: "bar" | "row";
}

/**
 * Second ranked button, Cashu only. Sits next to the Lightning button and does not
 * touch it: its own markup, its own styles, no shared state with PaymentButton.
 */
export default function CashuButton({ onOpen, disabled, variant = "bar" }: CashuButtonProps) {
  const label = `Cashu ranked entry, 50% off: ${CASHU_ENTRY_FEE_SATS} sats`;
  if (variant === "row") {
    return (
      <div className="cashu-row px-3 pb-1.5 border-b border-alien-border/60 bg-alien-deep/90">
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-label={label}
          className="w-full h-8 inline-flex items-center justify-center gap-2 rounded-lg border-2 border-alien-orange bg-alien-orange/15 text-alien-orange font-bold whitespace-nowrap active:bg-alien-orange/35 disabled:opacity-50"
        >
          <CashuMark className="w-4 h-4 shrink-0" />
          <span className="text-[13px] tracking-wide">50% OFF</span>
          <span className="text-[11px] font-mono font-medium text-alien-orange/80">
            {CASHU_ENTRY_FEE_SATS} SATS WITH CASHU
          </span>
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={label}
      title={`Ranked entry with Cashu ecash: ${CASHU_ENTRY_FEE_SATS} sats`}
      className="phone-cta cashu-btn inline-flex items-center justify-center gap-2 rounded-xl border-2 border-alien-orange bg-alien-orange/15 px-4 py-2 text-alien-orange font-bold whitespace-nowrap shadow-[0_0_12px_rgba(247,147,26,0.3)] hover:bg-alien-orange/25 active:bg-alien-orange/35 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed max-lg:shrink-0 max-lg:gap-1.5 max-lg:px-3"
    >
      <CashuMark className="w-5 h-5 max-lg:w-4 max-lg:h-4 shrink-0" />
      <span className="text-sm tracking-wide max-lg:text-[13px] max-lg:tracking-normal">50% OFF</span>
      <span className="text-[11px] font-mono font-medium text-alien-orange/80 max-lg:hidden">
        {CASHU_ENTRY_FEE_SATS} SATS
      </span>
    </button>
  );
}
