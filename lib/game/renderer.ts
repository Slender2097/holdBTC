import { GAME, getYearTheme, type YearTheme } from "./constants";
import { getYearFromScore } from "./engine";
import type { Bird, Candlestick, GameState } from "./types";

/** Draw a themed background based on current year */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState
) {
  const year = getYearFromScore(state.score);
  const theme = getYearTheme(year);

  // Base gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, theme.skyTop);
  grad.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Special dark mode for 2027+
  if (theme.isDarkMode) {
    drawDarkModeBackground(ctx, width, height, state, theme);
    return;
  }

  // Cartoon particles / decorations per theme
  drawThemeParticles(ctx, width, height, state, theme);

  // Subtle year watermark
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = theme.accent;
  ctx.font = `bold ${Math.min(width, height) * 0.22}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(year), width / 2, height / 2);
  ctx.restore();
}

/** Post-2026: pure black cyberpunk minimal */
function drawDarkModeBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  theme: YearTheme
) {
  // Pure black
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // Subtle orange circuit lines
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1;

  const offset = (state.distance * 0.3) % 80;
  for (let i = -1; i < width / 60 + 2; i++) {
    const x = i * 60 - offset;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 30, height * 0.3);
    ctx.lineTo(x, height * 0.6);
    ctx.lineTo(x + 40, height);
    ctx.stroke();
  }

  // Floating sats particles
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = theme.accent;
  for (let i = 0; i < 18; i++) {
    const sx = ((i * 137 + state.distance * 0.4) % (width + 40)) - 20;
    const sy = (i * 89 + state.frame * 0.3) % height;
    const size = 1.5 + (i % 3);
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Big glowing text
  drawStayHumbleText(ctx, width, height, state);
}

/** Glitchy terminal-style overlay text */
function drawStayHumbleText(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState
) {
  const text = "STAY HUMBLE, STACK SATS";
  const fontSize = Math.min(28, width * 0.055);
  ctx.save();

  ctx.font = `bold ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const y = height * 0.18;
  const time = state.frame;

  // Subtle glitch: occasional RGB split
  const glitch = Math.sin(time * 0.08) > 0.92;
  if (glitch) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ff0040";
    ctx.fillText(text, width / 2 - 2, y);
    ctx.fillStyle = "#00f0ff";
    ctx.fillText(text, width / 2 + 2, y);
  }

  // Main orange glow
  ctx.globalAlpha = 1;
  ctx.shadowColor = "rgba(247, 147, 26, 0.7)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#F7931A";
  ctx.fillText(text, width / 2, y);

  // Soft second pass
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.35;
  ctx.fillText(text, width / 2, y);

  ctx.restore();
}

/** Simple cartoon particles depending on theme */
function drawThemeParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  theme: YearTheme
) {
  ctx.save();
  const offset = state.distance * 0.25;

  if (theme.particles === "stars" || theme.particles === "none") {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 35; i++) {
      const sx = ((i * 97 + offset * 0.3) % (width + 30)) - 15;
      const sy = (i * 53) % height;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.8 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (theme.particles === "sats") {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme.accent;
    for (let i = 0; i < 22; i++) {
      const sx = ((i * 113 + offset) % (width + 40)) - 20;
      const sy = (i * 67 + state.frame * 0.2) % height;
      ctx.font = `${8 + (i % 4)}px system-ui`;
      ctx.fillText("₿", sx, sy);
    }
  }

  if (theme.particles === "blocks") {
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const sx = ((i * 140 + offset * 0.6) % (width + 60)) - 30;
      const sy = 40 + (i * 70) % (height - 80);
      ctx.strokeRect(sx, sy, 28, 18);
    }
  }

  if (theme.particles === "pizza") {
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
      const sx = ((i * 160 + offset * 0.5) % (width + 50)) - 25;
      const sy = 50 + (i * 90) % (height - 100);
      ctx.font = "16px serif";
      ctx.fillText("🍕", sx, sy);
    }
  }

  if (theme.particles === "crash") {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ef4444";
    for (let i = 0; i < 20; i++) {
      const sx = ((i * 89 + offset * 1.2) % (width + 30)) - 15;
      const sy = (i * 71) % height;
      ctx.fillRect(sx, sy, 3, 3);
    }
  }

  ctx.restore();
}

/** Draw a single realistic candlestick */
export function drawCandlestick(ctx: CanvasRenderingContext2D, c: Candlestick) {
  const bodyW = c.width * c.bodyWidthRatio;
  const bodyLeft = c.x - bodyW / 2;
  const wickW = 3.5;
  const colorBody = c.isGreen ? GAME.COLORS.greenBody : GAME.COLORS.redBody;
  const colorWick = c.isGreen ? GAME.COLORS.greenWick : GAME.COLORS.redWick;

  ctx.strokeStyle = colorWick;
  ctx.lineWidth = wickW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(c.x, c.topWickTop);
  ctx.lineTo(c.x, c.topBodyTop);
  ctx.moveTo(c.x, c.bottomBodyBottom);
  ctx.lineTo(c.x, c.bottomWickBottom);
  ctx.stroke();

  const topH = c.topBodyBottom - c.topBodyTop;
  if (topH > 2) {
    const g = ctx.createLinearGradient(bodyLeft, 0, bodyLeft + bodyW, 0);
    if (c.isGreen) {
      g.addColorStop(0, "#1e8a7e");
      g.addColorStop(0.4, colorBody);
      g.addColorStop(1, "#2bbbad");
    } else {
      g.addColorStop(0, "#c62828");
      g.addColorStop(0.4, colorBody);
      g.addColorStop(1, "#ff6f60");
    }
    ctx.fillStyle = g;
    roundRect(ctx, bodyLeft, c.topBodyTop, bodyW, topH, 3);
    ctx.fill();
  }

  const botH = c.bottomBodyBottom - c.bottomBodyTop;
  if (botH > 2) {
    const g2 = ctx.createLinearGradient(bodyLeft, 0, bodyLeft + bodyW, 0);
    if (c.isGreen) {
      g2.addColorStop(0, "#1e8a7e");
      g2.addColorStop(0.4, colorBody);
      g2.addColorStop(1, "#2bbbad");
    } else {
      g2.addColorStop(0, "#c62828");
      g2.addColorStop(0.4, colorBody);
      g2.addColorStop(1, "#ff6f60");
    }
    ctx.fillStyle = g2;
    roundRect(ctx, bodyLeft, c.bottomBodyTop, bodyW, botH, 3);
    ctx.fill();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draw the Bitcoin coin (bird) */
export function drawBird(ctx: CanvasRenderingContext2D, bird: Bird) {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rotation);

  ctx.shadowColor = "rgba(247, 147, 26, 0.55)";
  ctx.shadowBlur = 18;

  const grad = ctx.createRadialGradient(-4, -4, 2, 0, 0, bird.radius);
  grad.addColorStop(0, GAME.COLORS.birdHighlight);
  grad.addColorStop(0.7, GAME.COLORS.birdOrange);
  grad.addColorStop(1, "#c46b00");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, bird.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, bird.radius * 0.72, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.font = `bold ${bird.radius * 1.1}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("₿", 0, 1);

  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(-5, -6, 5, 3.5, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Draw score + year HUD */
export function drawHUD(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number
) {
  const year = getYearFromScore(state.score);
  const theme = getYearTheme(year);

  ctx.save();

  // Score
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillText(String(state.score), width / 2 + 2, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(String(state.score), width / 2, 20);

  // PIPS label
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText("PIPS", width / 2, 64);

  // Year badge
  ctx.font = "bold 13px ui-monospace, monospace";
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.95;
  ctx.fillText(theme.label, width / 2, 82);

  // Ready message
  if (state.isReady && !state.isGameOver) {
    ctx.globalAlpha = 1;
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText("TAP / SPACE to flap", width / 2, height * 0.62);
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(247,147,26,0.85)";
    ctx.fillText("Fly through Bitcoin history", width / 2, height * 0.62 + 26);
  }

  ctx.restore();
}

/** Full frame render */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number
) {
  drawBackground(ctx, width, height, state);

  for (const c of state.candlesticks) {
    drawCandlestick(ctx, c);
  }

  drawBird(ctx, state.bird);
  drawHUD(ctx, state, width, height);
}
