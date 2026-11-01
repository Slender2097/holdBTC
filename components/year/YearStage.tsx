"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import YearStill from "@/components/year/YearStill";
import { isDesktop } from "@/lib/device";

const START_YEAR = 2008;
const inRange = (y: number) => y >= START_YEAR && y <= 2026;

// Desktop only (lib/device.ts isDesktop): the 1080p clips from
// scripts/record-year-clips.mjs. Phone never mounts this component and never
// loads a clip; it shows YearStill.
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

const stillLayer = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 0,
} as const;

// A restart remounts GameCanvas, so anything kept in component state is lost.
// These live at module level so the next run can paint the last background
// at once instead of an empty (black) layer.
let clipPref: boolean | null = null;
// A clip failed to load: clips stay off for the rest of the session.
let clipFailed = false;

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

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Desktop, motion allowed, and no clip has failed to load this session. */
const clipsAllowed = () => isDesktop() && !reducedMotion() && !clipFailed;

/** A clip with no frame after this long gives way to the still for the rest of the run. */
const STALL_MS = 2000;

/**
 * Desktop: start loading the first clip before the run mounts (the pay modal
 * calls this), so its first frame is often ready when payment confirms. Does
 * nothing on a phone.
 */
export function preloadStartClip() {
  if (!clipsAllowed()) return;
  getVideo(clipUrl(START_YEAR));
}

/**
 * Desktop year art, free play and ranked: the full scene pre-recorded as a
 * looping video (scripts/record-year-clips.mjs). Video decodes off the main
 * thread, so it does not slow the game loop. GameCanvas mounts this only on
 * desktop (lg and up, fine pointer); a phone gets YearStill alone, and this
 * component also checks isDesktop() itself before it loads a clip. Falls back
 * to the year still (reduced motion, or a clip that fails to load). The HTML
 * scenes in public/years are never fetched during play.
 *
 * The year still is painted under the clip until the clip has shown a frame,
 * and the previous clip stays painted until the next one can show, so the
 * stage is never an empty (black) layer: not while the first clip loads after
 * payment, not on a year change, not on a restart. A clip that has no frame
 * after STALL_MS (a stalled or very slow request, which never fires "error")
 * gives way to the still for the rest of the run.
 */
export default function YearStage({ year }: { year: number }) {
  // null until mounted, so server and client render the same thing. After
  // the first mount a restart reuses the answer.
  const [clipOk, setClipOk] = useState<boolean | null>(() => clipPref);
  // This run gave up on clips (one stalled); the still shows. The next run
  // tries again, unlike a load error, which turns clips off for the session.
  const [stalled, setStalled] = useState(false);
  // Year of the clip that has painted a frame in this run, if any.
  const [painted, setPainted] = useState<number | null>(null);
  const useClip = clipOk === true && !stalled && inRange(year);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clipPref = clipsAllowed();
    setClipOk(clipPref);
  }, []);

  useEffect(() => {
    // Only once this year's clip is on screen: fetching ahead earlier shares
    // the link with the clip that has no frame yet and delays it.
    if (!useClip || painted !== year) return;
    // Keep the start clip warm so a restart is already decoded.
    getVideo(clipUrl(START_YEAR));
    if (!inRange(year + 1)) return;
    // Warm the cache so the next year's clip starts without a gap.
    fetch(clipUrl(year + 1), { priority: "low" } as RequestInit).catch(() => {});
  }, [useClip, painted, year]);

  // Layout effects: the clip moves into the new host before the first paint.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!useClip || !host) return;

    const v = getVideo(clipUrl(year));
    const onError = () => {
      clipFailed = true;
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
    let stallTimer = 0;
    let paintTimer = 0;
    const reveal = () => {
      window.clearTimeout(stallTimer);
      v.style.opacity = "1";
      shownVideo = v;
      // Drop the layers under the clip only after it has painted a frame.
      let once = false;
      const onPainted = () => {
        if (once || done || shownVideo !== v) return;
        once = true;
        window.clearTimeout(paintTimer);
        if (prev) release(prev);
        setPainted(year);
      };
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(onPainted);
      else requestAnimationFrame(() => requestAnimationFrame(onPainted));
      // A paused clip (autoplay blocked) may never call back; its frame is up by now.
      paintTimer = window.setTimeout(onPainted, 1000);
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
    else {
      v.addEventListener("loadeddata", reveal, { once: true });
      // No "error" and no frame (a stall, or a link too slow for the run):
      // stop waiting and keep the still for this run.
      stallTimer = window.setTimeout(() => {
        if (!done && !canShow(v)) setStalled(true);
      }, STALL_MS);
    }

    return () => {
      done = true;
      window.clearTimeout(stallTimer);
      window.clearTimeout(paintTimer);
      v.removeEventListener("error", onError);
      v.removeEventListener("loadeddata", reveal);
      // Never revealed: the next clip takes over, prev stays as the fallback.
      if (shownVideo !== v) release(v);
      else if (prev) release(prev);
    };
  }, [useClip, year]);

  useLayoutEffect(() => {
    // The clip gave way to the still (a stall or a load error): stop the clip
    // that was on screen, so it does not keep decoding off screen.
    if (useClip) return;
    shownVideo?.pause();
    shownVideo?.remove();
  }, [useClip]);

  useLayoutEffect(() => {
    // Unmount (restart): detach so the element can be reattached next run.
    return () => {
      shownVideo?.pause();
      shownVideo?.remove();
    };
  }, []);

  // The still stays mounted for the whole run so a fallback shows the right
  // year at once; it is only hidden while a clip covers it.
  const covered = useClip && painted !== null;
  return (
    <>
      <div aria-hidden style={{ ...stillLayer, visibility: covered ? "hidden" : "visible" }}>
        <YearStill year={year} />
      </div>
      {useClip ? <div ref={hostRef} aria-hidden style={layer} /> : null}
    </>
  );
}
