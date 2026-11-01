// Makes the phone rendition of each ranked year clip from the desktop clip:
// 540 px on the long side, 24 fps, low bitrate, faststart, same 30 s loop.
// Phone ranked plays these (components/year/YearStage.tsx) so a phone never
// decodes a 1080p file next to the game loop. Desktop keeps the full clips.
//
// Usage: node scripts/make-phone-clips.mjs [year...]
// Needs ffmpeg with libx264 on PATH. Reads public/years/clips/<year>-{p,l}.mp4,
// writes public/years/clips/phone/<year>-{p,l}.mp4.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "public/years/clips");
const OUT = path.join(SRC, "phone");
const FPS = process.env.FPS || "24";
const CRF = process.env.CRF || "27";
// Even sizes for yuv420p; 540 x 9/16 = 303.75.
const SIZES = { p: "304:540", l: "540:304" };

const years = process.argv.slice(2).map(Number);
if (!years.length) for (let y = 2008; y <= 2026; y++) years.push(y);
mkdirSync(OUT, { recursive: true });

for (const year of years) {
  for (const [tag, size] of Object.entries(SIZES)) {
    const src = path.join(SRC, `${year}-${tag}.mp4`);
    const file = path.join(OUT, `${year}-${tag}.mp4`);
    const ff = spawnSync(
      "ffmpeg",
      [
        "-y", "-loglevel", "error", "-i", src,
        "-vf", `fps=${FPS},scale=${size}:flags=lanczos`,
        "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-crf", CRF,
        // Main profile, level 3.0: hardware decode on every phone.
        "-profile:v", "main", "-level", "3.0", "-maxrate", "450k", "-bufsize", "900k",
        "-g", String(Number(FPS) * 2), "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", file,
      ],
      { stdio: "inherit" }
    );
    if (ff.status) throw new Error(`ffmpeg ${ff.status} for ${src}`);
    console.log(file);
  }
}
