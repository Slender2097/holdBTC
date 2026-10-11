"use client";

import { useEffect, useState } from "react";

function still(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/class="([^"]*)\bcrayon\b([^"]*)"/g, 'class="$1$2"')
    .replace(/filter:\s*url\(#crayon-filter\)/g, "filter:none")
    .replace(/<filter id="crayon-filter">[\s\S]*?<\/filter>/g, "")
    .replace(
      "</head>",
      "<style>*{animation:none!important;transition:none!important}.crayon,svg.crayon{filter:none!important}</style></head>"
    );
}

const inRange = (y: number) => y >= 2008 && y <= 2026;

function clipUrl(year: number): string {
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  return `/years/clips/${year}-${portrait ? "p" : "l"}.mp4`;
}

/**
 * Year art from public/years.
 * clip: paid run, the full scene pre-recorded as a looping video
 *   (scripts/record-year-clips.mjs). Video decodes off the main thread, so
 *   it does not slow the one-step-per-frame ranked loop. Falls back to live.
 * live: the full scene in a scripted iframe.
 * still: free play, the frozen test version.
 */
export default function YearStage({
  year,
  live = false,
  clip = false,
}: {
  year: number;
  live?: boolean;
  clip?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  // null until mounted, so server and client render the same thing.
  const [clipOk, setClipOk] = useState<boolean | null>(clip ? null : false);
  const useClip = clipOk === true && inRange(year);

  useEffect(() => {
    setClipOk(clip && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [clip]);

  useEffect(() => {
    if (!useClip || !inRange(year + 1)) return;
    // Warm the cache so the next year's clip starts without a gap.
    fetch(clipUrl(year + 1), { priority: "low" } as RequestInit).catch(() => {});
  }, [useClip, year]);

  useEffect(() => {
    if (clipOk !== false || !inRange(year)) {
      setHtml(null);
      return;
    }

    let cancel = false;
    fetch(`/years/${year}.html`)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (cancel || !text) return;
        setHtml(live ? text : still(text));
      })
      .catch(() => {
        if (!cancel) setHtml(null);
      });

    return () => {
      cancel = true;
    };
  }, [year, live, clipOk]);

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

  if (useClip) {
    return (
      <video
        key={year}
        aria-hidden
        tabIndex={-1}
        src={clipUrl(year)}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={() => setClipOk(false)}
        style={{ ...layer, objectFit: "cover" }}
      />
    );
  }

  if (!html) return null;

  return (
    <iframe
      title=""
      aria-hidden
      tabIndex={-1}
      sandbox={live ? "allow-scripts" : ""}
      srcDoc={html}
      style={layer}
    />
  );
}
