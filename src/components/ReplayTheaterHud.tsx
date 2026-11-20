import { ArrowLeft, Camera, ChevronLeft, ChevronRight, Film, Pause, Play } from 'lucide-react';
import type { GoalHighlight, ReplayCameraAngle, ReplayPlaybackState } from '../types/game';

interface ReplayTheaterHudProps {
  replay: ReplayPlaybackState;
  highlights: GoalHighlight[];
  onTogglePlay: () => void;
  onChangeSpeed: (speed: 0.5 | 1 | 1.5) => void;
  onChangeAngle: (angle: ReplayCameraAngle) => void;
  onSeek: (timeSeconds: number) => void;
  onSelectClip: (highlightId: string) => void;
  onExitReplay: () => void;
}

const ANGLES: { id: ReplayCameraAngle; label: string }[] = [
  { id: 'broadcast', label: 'TV Broadcast' },
  { id: 'goalcam', label: 'Goal Cam' },
  { id: 'scorercam', label: 'Scorer Cam' },
];

export function ReplayTheaterHud({
  replay,
  highlights,
  onTogglePlay,
  onChangeSpeed,
  onChangeAngle,
  onSeek,
  onSelectClip,
  onExitReplay,
}: ReplayTheaterHudProps) {
  const currentIdx = highlights.findIndex((h) => h.id === replay.activeHighlightId);
  const prevClip = currentIdx > 0 ? highlights[currentIdx - 1] : null;
  const nextClip =
    currentIdx >= 0 && currentIdx < highlights.length - 1 ? highlights[currentIdx + 1] : null;

  const goalMarkerPct = Math.min(
    100,
    Math.max(0, (replay.goalTimestamp / Math.max(0.1, replay.duration)) * 100),
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-5">
      {/* Top Broadcast Bug & Exit */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-amber-400/50 bg-slate-950/92 px-4 py-2.5 shadow-xl">
          <Film className="h-4 w-4 text-amber-400" />
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black tracking-widest text-amber-300 uppercase">
              <span>Action Replay</span>
              <span>·</span>
              <span>Goal #{replay.goalNumber}</span>
              <span>·</span>
              <span className="font-mono tabular-nums">{replay.matchTimeLabel}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs font-extrabold text-white">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: replay.scoringColor }}
              />
              <span>{replay.scoringClubShort}</span>
              <span className="text-slate-400">·</span>
              <span>{replay.scorerName}</span>
              <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-300 tabular-nums">
                {replay.scoreLabel}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onExitReplay}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/92 px-3.5 py-2.5 text-xs font-extrabold text-slate-200 hover:border-amber-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Recap
        </button>
      </div>

      {/* Subtle Goal Moment Flash (non-blocking) */}
      <div className="my-auto flex justify-center">
        {replay.goalBannerVisible && (
          <div className="rounded-xl border border-amber-400/70 bg-slate-950/88 px-6 py-2 text-center shadow-2xl">
            <div className="text-[10px] font-black tracking-[0.28em] text-amber-400 uppercase">
              Goal Moment
            </div>
            <div className="text-xl font-black text-white">{replay.scorerName}</div>
          </div>
        )}
      </div>

      {/* Unified Bottom Replay Theater Dock (Zero Viewport Occlusion) */}
      <div className="mx-auto w-full max-w-3xl">
        <div className="pointer-events-auto rounded-2xl border border-slate-700/90 bg-slate-950/92 px-4 py-3 shadow-2xl">
          {/* Timeline Scrubber with Goal Moment Tick */}
          <div className="relative flex items-center gap-3">
            <span className="w-10 font-mono text-[11px] font-bold text-slate-300 tabular-nums">
              {replay.currentTime.toFixed(1)}s
            </span>
            <div className="relative flex-1">
              <div
                className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-amber-400"
                style={{ left: `${goalMarkerPct}%` }}
                title="Goal crossing moment"
              />
              <input
                type="range"
                min={0}
                max={replay.duration}
                step={0.02}
                value={replay.currentTime}
                onChange={(e) => onSeek(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-amber-400"
              />
            </div>
            <span className="w-10 text-right font-mono text-[11px] font-bold text-slate-400 tabular-nums">
              {replay.duration.toFixed(1)}s
            </span>
          </div>

          {/* Transport, Speed & Camera Angle Controls */}
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!prevClip}
                onClick={() => prevClip && onSelectClip(prevClip.id)}
                className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-200 hover:border-amber-400 disabled:opacity-35"
                title="Previous Goal Replay"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-amber-300"
              >
                {replay.playing ? (
                  <>
                    <Pause className="h-3.5 w-3.5 fill-current" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Play
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!nextClip}
                onClick={() => nextClip && onSelectClip(nextClip.id)}
                className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-200 hover:border-amber-400 disabled:opacity-35"
                title="Next Goal Replay"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Playback Speed */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
              {([0.5, 1, 1.5] as const).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => onChangeSpeed(spd)}
                  className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-extrabold transition ${
                    replay.speed === spd
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {spd}×
                </button>
              ))}
            </div>

            {/* Camera Angle Selector */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
              <Camera className="mx-1.5 h-3.5 w-3.5 text-sky-300" />
              {ANGLES.map((ang) => (
                <button
                  key={ang.id}
                  type="button"
                  onClick={() => onChangeAngle(ang.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${
                    replay.cameraAngle === ang.id
                      ? 'bg-sky-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {ang.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
