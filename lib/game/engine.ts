import { GAME } from "./constants";
import type { Bird, Candlestick, GameState } from "./types";
import { mulberry32, type Rng } from "./rng";

let nextCandleId = 1;

export const RANKED_DT = 1;
export const RANKED_WORLD_W = 960;
export const RANKED_WORLD_H = 720;
export const RANKED_TICK_MS = 1000 / 60;
export const MAX_REPLAY_FRAMES = 24_000;
export const MAX_FLAPS = 4_000;

export function getYearFromScore(score: number): number {
  return GAME.START_YEAR + Math.floor(score / GAME.PIPS_PER_YEAR);
}

export function getDifficulty(score: number) {
  const year = getYearFromScore(score);
  const yearsPassed = Math.max(0, year - GAME.START_YEAR);
  const speedMult = 1 + yearsPassed * 0.045;
  const gapMult = Math.max(0.55, 1 - yearsPassed * 0.018);
  const spawnMult = Math.max(0.6, 1 - yearsPassed * 0.015);
  return {
    year,
    speed: Math.min(GAME.CANDLE_SPEED * speedMult, 6.8),
    gapMin: GAME.CANDLE_GAP_MIN * gapMult,
    gapMax: GAME.CANDLE_GAP_MAX * gapMult,
    spawnDistance: GAME.CANDLE_SPAWN_DISTANCE * spawnMult,
  };
}

export function createBird(canvasWidth: number, canvasHeight: number): Bird {
  return {
    x: canvasWidth * GAME.BIRD_X_RATIO,
    y: canvasHeight * 0.45,
    radius: GAME.BIRD_RADIUS,
    velocity: 0,
    rotation: 0,
  };
}

export function createCandlestick(
  x: number,
  canvasHeight: number,
  gapMin: number,
  gapMax: number,
  rng: Rng = Math.random
): Candlestick {
  const green = rng() > 0.48;
  const gapBase = green
    ? gapMin + rng() * (gapMax - gapMin + 12)
    : gapMin + rng() * (gapMax - gapMin);
  const gap = Math.min(gapBase, canvasHeight * 0.42);
  const minCenter = gap / 2 + 40;
  const maxCenter = canvasHeight - gap / 2 - 40;
  const gapCenter = minCenter + rng() * Math.max(1, maxCenter - minCenter);
  const gapTop = gapCenter - gap / 2;
  const gapBottom = gapCenter + gap / 2;
  const topAvailable = gapTop - 20;
  const bottomAvailable = canvasHeight - gapBottom - 20;
  const topBodyH = Math.max(28, topAvailable * (0.25 + rng() * 0.55));
  const bottomBodyH = Math.max(28, bottomAvailable * (0.25 + rng() * 0.55));
  const topBodyBottom = gapTop;
  const topBodyTop = topBodyBottom - topBodyH;
  const topWickTop = Math.max(8, topBodyTop - (GAME.WICK_MIN + rng() * GAME.WICK_MAX));
  const bottomBodyTop = gapBottom;
  const bottomBodyBottom = bottomBodyTop + bottomBodyH;
  const bottomWickBottom = Math.min(
    canvasHeight - 8,
    bottomBodyBottom + (GAME.WICK_MIN + rng() * GAME.WICK_MAX)
  );

  return {
    id: nextCandleId++,
    x,
    topWickTop,
    topBodyTop,
    topBodyBottom,
    bottomBodyTop,
    bottomBodyBottom,
    bottomWickBottom,
    width: GAME.CANDLE_WIDTH,
    isGreen: green,
    scored: false,
    bodyWidthRatio: 0.72 + rng() * 0.2,
  };
}

function circleRectCollision(
  cx: number,
  cy: number,
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < radius * radius;
}

export function checkCandleCollision(bird: Bird, c: Candlestick): boolean {
  const halfW = (c.width * c.bodyWidthRatio) / 2;
  const bodyLeft = c.x - halfW;
  const bodyW = c.width * c.bodyWidthRatio;

  if (
    circleRectCollision(bird.x, bird.y, bird.radius * 0.85, bodyLeft, c.topBodyTop, bodyW, c.topBodyBottom - c.topBodyTop)
  )
    return true;
  if (
    circleRectCollision(
      bird.x,
      bird.y,
      bird.radius * 0.85,
      bodyLeft,
      c.bottomBodyTop,
      bodyW,
      c.bottomBodyBottom - c.bottomBodyTop
    )
  )
    return true;

  const wickW = 4;
  const wickLeft = c.x - wickW / 2;
  if (circleRectCollision(bird.x, bird.y, bird.radius * 0.7, wickLeft, c.topWickTop, wickW, c.topBodyTop - c.topWickTop))
    return true;
  if (
    circleRectCollision(
      bird.x,
      bird.y,
      bird.radius * 0.7,
      wickLeft,
      c.bottomBodyBottom,
      wickW,
      c.bottomWickBottom - c.bottomBodyBottom
    )
  )
    return true;
  return false;
}

export function createInitialState(
  canvasWidth: number,
  canvasHeight: number,
  highScore = 0,
  seedOrRng?: number | Rng
): GameState {
  nextCandleId = 1;
  const rng: Rng =
    typeof seedOrRng === "function"
      ? seedOrRng
      : seedOrRng != null
        ? mulberry32(seedOrRng >>> 0)
        : Math.random;
  const bird = createBird(canvasWidth, canvasHeight);
  const diff = getDifficulty(0);
  const candles: Candlestick[] = [];
  let x = canvasWidth + 80;
  for (let i = 0; i < 4; i++) {
    candles.push(createCandlestick(x, canvasHeight, diff.gapMin, diff.gapMax, rng));
    x += diff.spawnDistance + rng() * 40;
  }
  return {
    bird,
    candlesticks: candles,
    score: 0,
    distance: 0,
    isPlaying: false,
    isGameOver: false,
    isReady: true,
    speed: diff.speed,
    frame: 0,
    lastCandleX: x,
    highScore,
  };
}

export function updateGame(
  state: GameState,
  dt: number,
  canvasWidth: number,
  canvasHeight: number,
  rng: Rng = Math.random
): GameState {
  if (!state.isPlaying || state.isGameOver) return state;

  const bird = { ...state.bird };
  bird.velocity += GAME.GRAVITY * dt;
  bird.velocity = Math.min(bird.velocity, GAME.MAX_FALL_SPEED);
  bird.velocity = Math.max(bird.velocity, GAME.MAX_RISE_SPEED);
  bird.y += bird.velocity * dt;
  bird.rotation = Math.max(-0.6, Math.min(0.9, bird.velocity * 0.08));

  if (bird.y - bird.radius < 0 || bird.y + bird.radius > canvasHeight) {
    return { ...state, bird, isGameOver: true, isPlaying: false };
  }

  const diff = getDifficulty(state.score);
  let distance = state.distance + diff.speed * dt * GAME.PIP_PER_PIXEL;
  const candlesticks = state.candlesticks
    .map((c) => {
      const nx = c.x - diff.speed * dt;
      let scored = c.scored;
      if (!scored && nx + c.width / 2 < bird.x) scored = true;
      return { ...c, x: nx, scored };
    })
    .filter((c) => c.x + c.width > -50);

  let lastCandleX = state.lastCandleX - diff.speed * dt;
  while (lastCandleX < canvasWidth + 300) {
    lastCandleX += diff.spawnDistance + rng() * 50;
    candlesticks.push(createCandlestick(lastCandleX, canvasHeight, diff.gapMin, diff.gapMax, rng));
  }

  for (const c of candlesticks) {
    if (checkCandleCollision(bird, c)) {
      return {
        ...state,
        bird,
        candlesticks,
        score: Math.floor(distance),
        distance,
        lastCandleX,
        speed: diff.speed,
        isGameOver: true,
        isPlaying: false,
        frame: state.frame + 1,
      };
    }
  }

  return {
    ...state,
    bird,
    candlesticks,
    score: Math.floor(distance),
    distance,
    lastCandleX,
    speed: diff.speed,
    frame: state.frame + 1,
  };
}

export function flap(state: GameState): GameState {
  if (state.isGameOver) return state;
  const bird = { ...state.bird, velocity: GAME.FLAP_STRENGTH };
  if (state.isReady) {
    return { ...state, bird, isReady: false, isPlaying: true };
  }
  return { ...state, bird };
}

export function replayRun(params: {
  seed: number;
  flaps: number[];
  width?: number;
  height?: number;
  maxFrames?: number;
}): { score: number; distance: number; frames: number; dead: boolean } {
  const width = Math.min(1400, Math.max(320, Math.floor(params.width || RANKED_WORLD_W)));
  const height = Math.min(900, Math.max(240, Math.floor(params.height || RANKED_WORLD_H)));
  const maxFrames = Math.min(params.maxFrames ?? MAX_REPLAY_FRAMES, MAX_REPLAY_FRAMES);
  const flaps = [...new Set(params.flaps.map((n) => Math.floor(n)))]
    .filter((n) => n >= 0 && n <= maxFrames)
    .sort((a, b) => a - b)
    .slice(0, MAX_FLAPS);
  const flapAt = new Set(flaps);
  const rng = mulberry32(params.seed >>> 0);

  let state = createInitialState(width, height, 0, rng);
  if (flapAt.has(0)) state = flap(state);

  for (let i = 0; i < maxFrames; i++) {
    if (i > 0 && flapAt.has(i)) state = flap(state);
    if (!state.isPlaying && !state.isGameOver) {
      return { score: 0, distance: 0, frames: i, dead: true };
    }
    state = updateGame(state, RANKED_DT, width, height, rng);
    if (state.isGameOver) {
      return {
        score: state.score,
        distance: state.distance,
        frames: state.frame,
        dead: true,
      };
    }
  }

  return {
    score: state.score,
    distance: state.distance,
    frames: state.frame,
    dead: false,
  };
}
