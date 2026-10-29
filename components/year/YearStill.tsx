"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const START_YEAR = 2008;
const inRange = (y: number) => y >= START_YEAR && y <= 2026;

function stillUrl(year: number): string {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return `/years/stills/${year}-${portrait ? "p" : "l"}.webp`;
}

const layer = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: 0,
  objectFit: "cover",
} as const;

// A restart remounts GameCanvas. The images live at module level so the next
// run paints the last background at once instead of an empty layer.
const images = new Map<string, HTMLImageElement>();
let shownImage: HTMLImageElement | null = null;

function getImage(url: string): HTMLImageElement {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    Object.assign(img.style, layer);
    img.src = url;
    images.set(url, img);
  }
  return img;
}

/** Drop an image that is no longer shown. The start year stays for the next restart. */
function release(img: HTMLImageElement) {
  img.remove();
  if (img.src.includes(`/${START_YEAR}-`)) return;
  for (const [url, el] of images) if (el === img) images.delete(url);
}

/**
 * Phone free play: the year scene as one still image (scripts/record-year-stills.mjs),
 * so no iframe runs next to the game loop. Same scene as the desktop free-play
 * still. The previous image stays painted until the next one has decoded, so a
 * year change or a restart never shows the empty layer.
 */
export default function YearStill({ year }: { year: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep the start year ready for a restart; load the next year ahead.
    getImage(stillUrl(START_YEAR));
    if (inRange(year + 1)) getImage(stillUrl(year + 1));
  }, [year]);

  // Layout effect: the image moves into the new host before the first paint.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !inRange(year)) return;

    const img = getImage(stillUrl(year));
    const prev = shownImage && shownImage !== img ? shownImage : null;
    if (prev && prev.parentElement !== host) host.appendChild(prev);

    let done = false;
    const reveal = () => {
      if (done) return;
      img.style.opacity = "1";
      shownImage = img;
      if (prev) release(prev);
    };

    // Already on screen last run (restart in the same year): show it at once.
    // Otherwise wait for the decode, with prev painted underneath.
    const again = img === shownImage;
    if (img.parentElement !== host) {
      img.style.opacity = again ? "1" : "0";
      host.appendChild(img);
    }
    if (again) reveal();
    else img.decode().then(reveal, () => {});

    return () => {
      done = true;
      // Never revealed: the next image takes over, prev stays as the fallback.
      if (shownImage !== img) img.remove();
    };
  }, [year]);

  useLayoutEffect(() => {
    // Unmount (restart): detach so the image can be reattached next run.
    return () => {
      shownImage?.remove();
    };
  }, []);

  return <div ref={hostRef} aria-hidden style={{ ...layer, background: "#f6eccd" }} />;
}
