"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialState,
  flap,
  updateGame,
  RANKED_DT,
  RANKED_TICK_MS,
} from "@/lib/game/engine";
import { mulberry32, type Rng } from "@/lib/game/rng";
import { renderFrame } from "@/lib/game/renderer";
import type { GameState } from "@/lib/game/types";

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
}

export default function GameCanvas({
  onGameOver,
  onScoreChange,
  highScore = 0,
  enabled = true,
  className = "",
  rankedSeed = null,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accRef = useRef(0);
  const rngRef = useRef<Rng | null>(null);
  const flapsRef = useRef<number[]>([]);
  const playSizeRef = useRef({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const gameOverSent = useRef(false);
  const ranked = rankedSeed != null;

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = parent.clientWidth;
    const h = Math.min(parent.clientHeight, window.innerHeight * 0.72);

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!stateRef.current) {
      rngRef.current = ranked ? mulberry32(rankedSeed >>> 0) : null;
      flapsRef.current = [];
      playSizeRef.current = { w, h };
      stateRef.current = createInitialState(w, h, highScore, rngRef.current || undefined);
      setReady(true);
    } else if (!ranked) {
      stateRef.current.bird.x = w * 0.22;
    }
  }, [highScore, ranked, rankedSeed]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const loop = (time: number) => {
      if (!stateRef.current) return;
      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;

      if (ranked) {
        const raw = lastTimeRef.current ? time - lastTimeRef.current : RANKED_TICK_MS;
        lastTimeRef.current = time;
        accRef.current += Math.min(raw, RANKED_TICK_MS * 5);
        let steps = 0;
        while (accRef.current >= RANKED_TICK_MS && steps < 5 && !stateRef.current.isGameOver) {
          accRef.current -= RANKED_TICK_MS;
          steps += 1;
          const prev = stateRef.current;
          const pw = playSizeRef.current.w || viewW;
          const ph = playSizeRef.current.h || viewH;
          const next = updateGame(prev, RANKED_DT, pw, ph, rngRef.current || Math.random);
          stateRef.current = next;
          if (next.score !== prev.score && onScoreChange) onScoreChange(next.score);
          if (next.isGameOver && !prev.isGameOver && !gameOverSent.current) {
            gameOverSent.current = true;
            onGameOver(next.score, next.distance, {
              score: next.score,
              distance: next.distance,
              flaps: flapsRef.current.slice(),
              frames: next.frame,
              width: pw,
              height: ph,
            });
          }
        }
        renderFrame(ctx, stateRef.current, viewW, viewH);
      } else {
        const rawDt = lastTimeRef.current ? (time - lastTimeRef.current) / 16.666 : 1;
        const dt = Math.min(Math.max(rawDt, 0.5), 2.5);
        lastTimeRef.current = time;
        const prev = stateRef.current;
        const next = updateGame(prev, dt, viewW, viewH, Math.random);
        stateRef.current = next;
        if (next.score !== prev.score && onScoreChange) onScoreChange(next.score);
        renderFrame(ctx, next, viewW, viewH);
        if (next.isGameOver && !prev.isGameOver && !gameOverSent.current) {
          gameOverSent.current = true;
          onGameOver(next.score, next.distance);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, ready, onGameOver, onScoreChange, ranked]);

  const doFlap = useCallback(() => {
    if (!enabled || !stateRef.current) return;
    if (stateRef.current.isGameOver) return;
    flapsRef.current.push(stateRef.current.frame);
    stateRef.current = flap(stateRef.current);
  }, [enabled]);

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

  useEffect(() => {
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
    <div className={`relative w-full h-full min-h-[320px] ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-xl bg-[#0a0a12] cursor-pointer"
        onClick={doFlap}
        onTouchStart={(e) => {
          e.preventDefault();
          doFlap();
        }}
      />
    </div>
  );
}
