// Renders the free-play still of each public/years/<year>.html to an image.
// Phone shows these in free play and ranked: one decoded image per year costs
// the game loop nothing. Desktop paints them under the year clips
// (scripts/record-year-clips.mjs). The HTML scenes are never mounted in the app.
//
// Usage: npx -y -p playwright@1.56.1 node scripts/record-year-stills.mjs [year...]
// Writes public/years/stills/<year>-{p,l}.webp (needs ffmpeg with libwebp on PATH).
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "public/years/stills");
// Same framing as the clips (scripts/record-year-clips.mjs).
const SIZES = { p: { width: 540, height: 960 }, l: { width: 960, height: 540 } };
const SCALE = Number(process.env.SCALE || 1.5); // 810x1440 / 1440x810
const QUALITY = process.env.QUALITY || "80";

// No scripts, no crayon filter, no animation.
function still(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/class="([^"]*)\bcrayon\b([^"]*)"/g, 'class="$1$2"')
    .replace(/filter:\s*url\(#crayon-filter\)/g, "filter:none")
    .replace(/<filter id="crayon-filter">[\s\S]*?<\/filter>/g, "")
    .replace(
      "</head>",
      "<style>*{animation:none!important;transition:none!important}.crayon,svg.crayon{filter:none!important}</style></head>"
    );
}

const years = process.argv.slice(2).map(Number);
if (!years.length) for (let y = 2008; y <= 2026; y++) years.push(y);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const year of years) {
  const html = still(readFileSync(path.join(ROOT, `public/years/${year}.html`), "utf8"));
  for (const [tag, viewport] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: SCALE });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const png = await page.screenshot({ type: "png" });
    await page.close();
    const file = path.join(OUT, `${year}-${tag}.webp`);
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "png_pipe", "-i", "-", "-c:v", "libwebp", "-quality", QUALITY, file],
      { input: png, stdio: ["pipe", "inherit", "inherit"] }
    );
    if (ff.status) throw new Error(`ffmpeg ${ff.status}`);
    console.log(file);
  }
}
await browser.close();
