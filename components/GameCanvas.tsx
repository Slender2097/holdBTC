"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createInitialState,
  flap,
  updateGame,
} from "@/lib/game/engine";
import { renderFrame } from "@/lib/game/renderer";
import type { GameState } from "@/lib/game/types";

interface GameCanvasProps {
  onGameOver: (score: number, distance: number) => void;
  onScoreChange?: (score: number) => void;
  highScore?: number;
  enabled?: boolean; // kept for compatibility; game is free to play
  className?: string;
}

export default function GameCanvas({
  onGameOver,
  onScoreChange,
  highScore = 0,
  enabled = true,
  className = "",
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  const gameOverSent = useRef(false);

  // Resize handling
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
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (!stateRef.current) {
      stateRef.current = createInitialState(w, h, highScore);
      setReady(true);
    } else {
      stateRef.current.bird.x = w * 0.22;
    }
  }, [highScore]);

  // Main loop
  useEffect(() => {
    if (!enabled || !ready) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const loop = (time: number) => {
      if (!stateRef.current) return;

      const rawDt = lastTimeRef.current ? (time - lastTimeRef.current) / 16.666 : 1;
      const dt = Math.min(Math.max(rawDt, 0.5), 2.5);
      lastTimeRef.current = time;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      const prev = stateRef.current;
      const next = updateGame(prev, dt, w, h);
      stateRef.current = next;

      if (next.score !== prev.score && onScoreChange) {
        onScoreChange(next.score);
      }

      renderFrame(ctx, next, w, h);

      if (next.isGameOver && !prev.isGameOver && !gameOverSent.current) {
        gameOverSent.current = true;
        onGameOver(next.score, next.distance);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, ready, onGameOver, onScoreChange]);

  // Input handlers
  const doFlap = useCallback(() => {
    if (!enabled || !stateRef.current) return;
    if (stateRef.current.isGameOver) return;
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

  // Resize observer
  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (canvasRef.current?.parentElement) {
      ro.observe(canvasRef.current.parentElement);
    }
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [resize]);

  const restart = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    stateRef.current = createInitialState(w, h, highScore);
    gameOverSent.current = false;
    lastTimeRef.current = 0;
  }, [highScore]);

  useEffect(() => {
    (window as any).__candlebirdRestart = restart;
    return () => {
      delete (window as any).__candlebirdRestart;
    };
  }, [restart]);

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
      {/* Game is free — no paywall overlay */}
    </div>
  );
}