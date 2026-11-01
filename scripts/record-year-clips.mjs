// Records each public/years/<year>.html into a looping video clip that
// desktop free play and ranked show behind the board (components/year
// /YearStage.tsx). Video decodes off the main thread, so the full animated
// scene (scripts, CSS, crayon filter) costs the game loop about the same as a
// still image. Phone never plays these; it shows the stills.
//
// Usage: npx -y -p playwright@1.56.1 node scripts/record-year-clips.mjs [year...]
// Needs ffmpeg with libx264 on PATH. Writes public/years/clips/<year>-{p,l}.mp4.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "public/years/clips");
const LOOP_S = 30;
const FPS = 30;
const SIZES = { p: { width: 540, height: 960 }, l: { width: 960, height: 540 } };
const SCALE = Number(process.env.SCALE || 2); // 2 = 1080x1920 / 1920x1080
const CRF = process.env.CRF || "26";
const OUTDIR = process.env.OUTDIR || OUT;

const years = process.argv.slice(2).map(Number);
if (!years.length) for (let y = 2008; y <= 2026; y++) years.push(y);
mkdirSync(OUTDIR, { recursive: true });

const browser = await chromium.launch();
for (const year of years) {
  const html = readFileSync(path.join(ROOT, `public/years/${year}.html`), "utf8");
  for (const [tag, viewport] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: SCALE, reducedMotion: "no-preference" });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(500);
    // Pause every animation, then stretch each one to a whole number of
    // cycles in LOOP_S so the last frame runs straight into the first.
    await page.evaluate((loopMs) => {
      window.__anims = document.getAnimations().map((a) => {
        a.pause();
        const t = a.effect.getComputedTiming();
        const cycle = t.duration * (String(t.direction).includes("alternate") ? 2 : 1);
        const k = Math.max(1, Math.round(loopMs / cycle));
        return { a, base: a.currentTime, rate: (k * cycle) / loopMs };
      });
      window.__seek = (ms) => {
        for (const { a, base, rate } of window.__anims) a.currentTime = base + ms * rate;
      };
    }, LOOP_S * 1000);

    const file = path.join(OUTDIR, `${year}-${tag}.mp4`);
    const ff = spawn("ffmpeg", [
      "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", CRF, "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", file,
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((res, rej) => ff.on("close", (c) => (c ? rej(new Error(`ffmpeg ${c}`)) : res())));
    for (let f = 0; f < LOOP_S * FPS; f++) {
      await page.evaluate((ms) => window.__seek(ms), (f * 1000) / FPS);
      const shot = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ff.stdin.write(shot)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await done;
    await page.close();
    console.log(file);
  }
}
await browser.close();
