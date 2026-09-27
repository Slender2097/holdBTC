"use client";

interface GameOverModalProps {
  score: number;
  distance: number;
  isPersonalBest: boolean;
  wasRanked: boolean;
  scorePublished: boolean;
  notePublished: boolean;
  notePublishing: boolean;
  noteError?: string | null;
  onPlayAgain: () => void;
  onShareNote?: () => void;
  canShare: boolean;
}

export default function GameOverModal({
  score,
  distance,
  isPersonalBest,
  wasRanked,
  scorePublished,
  notePublished,
  notePublishing,
  noteError,
  onPlayAgain,
  onShareNote,
  canShare,
}: GameOverModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm alien-panel rounded-xl p-6 shadow-glow border border-alien-cyan/20">
        <div className="text-center mb-5">
          <p className="text-[10px] tracking-[0.3em] text-alien-muted uppercase mb-1">
            Signal Lost
          </p>
          <p className="text-5xl font-bold text-alien-cyan tabular-nums alien-text-glow">
            {score}
          </p>
          <p className="text-alien-muted text-xs mt-1 font-mono tracking-widest">
            PIPS
          </p>
          {isPersonalBest && (
            <p className="mt-3 text-[10px] font-mono tracking-widest text-alien-green border border-alien-green/30 inline-block px-2 py-0.5 rounded">
              NEW PERSONAL BEST
            </p>
          )}
          {wasRanked && canShare && (
            <p className="mt-2 text-[10px] font-mono text-alien-muted">
              {scorePublished
                ? "SCORE SENT TO LEADERBOARD"
                : "SENDING SCORE TO LEADERBOARD..."}
            </p>
          )}
          {!wasRanked && (
            <p className="mt-2 text-[10px] font-mono text-alien-muted">
              FREE RUN — NOT SUBMITTED TO GLOBAL RANK
            </p>
          )}
        </div>

        <div className="space-y-3">
          {wasRanked && canShare && (
            <button
              onClick={onShareNote}
              disabled={notePublishing || notePublished}
              className="w-full py-3 rounded-lg text-sm font-mono tracking-wide bg-alien-purple/20 hover:bg-alien-purple/30 border border-alien-purple/40 text-white disabled:opacity-50 transition"
            >
              {notePublishing
                ? "SHARING..."
                : notePublished
                ? "SHARED ON NOSTR"
                : "SHARE AS NOSTR POST"}
            </button>
          )}

          {noteError && (
            <p className="text-[11px] text-red-400 font-mono text-center leading-relaxed">
              {noteError}
            </p>
          )}

          <button
            onClick={onPlayAgain}
            className="w-full py-3 rounded-lg text-sm font-semibold tracking-wide bg-alien-cyan text-alien-void hover:bg-alien-cyan/90 transition"
          >
            PLAY AGAIN
          </button>
        </div>

        <p className="mt-4 text-center text-[10px] text-alien-muted font-mono">
          DISTANCE {Math.floor(distance)}
        </p>
      </div>
    </div>
  );
}