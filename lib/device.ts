/**
 * Phone: a coarse pointer, or a touch screen below the lg breakpoint (some
 * Android browsers report a fine pointer). Client only.
 */
export function isPhone(): boolean {
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    (navigator.maxTouchPoints > 0 && window.matchMedia("(max-width: 1023px)").matches)
  );
}
