/** Tunable game constants – tweak for feel */

export const GAME = {
  // Physics
  GRAVITY: 0.45,
  FLAP_STRENGTH: -8.2,
  MAX_FALL_SPEED: 12,
  MAX_RISE_SPEED: -10,

  // Bird
  BIRD_RADIUS: 18,
  BIRD_X_RATIO: 0.22,

  // Candlesticks (base values – get harder over years)
  CANDLE_WIDTH: 48,
  CANDLE_GAP_MIN: 130,
  CANDLE_GAP_MAX: 175,
  CANDLE_SPAWN_DISTANCE: 220,
  CANDLE_SPEED: 2.8,
  WICK_MIN: 18,
  WICK_MAX: 55,
  BODY_MIN_RATIO: 0.35,

  // Scoring & Progression
  PIP_PER_PIXEL: 0.08,
  PIPS_PER_YEAR: 1000, // every 1000 pips ≈ 1 year
  START_YEAR: 2008,

  // Visual
  GROUND_HEIGHT: 0,
  BG_SPEED: 0.4,

  // Colors
  COLORS: {
    skyTop: "#0a0a12",
    skyBottom: "#12121f",
    birdOrange: "#F7931A",
    birdHighlight: "#ffb347",
    greenBody: "#26a69a",
    greenWick: "#1e8a7e",
    redBody: "#ef5350",
    redWick: "#c62828",
    text: "#ffffff",
    scoreBg: "rgba(0,0,0,0.45)",
  },
} as const;

/** Year themes for backgrounds (cartoon style) */
export interface YearTheme {
  year: number;
  name: string;
  skyTop: string;
  skyBottom: string;
  accent: string;
  particles: "stars" | "sats" | "crash" | "pizza" | "blocks" | "none";
  label: string;
  isDarkMode?: boolean; // 2027+
}

export const YEAR_THEMES: Record<number, YearTheme> = {
  2008: {
    year: 2008,
    name: "Whitepaper",
    skyTop: "#1a1a2e",
    skyBottom: "#16213e",
    accent: "#e94560",
    particles: "stars",
    label: "2008 · The Whitepaper",
  },
  2009: {
    year: 2009,
    name: "Genesis",
    skyTop: "#0f0f23",
    skyBottom: "#1a1a3e",
    accent: "#00ff9f",
    particles: "blocks",
    label: "2009 · Genesis Block",
  },
  2010: {
    year: 2010,
    name: "Pizza Day",
    skyTop: "#2d1b00",
    skyBottom: "#4a2c0a",
    accent: "#ff6b35",
    particles: "pizza",
    label: "2010 · Pizza Day",
  },
  2011: {
    year: 2011,
    name: "First Boom",
    skyTop: "#1a0a2e",
    skyBottom: "#2e1065",
    accent: "#c084fc",
    particles: "sats",
    label: "2011 · First Boom & Crash",
  },
  2012: {
    year: 2012,
    name: "First Halving",
    skyTop: "#0c1445",
    skyBottom: "#1e3a5f",
    accent: "#38bdf8",
    particles: "blocks",
    label: "2012 · First Halving",
  },
  2013: {
    year: 2013,
    name: "To the Moon",
    skyTop: "#1e1b4b",
    skyBottom: "#312e81",
    accent: "#a78bfa",
    particles: "sats",
    label: "2013 · $1,000+",
  },
  2014: {
    year: 2014,
    name: "Mt. Gox",
    skyTop: "#450a0a",
    skyBottom: "#7f1d1d",
    accent: "#f87171",
    particles: "crash",
    label: "2014 · Mt. Gox",
  },
  2015: {
    year: 2015,
    name: "Quiet Years",
    skyTop: "#0f172a",
    skyBottom: "#1e293b",
    accent: "#94a3b8",
    particles: "stars",
    label: "2015 · Consolidation",
  },
  2016: {
    year: 2016,
    name: "Second Halving",
    skyTop: "#0c4a6e",
    skyBottom: "#075985",
    accent: "#38bdf8",
    particles: "blocks",
    label: "2016 · Second Halving",
  },
  2017: {
    year: 2017,
    name: "ICO Mania",
    skyTop: "#3b0764",
    skyBottom: "#581c87",
    accent: "#e879f9",
    particles: "sats",
    label: "2017 · ATH $20k · ICO Boom",
  },
  2018: {
    year: 2018,
    name: "Crypto Winter",
    skyTop: "#0c1222",
    skyBottom: "#1e293b",
    accent: "#64748b",
    particles: "stars",
    label: "2018 · Crypto Winter",
  },
  2019: {
    year: 2019,
    name: "Lightning",
    skyTop: "#1e1b4b",
    skyBottom: "#312e81",
    accent: "#818cf8",
    particles: "sats",
    label: "2019 · Lightning Network",
  },
  2020: {
    year: 2020,
    name: "COVID Rally",
    skyTop: "#0f172a",
    skyBottom: "#1e3a5f",
    accent: "#22d3ee",
    particles: "blocks",
    label: "2020 · Halving + COVID Rally",
  },
  2021: {
    year: 2021,
    name: "El Salvador",
    skyTop: "#1c1917",
    skyBottom: "#292524",
    accent: "#fbbf24",
    particles: "sats",
    label: "2021 · ATH $69k · El Salvador",
  },
  2022: {
    year: 2022,
    name: "FTX Collapse",
    skyTop: "#450a0a",
    skyBottom: "#7f1d1d",
    accent: "#fca5a5",
    particles: "crash",
    label: "2022 · FTX · Bear Market",
  },
  2023: {
    year: 2023,
    name: "ETF Speculation",
    skyTop: "#0f172a",
    skyBottom: "#1e293b",
    accent: "#38bdf8",
    particles: "blocks",
    label: "2023 · ETF Speculation",
  },
  2024: {
    year: 2024,
    name: "ETF Approval",
    skyTop: "#1c1917",
    skyBottom: "#44403c",
    accent: "#f59e0b",
    particles: "sats",
    label: "2024 · ETFs + 4th Halving · $100k",
  },
  2025: {
    year: 2025,
    name: "Strategic Reserve",
    skyTop: "#1c1917",
    skyBottom: "#292524",
    accent: "#fbbf24",
    particles: "sats",
    label: "2025 · ATH $126k · Strategic Reserve",
  },
  2026: {
    year: 2026,
    name: "Maturity",
    skyTop: "#1c1000",
    skyBottom: "#3d2b00",
    accent: "#F7931A",
    particles: "sats",
    label: "2026 · Solar Mining · Mass Adoption",
  },
};

/** Fallback theme for any year >= 2027 */
export function getYearTheme(year: number): YearTheme {
  if (year >= 2027) {
    return {
      year,
      name: "Stay Humble",
      skyTop: "#000000",
      skyBottom: "#050505",
      accent: "#F7931A",
      particles: "sats",
      label: `${year} · STAY HUMBLE, STACK SATS`,
      isDarkMode: true,
    };
  }
  return (
    YEAR_THEMES[year] || {
      year,
      name: "Unknown",
      skyTop: "#0a0a12",
      skyBottom: "#12121f",
      accent: "#F7931A",
      particles: "stars",
      label: `${year}`,
    }
  );
}

export type GameConstants = typeof GAME;
