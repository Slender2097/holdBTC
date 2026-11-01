"use client";

let ctx: AudioContext | null = null;
let timer = 0;
let step = 0;
let muted = false;

const NOTES = [196, 247, 294, 330, 294, 247, 220, 247];

function loop() {
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = NOTES[step % NOTES.length];
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
  step += 1;
}

export function musicMuted() {
  return muted;
}

let rankedAudio: HTMLAudioElement | null = null;
// Which music the mute button turns back on. ranked.mp3 can be loaded (pay
// modal) without a ranked run having started.
let lastMode: "free" | "ranked" | null = null;

function rankedElement() {
  if (!rankedAudio) {
    rankedAudio = new Audio();
    rankedAudio.preload = "auto";
    rankedAudio.loop = true;
    rankedAudio.volume = 0.45;
    rankedAudio.src = "/ranked.mp3";
    rankedAudio.load();
  }
  return rankedAudio;
}

/**
 * Start loading ranked.mp3 before the run (pay click, pay modal, payment
 * confirmed), so the start tap neither creates the element nor downloads it.
 * Also loads the flap and lose sounds.
 */
export function warmRankedMusic() {
  rankedElement();
  warmSfx();
}

export function startRankedMusic() {
  if (muted) return;
  lastMode = "ranked";
  const audio = rankedElement();
  if (audio.paused) void audio.play().catch(() => {});
}

export function stopMusic() {
  if (timer) {
    window.clearInterval(timer);
    timer = 0;
  }
  if (rankedAudio) {
    rankedAudio.pause();
    rankedAudio.currentTime = 0;
  }
}

function makeContext() {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioCtx && !ctx) ctx = new AudioCtx();
  return ctx;
}

/**
 * Create the free-play AudioContext ahead of the first flap (about 25 ms on a
 * phone), so the tap that starts the run does not pay for it. It starts
 * suspended; startMusic resumes it inside the tap.
 */
export function warmMusic() {
  if (!muted) makeContext();
  warmSfx();
}

export function startMusic() {
  if (muted) return;
  lastMode = "free";
  const ac = makeContext();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();
  if (!timer) timer = window.setInterval(loop, 220);
}

export function toggleMusic() {
  muted = !muted;
  if (muted) {
    stopMusic();
  } else if (lastMode === "ranked") {
    startRankedMusic();
  } else {
    startMusic();
  }
  return muted;
}

// A few loaded elements per sound, reused round robin, instead of a new
// Audio (and a request) on every flap.
const SFX_POOL = 3;
const sfx: Record<"flap" | "lose", { els: HTMLAudioElement[]; next: number }> = {
  flap: { els: [], next: 0 },
  lose: { els: [], next: 0 },
};

function sfxPool(name: "flap" | "lose") {
  const pool = sfx[name];
  if (!pool.els.length) {
    for (let i = 0; i < SFX_POOL; i++) {
      const el = new Audio();
      el.preload = "auto";
      el.volume = name === "flap" ? 0.45 : 0.6;
      el.src = name === "flap" ? "/flap.mp3" : "/lose.mp3";
      el.load();
      pool.els.push(el);
    }
  }
  return pool;
}

/** Load the flap and lose sounds ahead of the run. */
export function warmSfx() {
  sfxPool("flap");
  sfxPool("lose");
}

export function playSfx(name: "flap" | "lose") {
  if (muted) return;
  const pool = sfxPool(name);
  const el = pool.els[pool.next];
  pool.next = (pool.next + 1) % pool.els.length;
  if (!el.paused) el.pause();
  el.currentTime = 0;
  void el.play().catch(() => {});
}
