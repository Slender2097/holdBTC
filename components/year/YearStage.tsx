"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import YearStill from "@/components/year/YearStill";

const START_YEAR = 2008;
const inRange = (y: number) => y >= START_YEAR && y <= 2026;

function clipUrl(year: number): string {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return `/years/clips/${year}-${portrait ? "p" : "l"}.mp4`;
}

const layer = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: 0,
  pointerEvents: "none",
  zIndex: 0,
  background: "transparent",
  transform: "translateZ(0)",
  contain: "strict",
} as const;

// A restart remounts GameCanvas, so anything kept in component state is lost.
// These live at module level so the next run can paint the last background
// at once instead of an empty (black) layer.
let clipPref: boolean | null = null;

const videos = new Map<string, HTMLVideoElement>();
let shownVideo: HTMLVideoElement | null = null;

function getVideo(url: string): HTMLVideoElement {
  let v = videos.get(url);
  if (!v) {
    v = document.createElement("video");
    v.setAttribute("aria-hidden", "true");
    v.tabIndex = -1;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.disablePictureInPicture = true;
    Object.assign(v.style, layer, { objectFit: "cover" });
    v.src = url;
    videos.set(url, v);
  }
  return v;
}

/** Drop a clip that is no longer shown. Start-year clips stay for the next restart. */
function release(v: HTMLVideoElement) {
  v.pause();
  v.remove();
  if (v.src.includes(`/${START_YEAR}-`)) return;
  for (const [url, el] of videos) if (el === v) videos.delete(url);
  v.removeAttribute("src");
  v.load();
}

const canShow = (v: HTMLVideoElement) => v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

/**
 * Ranked year art: the full scene pre-recorded as a looping video
 * (scripts/record-year-clips.mjs). Video decodes off the main thread, so it
 * does not slow the one-step-per-frame ranked loop. Falls back to the year
 * still (reduced motion, or a clip that fails to load). The HTML scenes in
 * public/years are never fetched during play.
 *
 * The previous clip stays painted until the next one can show, so a year
 * change or a restart never flashes the empty layer.
 */
export default function YearStage({ year, clip = false }: { year: number; clip?: boolean }) {
  // null until mounted, so server and client render the same thing. After
  // the first mount a restart reuses the answer.
  const [clipOk, setClipOk] = useState<boolean | null>(() =>
    !clip ? false : clipPref
  );
  const useClip = clipOk === true && inRange(year);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clipPref = clip && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setClipOk(clipPref);
  }, [clip]);

  useEffect(() => {
    if (!useClip) return;
    // Keep the start clip warm so a restart is already decoded.
    getVideo(clipUrl(START_YEAR));
    if (!inRange(year + 1)) return;
    // Warm the cache so the next year's clip starts without a gap.
    fetch(clipUrl(year + 1), { priority: "low" } as RequestInit).catch(() => {});
  }, [useClip, year]);

  // Layout effects: the clip moves into the new host before the first paint.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!useClip || !host) return;

    const v = getVideo(clipUrl(year));
    const onError = () => {
      clipPref = false;
      setClipOk(false);
    };
    v.addEventListener("error", onError);

    // Last run's frame stays under the new clip until it can show.
    const prev = shownVideo && shownVideo !== v ? shownVideo : null;
    if (prev && prev.parentElement !== host) {
      prev.pause();
      host.appendChild(prev);
    }

    let done = false;
    const reveal = () => {
      v.style.opacity = "1";
      shownVideo = v;
      if (!prev) return;
      // Drop the old layer only after the new clip has painted a frame.
      const drop = () => {
        if (!done && shownVideo === v) release(prev);
      };
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(drop);
      else requestAnimationFrame(() => requestAnimationFrame(drop));
    };

    // Read before the seek: seeking drops readyState until the seek ends.
    const ready = canShow(v);
    if (v.parentElement !== host) {
      v.style.opacity = ready ? "1" : "0";
      host.appendChild(v);
    }
    // Clip already loaded (restart in the start year): seek, do not recreate.
    if (v.currentTime > 0) v.currentTime = 0;
    v.play().catch(() => {});

    if (ready) reveal();
    else v.addEventListener("loadeddata", reveal, { once: true });

    return () => {
      done = true;
      v.removeEventListener("error", onError);
      v.removeEventListener("loadeddata", reveal);
      // Never revealed: the next clip takes over, prev stays as the fallback.
      if (shownVideo !== v) release(v);
      else if (prev) release(prev);
    };
  }, [useClip, year]);

  useLayoutEffect(() => {
    // Unmount (restart): detach so the element can be reattached next run.
    return () => {
      shownVideo?.pause();
      shownVideo?.remove();
    };
  }, []);

  if (clipOk === false) return <YearStill year={year} />;
  return <div ref={hostRef} aria-hidden style={layer} />;
}
