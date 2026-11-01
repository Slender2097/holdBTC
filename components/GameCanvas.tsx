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
import { isDesktop, isPhone, onDesktopChange } from "@/lib/device";
import {
  musicMuted,
  playSfx,
  startMusic,
  startRankedMusic,
  stopMusic,
  toggleMusic,
  warmMusic,
  warmRankedMusic,
} from "@/lib/game/music";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Phone (lib/device.ts). null during server render and hydration.
const noSubscribe = () => () => {};
const usePhone = () => useSyncExternalStore<boolean | null>(noSubscribe, isPhone, () => null);
// Desktop (lg and up, fine pointer): the only place the year clip plays, and
// only in a paid (ranked) run.
// null during server render and hydration, so those paint the still.
const useDesktop = () => useSyncExternalStore<boolean | null>(onDesktopChange, isDesktop, () => null);

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

// Phone ranked: the same frame-rate measure, as fixed RANKED_DT ticks per
// frame, so the live run is the run the server replays. Near-whole rates
// (60, 30, 120 Hz) snap, so a 60 Hz phone takes exactly one tick per frame.
const MAX_TICKS_PER_FRAME = 3;
function tickRate(gaps: number[], elapsed: number): number {
  const r = frameStep(gaps, elapsed);
  const half = Math.round(r * 2) / 2;
  return Math.abs(r - half) < 0.04 ? half : r;
}

// Phone ranked between ticks (a 90 or 120 Hz screen): draw the coin and the
// candles part way from the last tick to the next. Drawing only; the state
// the run plays and submits is the tick state.
function between(a: GameState, b: GameState, t: number): GameState {
  if (t >= 0.999 || b.isGameOver) return b;
  const mix = (x: number, y: number) => x + (y - x) * t;
  const prev = a.candlesticks;
  return {
    ...b,
    distance: mix(a.distance, b.distance),
    bird: { ...b.bird, y: mix(a.bird.y, b.bird.y), rotation: mix(a.bird.rotation, b.bird.rotation) },
    candlesticks: b.candlesticks.map((c) => {
      for (let i = 0; i < prev.length; i++) {
        if (prev[i].id === c.id) return { ...c, x: mix(prev[i].x, c.x) };
      }
      return c;
    }),
  };
}

// Run fn after the next frame has painted.
function afterPaint(fn: () => void) {
  requestAnimationFrame(() => window.setTimeout(fn, 0));
}

// Phone ranked: the start tap only flaps. Music and the flap sound start this
// long after the finger lifts, once the first frames of the run are on
// screen. A timer set inside the touchend still counts as that tap for
// autoplay (iOS forwards the gesture to timers under 1 s).
const START_AUDIO_DELAY_MS = 32;

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
  const desktop = useDesktop() === true;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const startTouchRef = useRef<StartTouch | null>(null);
  // Phone free play: recent frame gaps (ms), for the per-frame step.
  const gapsRef = useRef<number[]>([]);
  // Phone ranked: run time in ticks (fractional), and the tick state before
  // the current one, for drawing between ticks.
  const clockRef = useRef(0);
  const tickPrevRef = useRef<GameState | null>(null);
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
    // the replay width/height stay the same. Every device caps at 1.5x, so a
    // 390 px board is a 585 px backing store on a 2x or 3x phone: the coin,
    // pips, year and HUD text are sharp. A phone has no year video next to the
    // loop (YearStill only), which is what made more pixels lag there.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
    clockRef.current = 0;
    tickPrevRef.current = null;
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
        const prev = stateRef.current;
        const pw = playSizeRef.current.w || viewW;
        const ph = playSizeRef.current.h || viewH;
        const rng = rngRef.current || Math.random;
        let next = prev;
        let view = prev;
        if (phoneRef.current) {
          // Phone: ticks of RANKED_DT (the replay's step, unchanged), as many
          // per frame as the screen's refresh calls for (median of recent
          // frame gaps): 1 at 60 Hz, 2 at 30 Hz, every other frame at
          // 120 Hz. The run moves at the same speed on every phone, and the
          // flap log still names the tick each flap landed on, so the
          // server replay matches. A slow frame adds no ticks of its own:
          // it is a short pause, never a jump.
          const elapsed = lastTimeRef.current ? time - lastTimeRef.current : 16.666;
          lastTimeRef.current = time;
          const rate = tickRate(gapsRef.current, elapsed);
          if (prev.isPlaying && !prev.isGameOver) {
            clockRef.current += rate;
            const due = Math.ceil(clockRef.current - 1e-6);
            let n = 0;
            while (next.frame < due && n < MAX_TICKS_PER_FRAME && !next.isGameOver) {
              tickPrevRef.current = next;
              next = updateGame(next, RANKED_DT, pw, ph, rng);
              n++;
            }
            // Never owe ticks: a capped frame is a pause too.
            if (clockRef.current > next.frame) clockRef.current = next.frame;
            const t = 1 - (next.frame - clockRef.current);
            view = tickPrevRef.current ? between(tickPrevRef.current, next, t) : next;
          }
        } else {
          // Desktop: one step per frame. A catch-up loop makes a slow frame
          // slower and desyncs the live run from the server replay.
          lastTimeRef.current = time;
          next = updateGame(prev, RANKED_DT, pw, ph, rng);
          view = next;
        }
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
        renderFrame(ctx, view, viewW, viewH);
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
    if (!startedRef.current) {
      // Phone: the finger-down flap touches only the game state. The React
      // render (hide TAP TO START, canvas touch-action) waits for the paint.
      if (provisional) {
        afterPaint(() => {
          if (startedRef.current) setRunning(true);
        });
      } else setRunning(true);
    }
    startedRef.current = true;
    if (!provisional) {
      if (ranked) startRankedMusic();
      else startMusic();
      playSfx("flap");
    }
    flapsRef.current.push(stateRef.current.frame);
    stateRef.current = flap(stateRef.current);
  }, [enabled, onRunStart, ranked]);

  // Phone ranked: music (and the start tap's flap sound) a moment after the
  // finger lifts, not inside the start tap.
  const startRankedAudioSoon = useCallback((withFlapSound: boolean) => {
    window.setTimeout(() => {
      if (!startedRef.current || stateRef.current?.isGameOver) return;
      startRankedMusic();
      if (withFlapSound) playSfx("flap");
    }, START_AUDIO_DELAY_MS);
  }, []);

  // Phone: the finger-down start is a tap. Start the page side of the run
  // (scroll lock, and scroll to the board if the page moved) after the next
  // paint, so the first frames of the run are not held up by page work.
  const confirmStart = useCallback(() => {
    const t = startTouchRef.current;
    if (!t || t.tap) return;
    t.tap = true;
    window.clearTimeout(t.timer);
    afterPaint(() => {
      if (startedRef.current) onRunStart?.();
    });
    if (ranked) startRankedAudioSoon(true);
    else {
      startMusic();
      playSfx("flap");
    }
  }, [onRunStart, ranked, startRankedAudioSoon]);

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
      else if (ranked) startRankedAudioSoon(false);
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
  }, [doFlap, confirmStart, cancelStart, ranked, startRankedAudioSoon]);

  useEffect(() => {
    const t = startTouchRef;
    return () => {
      if (t.current) window.clearTimeout(t.current.timer);
    };
  }, []);

  // Phone: get the run's audio ready while idle, not in the start tap. Free
  // play: the AudioContext and the flap sound. Ranked: ranked.mp3 and the
  // flap sound (the pay modal usually started these already).
  useEffect(() => {
    if (!phone) return;
    const warm = ranked ? warmRankedMusic : warmMusic;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 500);
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
      {ranked && desktop ? (
        // Desktop (lg and up, fine pointer), paid run only: the year clip,
        // with the year still under it until the clip has a frame.
        <YearStage year={year} />
      ) : (
        // Free play on every device, and phone (coarse pointer or below lg)
        // in ranked too: one still image per year. No video, no iframe.
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
