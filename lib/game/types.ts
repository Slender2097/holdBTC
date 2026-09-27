/** Core game types for CandleBird */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The player-controlled Bitcoin coin */
export interface Bird {
  x: number;
  y: number;
  radius: number;
  velocity: number;
  rotation: number; // visual tilt
}

/** A Japanese candlestick obstacle (pair: top + bottom with gap) */
export interface Candlestick {
  id: number;
  x: number;
  /** Top wick top Y */
  topWickTop: number;
  /** Top body top Y */
  topBodyTop: number;
  /** Top body bottom Y (= gap top) */
  topBodyBottom: number;
  /** Bottom body top Y (= gap bottom) */
  bottomBodyTop: number;
  /** Bottom body bottom Y */
  bottomBodyBottom: number;
  /** Bottom wick bottom Y */
  bottomWickBottom: number;
  width: number;
  isGreen: boolean; // true = bullish (green), false = bearish (red)
  scored: boolean; // already counted for score?
  /** Slight visual variation */
  bodyWidthRatio: number;
}

export interface GameState {
  bird: Bird;
  candlesticks: Candlestick[];
  score: number; // distance in "pips"
  distance: number; // continuous for scoring
  isPlaying: boolean;
  isGameOver: boolean;
  isReady: boolean; // waiting for first flap
  speed: number;
  frame: number;
  lastCandleX: number;
  highScore: number;
}

export type GameAction =
  | { type: "FLAP" }
  | { type: "TICK"; dt: number; canvasWidth: number; canvasHeight: number }
  | { type: "START" }
  | { type: "RESTART" }
  | { type: "GAME_OVER" }
  | { type: "SET_HIGH_SCORE"; score: number };
