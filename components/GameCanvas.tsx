"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createInitialState,
  flap,
  getYearFromScore,
  updateGame,
  RANKED_DT,
} from "@/lib/game/engine";
import { mulberry32, type Rng } from "@/lib/game/rng";
import { renderFrame, resetFrameDamage } from "@/lib/game/renderer";
import type { GameState } from "@/lib/game/types";
import YearStage from "@/components/year/YearStage";
import YearStill from "@/components/year/YearStill";
import { isPhone } from "@/lib/device";
import {
  musicMuted,
  playSfx,
  startMusic,
  startRankedMusic,
  stopMusic,
  toggleMusic,
  warmMusic,
} from "@/lib/game/music";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Phone (lib/device.ts). null during server render and hydration.
const noSubscribe = () => () => {};
const usePhone = () => useSyncExternalStore<boolean | null>(noSubscribe, isPhone, () => null);

// Phone, before the run: a finger that moves mostly up or down by more than
// SWIPE_SLOP (CSS px) is a scroll, not a tap. Chrome holds back touchmoves
// inside its own slop, so the first one a tap with a little finger roll
// reports is already 15-20 px out; the old 10 px limit undid real taps on
// Android. Sideways moves never scroll (touch-action: pan-y), so they never
// undo the start. One held still TAP_HOLD_MS is a tap even before it lifts.
const SWIPE_SLOP = 28;
const TAP_HOLD_MS = 250;

// Desktop keeps the low-latency canvas. On phones it is off: Android Chrome
// can put a desynchronized canvas on an overlay that ignores alpha, which
// paints the whole board black over the year still (iOS ignores the hint).
function getCtx(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d", { alpha: true, desynchronized: !isPhone() });
}

// Phone free play: the fixed step for one frame, from the median of the last
// GAP_SAMPLES frame gaps. A hitch is one long gap and does not move the
// median; a phone that really runs at 30 Hz (power saving) moves it within
// a few frames. Clamped like the desktop step.
const GAP_SAMPLES = 15;
function frameStep(gaps: number[], elapsed: number): number {
  gaps.push(elapsed);
  if (gaps.length > GAP_SAMPLES) gaps.shift();
  const sorted = gaps.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  return Math.min(Math.max(median / 16.666, 0.5), 2.5);
}

// The touch that started the run on finger-down, until it is known to be a tap.
type StartTouch = { id: number; x: number; y: number; timer: number; tap: boolean };

export type RunLog = {
  score: number;
  distance: number;
  flaps: number[];
  frames: number;
  width: number;
  height: number;
};

interface GameCanvasProps {
  onGameOver: (score: number, distance: number, log?: RunLog) => void;
  onScoreChange?: (score: number) => void;
  highScore?: number;
  enabled?: boolean;
  className?: string;
  rankedSeed?: number | null;
  onRunStart?: () => void;
}

export default function GameCanvas({
  onGameOver,
  onScoreChange,
  highScore = 0,
  enabled = true,
  className = "",
  rankedSeed = null,
  onRunStart,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const rngRef = useRef<Rng | null>(null);
  const flapsRef = useRef<number[]>([]);
  const playSizeRef = useRef({ w: 0, h: 0 });
  const startedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [year, setYear] = useState(2008);
  const gameOverSent = useRef(false);
  const ranked = rankedSeed != null;
  const phone = usePhone() === true;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const startTouchRef = useRef<StartTouch | null>(null);
  // Phone free play: recent frame gaps (ms), for the per-frame step.
  const gapsRef = useRef<number[]>([]);
  // Time of the last phone touch handled here; the click it makes is dropped.
  const touchAtRef = useRef(-Infinity);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    // Ranked width/height are the CSS size at the first flap. Do not recreate
    // state or follow a chrome-hide resize after that.
    if (startedRef.current) return;

    // Backing store only; the logical board size (w, h), the ranked step and
    // the replay width/height stay the same. Desktop caps at 1.5x. Phone draws
    // at 1x, free play and ranked: a 390 px board is a 390 px backing store,
    // not 585 or 780, so each frame fills a third to a quarter of the pixels.
    const dpr = isPhone() ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    const w = parent.clientWidth;
    const h = parent.clientHeight || Math.min(window.innerHeight * 0.72, 640);

    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = getCtx(canvas);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    rngRef.current = ranked ? mulberry32(rankedSeed >>> 0) : null;
    flapsRef.current = [];
    playSizeRef.current = { w, h };
    resetFrameDamage();
    stateRef.current = createInitialState(w, h, highScore, rngRef.current || undefined);
    setReady(true);
  }, [highScore, ranked, rankedSeed]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getCtx(canvas);
    if (!ctx) return;

    const loop = (time: number) => {
      if (!stateRef.current) return;
      const viewW = playSizeRef.current.w || canvas.width;
      const viewH = playSizeRef.current.h || canvas.height;

      if (ranked) {
        // One step per frame. A catch-up loop makes a slow frame slower
        // and desyncs the live run from the server replay.
        lastTimeRef.current = time;
        const prev = stateRef.current;
        const pw = playSizeRef.current.w || viewW;
        const ph = playSizeRef.current.h || viewH;
        const next = updateGame(prev, RANKED_DT, pw, ph, rngRef.current || Math.random);
        stateRef.current = next;
        if (next.score !== prev.score && onScoreChange) onScoreChange(next.score);
        if (next.isGameOver && !prev.isGameOver && !gameOverSent.current) {
          gameOverSent.current = true;
          stopMusic();
          playSfx("lose");
          onGameOver(next.score, next.distance, {
            score: next.score,
            distance: next.distance,
            flaps: flapsRef.current.slice(),
            frames: next.frame,
            width: pw,
            height: ph,
          });
        }
        renderFrame(ctx, next, viewW, viewH);
      } else {
        const elapsed = lastTimeRef.current ? time - lastTimeRef.current : 16.666;
        lastTimeRef.current = time;
        // Desktop: step by the time since the last frame. Phone: one step per
        // frame, like ranked, so a dropped frame is a short pause and the coin
        // never jumps. The step is sized to the screen's refresh (median of
        // recent frame gaps; one slow frame does not move it), so a 90 or
        // 120 Hz phone runs at the same speed as a 60 Hz one.
        const dt = phoneRef.current
          ? frameStep(gapsRef.current, elapsed)
          : Math.min(Math.max(elapsed / 16.666, 0.5), 2.5);
        const prev = stateRef.current;
        const next = updateGame(prev, dt, viewW, viewH, Math.random);
        stateRef.current = next;
        if (next.score !== prev.score && onScoreChange) onScoreChange(next.score);
        renderFrame(ctx, next, viewW, viewH);
        if (next.isGameOver && !prev.isGameOver && !gameOverSent.current) {
          gameOverSent.current = true;
          stopMusic();
          playSfx("lose");
          onGameOver(next.score, next.distance);
        }
      }

      const y = getYearFromScore(stateRef.current.score);
      setYear((prevYear) => (prevYear === y ? prevYear : y));

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, ready, onGameOver, onScoreChange, ranked]);

  // provisional: the phone start on finger-down. The flap and the run start
  // at once; the page, music and sound wait until the touch is a tap.
  const doFlap = useCallback((provisional = false) => {
    if (!enabled || !stateRef.current) return;
    if (stateRef.current.isGameOver) return;
    if (!provisional && stateRef.current.frame === 0 && flapsRef.current.length === 0) {
      onRunStart?.();
    }
    if (!startedRef.current) setRunning(true);
    startedRef.current = true;
    if (!provisional) {
      if (ranked) startRankedMusic();
      else startMusic();
      playSfx("flap");
    }
    flapsRef.current.push(stateRef.current.frame);
    stateRef.current = flap(stateRef.current);
  }, [enabled, onRunStart, ranked]);

  // Phone: the finger-down start is a tap. Start the page side of the run.
  const confirmStart = useCallback(() => {
    const t = startTouchRef.current;
    if (!t || t.tap) return;
    t.tap = true;
    window.clearTimeout(t.timer);
    onRunStart?.();
    if (ranked) startRankedMusic();
    else startMusic();
    playSfx("flap");
  }, [onRunStart, ranked]);

  // Phone: the finger-down start was a scroll. Put the board back as it was
  // before the touch: a fresh state, same as a new mount, so a ranked run
  // still starts from frame 0 with the seed's first number.
  const cancelStart = useCallback(() => {
    const t = startTouchRef.current;
    if (!t) return;
    window.clearTimeout(t.timer);
    startTouchRef.current = null;
    startedRef.current = false;
    setRunning(false);
    resize();
  }, [resize]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        doFlap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFlap]);

  // Native, non-passive touchstart: React's is passive, so its preventDefault
  // is ignored and the tap also fires a click, which flapped a second time.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const find = (list: TouchList, id: number) => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    const onTouch = (e: TouchEvent) => {
      if (phoneRef.current && !startedRef.current) {
        // Phone, before the run: start on finger-down, without preventDefault
        // so the touch can still become a scroll (touch-action: pan-y). A move
        // past SWIPE_SLOP undoes the start; lifting or holding still keeps it.
        const touch = e.changedTouches[0];
        if (!touch || startTouchRef.current) return;
        touchAtRef.current = performance.now();
        doFlap(true);
        if (!startedRef.current) return;
        startTouchRef.current = {
          id: touch.identifier,
          x: touch.clientX,
          y: touch.clientY,
          tap: false,
          timer: window.setTimeout(confirmStart, TAP_HOLD_MS),
        };
        return;
      }
      // A second finger while the start touch is still undecided: it is a tap.
      confirmStart();
      e.preventDefault();
      doFlap();
    };
    const onMove = (e: TouchEvent) => {
      const t = startTouchRef.current;
      const touch = t && find(e.changedTouches, t.id);
      if (!t || !touch) return;
      if (t.tap) {
        // The run is on: keep the page still under it.
        if (e.cancelable) e.preventDefault();
        return;
      }
      const dx = Math.abs(touch.clientX - t.x);
      const dy = Math.abs(touch.clientY - t.y);
      if (dy > SWIPE_SLOP && dy > dx) cancelStart();
    };
    const onEnd = (e: TouchEvent) => {
      const t = startTouchRef.current;
      if (!t || !find(e.changedTouches, t.id)) return;
      touchAtRef.current = performance.now();
      // No click: the run already started on finger-down.
      if (e.cancelable) e.preventDefault();
      if (!t.tap) confirmStart();
      // Lifting a finger is a user gesture; the hold timer was not, so the
      // music may still be waiting for one.
      else if (ranked) startRankedMusic();
      else startMusic();
      startTouchRef.current = null;
    };
    const onCancel = (e: TouchEvent) => {
      const t = startTouchRef.current;
      if (!t || !find(e.changedTouches, t.id)) return;
      if (t.tap) startTouchRef.current = null;
      else cancelStart();
    };
    canvas.addEventListener("touchstart", onTouch, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
    canvas.addEventListener("touchcancel", onCancel);
    return () => {
      canvas.removeEventListener("touchstart", onTouch);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onEnd);
      canvas.removeEventListener("touchcancel", onCancel);
    };
  }, [doFlap, confirmStart, cancelStart, ranked]);

  useEffect(() => {
    const t = startTouchRef;
    return () => {
      if (t.current) window.clearTimeout(t.current.timer);
    };
  }, []);

  // Phone free play: make the AudioContext while idle, not in the start tap.
  useEffect(() => {
    if (!phone || ranked) return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warmMusic, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warmMusic, 500);
    return () => window.clearTimeout(id);
  }, [phone, ranked]);

  useIsoLayoutEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [resize]);

  return (
    <div
      className={`relative w-full h-full min-h-[320px] max-lg:min-h-0 overflow-hidden ${className}`}
      style={{ isolation: "isolate" }}
    >
      {ranked ? (
        // Ranked: the pre-recorded year clips.
        <YearStage year={year} clip />
      ) : (
        // Free play, every device: one still image per year. No iframe, no clip.
        <YearStill year={year} />
      )}
      <button
        type="button"
        aria-label="Mute music"
        onClick={(e) => {
          e.stopPropagation();
          toggleMusic();
          (e.currentTarget as HTMLButtonElement).textContent = musicMuted() ? "MUSIC OFF" : "MUSIC";
        }}
        className="absolute right-2 top-2 z-20 rounded border border-white/20 bg-black/40 px-2 py-1 text-[10px] font-mono text-white/80"
      >
        MUSIC
      </button>
      <canvas
        ref={canvasRef}
        className="relative z-10 h-full w-full bg-transparent cursor-pointer touch-none"
        style={{
          transform: "translateZ(0)",
          contain: "strict",
          willChange: "transform",
          // Phone, before the run: vertical swipes scroll the page
          ...(phone && !running ? { touchAction: "pan-y" } : null),
        }}
        onClick={() => {
          // Phone: the touch already started or flapped; this is its click.
          // If the start was undone but the browser still saw a tap (it sent
          // this click), the click starts the run instead of being dropped.
          if (startedRef.current && performance.now() - touchAtRef.current < 800) return;
          doFlap();
        }}
      />
      {phone && !running && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
          style={{ top: "calc(62% + 44px)" }}
        >
          <span className="rounded-full border border-alien-cyan/50 bg-alien-void/80 px-5 py-2 text-sm font-semibold tracking-[0.2em] text-alien-cyan shadow-glow">
            TAP TO START
          </span>
        </div>
      )}
    </div>
  );
}
