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

/**
 * Desktop: the lg breakpoint and up with a fine pointer. Never true when
 * isPhone() is (a coarse pointer, or anything below lg). Only desktop plays
 * the year clips. Client only.
 */
export const DESKTOP_QUERY = "(min-width: 1024px) and (pointer: fine)";

export function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

/** Calls back when the window crosses into or out of desktop. */
export function onDesktopChange(cb: () => void): () => void {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
