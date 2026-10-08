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

export function startMusic() {
  if (muted) return;
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === "suspended") void ctx.resume();
  if (!timer) timer = window.setInterval(loop, 220);
}

export function toggleMusic() {
  muted = !muted;
  if (muted && timer) {
    window.clearInterval(timer);
    timer = 0;
  } else {
    startMusic();
  }
  return muted;
}

export function playSfx(name: "flap" | "lose") {
  if (muted) return;
  const audio = new Audio(name === "flap" ? "/flap.mp3" : "/lose.mp3");
  audio.volume = name === "flap" ? 0.45 : 0.6;
  void audio.play().catch(() => {});
}
