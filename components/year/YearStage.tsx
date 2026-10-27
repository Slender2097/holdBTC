"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
const htmlCache = new Map<string, string>();
let lastKey: string | null = null;
// The loaded still, carried into the next mount on restart. moveBefore keeps
// an iframe's document across a move; a plain move reloads it.
let loadedFrame: HTMLIFrameElement | null = null;
let parked: HTMLIFrameElement | null = null;
type Movable = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/** Scene sky, painted under the iframe while its document loads. */
const sky = (doc?: string) => doc?.match(/body\{background:([^}]+)\}/)?.[1];

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
 * Year art from public/years.
 * clip: paid run, the full scene pre-recorded as a looping video
 *   (scripts/record-year-clips.mjs). Video decodes off the main thread, so
 *   it does not slow the one-step-per-frame ranked loop. Falls back to live.
 * live: the full scene in a scripted iframe.
 * still: free play, the frozen test version.
 *
 * The previous background stays painted until the next one can show, so a
 * year change or a restart never flashes the empty layer.
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
  // null until mounted, so server and client render the same thing. After
  // the first mount a restart reuses the answer.
  const [clipOk, setClipOk] = useState<boolean | null>(() =>
    !clip ? false : clipPref
  );
  const useClip = clipOk === true && inRange(year);
  const htmlKey = `${year}:${live ? "live" : "still"}`;
  // htmlCache keys. shown is painted; next loads on top and replaces it.
  const [shown, setShown] = useState<string | null>(() =>
    clipOk !== false ? null : htmlCache.has(htmlKey) ? htmlKey : lastKey
  );
  const [next, setNext] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const carriedRef = useRef<HTMLIFrameElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current as Movable | null;
    if (host && parked && host.moveBefore && !useClip) {
      host.moveBefore(parked, host.firstChild);
      carriedRef.current = parked;
    } else {
      parked?.remove();
    }
    parked = null;
    return () => {
      const frame = loadedFrame;
      if (!frame?.isConnected || !(document.body as Movable).moveBefore) return;
      let park = document.getElementById("year-stage-park");
      if (!park) {
        park = document.createElement("div");
        park.id = "year-stage-park";
        park.hidden = true;
        document.body.appendChild(park);
      }
      (park as Movable).moveBefore!(frame, null);
      parked = frame;
    };
  }, []);

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

  useEffect(() => {
    if (clipOk !== false || !inRange(year)) return;

    if (htmlCache.has(htmlKey)) {
      setNext(htmlKey);
      return;
    }

    let cancel = false;
    fetch(`/years/${year}.html`)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!text) return;
        htmlCache.set(htmlKey, live ? text : still(text));
        if (!cancel) setNext(htmlKey);
      })
      .catch(() => {});

    return () => {
      cancel = true;
    };
  }, [htmlKey, year, live, clipOk]);

  useEffect(() => {
    if (clipOk !== false || live) return;
    // Prefetch the start year so a restart has it in memory.
    const key = `${START_YEAR}:still`;
    if (htmlCache.has(key)) return;
    fetch(`/years/${START_YEAR}.html`)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (text) htmlCache.set(key, still(text));
      })
      .catch(() => {});
  }, [clipOk, live]);

  if (useClip) return <div ref={hostRef} aria-hidden style={layer} />;

  const keys = [shown, next].filter((k, i): k is string => !!k && (i === 0 || k !== shown));

  return (
    <div ref={hostRef} aria-hidden style={{ ...layer, background: sky(htmlCache.get(shown ?? "")) }}>
      {keys.map((key) => {
        const pending = key !== shown;
        return (
          <iframe
            key={key}
            title=""
            aria-hidden
            tabIndex={-1}
            sandbox={live ? "allow-scripts" : ""}
            srcDoc={htmlCache.get(key)}
            onLoad={(e) => {
              loadedFrame = e.currentTarget;
              carriedRef.current?.remove();
              carriedRef.current = null;
              if (!pending) return;
              lastKey = key;
              setShown(key);
              setNext(null);
            }}
            style={pending ? { ...layer, opacity: 0 } : layer}
          />
        );
      })}
    </div>
  );
}
