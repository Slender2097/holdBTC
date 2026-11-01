"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const START_YEAR = 2008;
const inRange = (y: number) => y >= START_YEAR && y <= 2026;

function stillUrl(year: number): string {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return `/years/stills/${year}-${portrait ? "p" : "l"}.webp`;
}

// Average colour of each year's still (public/years/stills), painted under the
// image so a still that is slow or fails to load shows the year's tone, never
// the dark page behind the board.
const STILL_COLORS: Record<number, string> = {
  2008: "#e8e5c5", 2009: "#dbdaa5", 2010: "#eddebd", 2011: "#d5b9c6",
  2012: "#d7bbc8", 2013: "#d7bbc8", 2014: "#d7bbc8", 2015: "#f0e7c1",
  2016: "#e8e2bf", 2017: "#efe8c5", 2018: "#dfedf6", 2019: "#e7e5c4",
  2020: "#f0e8c5", 2021: "#c9d2c4", 2022: "#e9c0ad", 2023: "#d4d0c1",
  2024: "#e4debd", 2025: "#d7bbc8", 2026: "#e2dfc1",
};
const FALLBACK_COLOR = "#f6eccd";

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

/** Load the start year's still ahead of the run (the pay modal calls this). */
export function preloadStartStill() {
  getImage(stillUrl(START_YEAR));
}

/**
 * Free play on every device, and ranked on a phone (coarse pointer or below
 * lg): the year scene as one still image (scripts/record-year-stills.mjs), so
 * no video or iframe runs next to the game loop. In a desktop ranked run
 * YearStage paints this under the year clip until the clip has a frame.
 * public/years/<year>.html is only the source for the stills and clips and
 * is never fetched during play. The previous image stays painted until the next one
 * has decoded, so a year change or a restart never shows the empty layer.
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
    // decode() can reject for an image that is fine (Android Chrome does when
    // a decode is interrupted), so a rejection falls back to the load event.
    const onLoad = () => {
      if (img.naturalWidth > 0) reveal();
    };
    if (again) reveal();
    else
      img.decode().then(reveal, () => {
        if (img.complete) onLoad();
        else img.addEventListener("load", onLoad, { once: true });
      });

    return () => {
      done = true;
      img.removeEventListener("load", onLoad);
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

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{ ...layer, background: STILL_COLORS[year] ?? FALLBACK_COLOR }}
    />
  );
}
