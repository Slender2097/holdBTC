import { getYearTheme } from "./constants";
import { getYearFromScore } from "./engine";
import type { Bird, Candlestick, GameState } from "./types";

const PAPER = "#f3edd4";
const INK = "#222222";
const GREEN_FILL = "#a8e6b3";
const GREEN_INK = "#2b8a3e";
const RED_FILL = "#ffa8a8";
const RED_INK = "#c92a2a";

function wobble(n: number, amp: number) {
  return Math.sin(n) * amp;
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState
) {
  const year = getYearFromScore(state.score);
  const theme = getYearTheme(year);

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, theme.skyTop + "22");
  wash.addColorStop(1, theme.skyBottom + "33");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  drawHistoryClips(ctx, width, height, state, year, theme.accent);

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = theme.accent;
  ctx.font = `900 ${Math.min(width, height) * 0.26}px "Comic Sans MS", "Chalkboard SE", system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(year), width / 2, height / 2);
  ctx.restore();
}

function drawHistoryClips(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  year: number,
  accent: string
) {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const drift = (state.distance * 0.2) % (width + 80);

  if (year <= 2009) {
    for (let i = 0; i < 5; i++) {
      const x = ((i * 180 - drift) % (width + 100)) - 40;
      const y = 50 + (i % 3) * 90;
      ctx.strokeRect(x, y, 70, 44);
      ctx.font = "10px Comic Sans MS, system-ui";
      ctx.fillText("TIMES", x + 8, y + 26);
    }
  } else if (year === 2010) {
    ctx.font = "22px Comic Sans MS, serif";
    for (let i = 0; i < 6; i++) {
      const x = ((i * 170 - drift) % (width + 60)) - 20;
      ctx.fillText("pizza", x, 70 + (i % 4) * 80);
    }
  } else if (year >= 2014 && year <= 2015) {
    ctx.strokeStyle = "#c92a2a";
    for (let i = 0; i < 10; i++) {
      const x = ((i * 90 - drift) % (width + 40)) - 10;
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x + 20, height - 40);
      ctx.stroke();
    }
  } else if (year === 2019 || year >= 2027) {
    for (let i = 0; i < 8; i++) {
      const x = ((i * 130 - drift) % (width + 50)) - 20;
      ctx.beginPath();
      ctx.arc(x, 80 + (i % 3) * 70, 16, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const x = ((i * 120 - drift) % (width + 40)) - 16;
      const y = 36 + (i % 5) * 70;
      ctx.strokeRect(x, y, 26, 16);
    }
  }
  ctx.restore();

  if (year >= 2027) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#F7931A";
    ctx.font = `bold ${Math.min(22, width * 0.045)}px "Comic Sans MS", system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("STAY HUMBLE, STACK SATS", width / 2, height * 0.16);
    ctx.restore();
  }
}

export function drawCandlestick(ctx: CanvasRenderingContext2D, c: Candlestick) {
  const bodyW = Math.max(22, c.width * c.bodyWidthRatio);
  const bodyLeft = c.x - bodyW / 2;
  const fill = c.isGreen ? GREEN_FILL : RED_FILL;
  const ink = c.isGreen ? GREEN_INK : RED_INK;
  const j = wobble(c.id * 1.7, 1.2);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(c.x + j, c.topWickTop);
  ctx.lineTo(c.x - j * 0.4, c.topBodyTop);
  ctx.moveTo(c.x - j, c.bottomBodyBottom);
  ctx.lineTo(c.x + j * 0.3, c.bottomWickBottom);
  ctx.stroke();

  const topH = c.topBodyBottom - c.topBodyTop;
  if (topH > 2) {
    ctx.fillStyle = fill;
    ctx.fillRect(bodyLeft + j, c.topBodyTop, bodyW, topH);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(bodyLeft + j, c.topBodyTop, bodyW, topH);
  }

  const botH = c.bottomBodyBottom - c.bottomBodyTop;
  if (botH > 2) {
    ctx.fillStyle = fill;
    ctx.fillRect(bodyLeft - j, c.bottomBodyTop, bodyW, botH);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(bodyLeft - j, c.bottomBodyTop, bodyW, botH);
  }
  ctx.restore();
}

export function drawBird(ctx: CanvasRenderingContext2D, bird: Bird) {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rotation);
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.fillStyle = "#F7931A";
  ctx.beginPath();
  ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.ellipse(-5, -6, 5, 3.2, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `bold ${bird.radius * 1.15}px "Comic Sans MS", system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", 0, 1);
  ctx.restore();
}

export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number
) {
  const year = getYearFromScore(state.score);
  const theme = getYearTheme(year);
  const font = `"Comic Sans MS", "Chalkboard SE", system-ui`;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `bold ${Math.max(28, Math.min(42, width * 0.07))}px ${font}`;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillText(String(state.score), width / 2 + 2, 18);
  ctx.fillStyle = INK;
  ctx.fillText(String(state.score), width / 2, 16);

  ctx.font = `12px ${font}`;
  ctx.fillStyle = "#555";
  ctx.fillText("PIPS", width / 2, Math.max(52, width * 0.09));

  ctx.font = `bold ${Math.max(11, Math.min(14, width * 0.028))}px ${font}`;
  ctx.fillStyle = theme.accent;
  ctx.fillText(theme.label, width / 2, Math.max(70, width * 0.12));

  if (state.isReady && !state.isGameOver) {
    ctx.fillStyle = INK;
    ctx.font = `bold ${Math.max(16, Math.min(20, width * 0.038))}px ${font}`;
    ctx.fillText("TAP / SPACE to flap", width / 2, height * 0.62);
    ctx.font = `${Math.max(12, Math.min(15, width * 0.028))}px ${font}`;
    ctx.fillStyle = "#c46b00";
    ctx.fillText("Fly through Bitcoin history", width / 2, height * 0.62 + 26);
  }
  ctx.restore();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number
) {
  drawBackground(ctx, width, height, state);
  for (const c of state.candlesticks) drawCandlestick(ctx, c);
  drawBird(ctx, state.bird);
  drawHUD(ctx, state, width, height);
}
