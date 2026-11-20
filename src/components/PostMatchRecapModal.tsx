import { useState } from 'react';
import {
  BarChart3,
  Camera,
  Film,
  Play,
  RotateCcw,
  Shield,
  Target,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import type { KeyPlaySnapshot, KeyPlayType, MatchRecapData } from '../types/game';

interface PostMatchRecapModalProps {
  recap: MatchRecapData;
  onWatchReplay: (highlightId: string) => void;
  onReturnHome: () => void;
}

type RecapTab = 'replays' | 'snapshots' | 'stats';

function snapshotBadgeStyle(type: KeyPlayType): { label: string; badgeClass: string } {
  switch (type) {
    case 'goal':
      return {
        label: 'GOAL',
        badgeClass: 'border-amber-400/50 bg-amber-400/20 text-amber-300',
      };
    case 'save':
      return {
        label: 'GK SAVE',
        badgeClass: 'border-sky-400/50 bg-sky-400/20 text-sky-300',
      };
    case 'post':
      return {
        label: 'WOODWORK',
        badgeClass: 'border-rose-400/50 bg-rose-400/20 text-rose-300',
      };
    case 'shot':
      return {
        label: 'STRIKE',
        badgeClass: 'border-emerald-400/50 bg-emerald-400/20 text-emerald-300',
      };
  }
}

function SnapshotIcon({ type }: { type: KeyPlayType }) {
  switch (type) {
    case 'goal':
      return <Trophy className="h-3.5 w-3.5" />;
    case 'save':
      return <Shield className="h-3.5 w-3.5" />;
    case 'post':
      return <Zap className="h-3.5 w-3.5" />;
    case 'shot':
      return <Target className="h-3.5 w-3.5" />;
  }
}

function StatComparisonRow({
  label,
  homeValue,
  awayValue,
  homeColor,
  awayColor,
}: {
  label: string;
  homeValue: number;
  awayValue: number;
  homeColor: string;
  awayColor: string;
}) {
  const total = Math.max(1, homeValue + awayValue);
  const homePct = Math.round((homeValue / total) * 100);
  const awayPct = 100 - homePct;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-bold">
        <span className="font-mono text-white tabular-nums">{homeValue}</span>
        <span className="tracking-wider text-slate-400 uppercase">{label}</span>
        <span className="font-mono text-white tabular-nums">{awayValue}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${homePct}%`, backgroundColor: homeColor }}
        />
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${awayPct}%`, backgroundColor: awayColor }}
        />
      </div>
    </div>
  );
}

export function PostMatchRecapModal({
  recap,
  onWatchReplay,
  onReturnHome,
}: PostMatchRecapModalProps) {
  const [activeTab, setActiveTab] = useState<RecapTab>(
    recap.highlights.length > 0 ? 'replays' : 'snapshots',
  );
  const [previewSnapshot, setPreviewSnapshot] = useState<KeyPlaySnapshot | null>(null);

  const headline = recap.decidedByShootout
    ? (recap.homeShootoutScore ?? 0) > (recap.awayShootoutScore ?? 0)
      ? `${recap.homeClubName} WIN ON PENALTIES`
      : `${recap.awayClubName} WIN ON PENALTIES`
    : recap.homeScore > recap.awayScore
      ? `${recap.homeClubName} VICTORY`
      : recap.awayScore > recap.homeScore
        ? `${recap.awayClubName} VICTORY`
        : 'DRAW MATCH';

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/88 p-3 sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-amber-400/60 bg-slate-900 shadow-2xl">
        {/* Top Scoreboard Header */}
        <div className="border-b border-slate-800 bg-slate-950/75 px-5 py-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-extrabold tracking-[0.24em] text-amber-400 uppercase">
              <Trophy className="h-4 w-4" />
              Full Time · Match Recap
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-0.5 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              {recap.durationLabel}
            </div>
          </div>

          <div className="mt-3 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <div>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                {headline}
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {recap.highlights.length} goal{' '}
                {recap.highlights.length === 1 ? 'replay' : 'replays'} and{' '}
                {recap.snapshots.length} key-play{' '}
                {recap.snapshots.length === 1 ? 'snapshot' : 'snapshots'} saved
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ backgroundColor: recap.homeColor }}
                />
                <span className="text-sm font-black text-white">{recap.homeClubShort}</span>
              </div>
              <div className="text-center">
                <span className="font-mono text-2xl font-black text-amber-400 tabular-nums">
                  {recap.homeScore} – {recap.awayScore}
                </span>
                {recap.decidedByShootout && (
                  <div className="font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                    PEN ({recap.homeShootoutScore ?? 0} – {recap.awayShootoutScore ?? 0})
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-white">{recap.awayClubShort}</span>
                <span
                  className="h-3.5 w-3.5 rounded-sm"
                  style={{ backgroundColor: recap.awayColor }}
                />
              </div>
            </div>
          </div>

          {/* Section Tabs */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('replays')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                activeTab === 'replays'
                  ? 'bg-amber-400 text-slate-950'
                  : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              Goal Replays ({recap.highlights.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('snapshots')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                activeTab === 'snapshots'
                  ? 'bg-amber-400 text-slate-950'
                  : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              Key Play Snapshots ({recap.snapshots.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('stats')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-extrabold transition ${
                activeTab === 'stats'
                  ? 'bg-amber-400 text-slate-950'
                  : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Match Stats
            </button>
          </div>
        </div>

        {/* Scrollable Tab Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {activeTab === 'replays' && (
            <>
              {recap.highlights.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center">
                  <Film className="mx-auto mb-2.5 h-8 w-8 text-slate-500" />
                  <h3 className="text-sm font-extrabold text-white">Goalless Contest (0 – 0)</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    No goals were scored in this match. Open Key Play Snapshots or Match Stats to
                    review big saves and shots on goal.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {recap.highlights.map((hl) => (
                    <div
                      key={hl.id}
                      className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-950/90 transition hover:border-amber-400/70"
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                        {hl.snapshotDataUrl ? (
                          <img
                            src={hl.snapshotDataUrl}
                            alt={`Goal ${hl.goalNumber} by ${hl.scorerName}`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs font-bold text-slate-500">
                            3D REPLAY CLIP READY
                          </div>
                        )}
                        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-md bg-slate-950/90 px-2 py-1 text-[11px] font-extrabold text-white">
                          <span
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{ backgroundColor: hl.scoringColor }}
                          />
                          GOAL #{hl.goalNumber} · {hl.matchTimeLabel}
                        </div>
                        <div className="absolute top-2.5 right-2.5 rounded-md bg-amber-400 px-2 py-0.5 font-mono text-xs font-black text-slate-950 tabular-nums">
                          {hl.homeScoreAfter} – {hl.awayScoreAfter}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 p-3.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-white">
                            #{hl.scorerNumber} {hl.scorerName}
                          </div>
                          <div className="truncate text-xs text-slate-400">
                            {hl.scoringClubName}
                            {hl.assistName ? ` · Assist: ${hl.assistName}` : ''} ·{' '}
                            {hl.shotSpeedKmh} km/h
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onWatchReplay(hl.id)}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-amber-300"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          3D Replay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'snapshots' && (
            <>
              {recap.snapshots.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center">
                  <Camera className="mx-auto mb-2.5 h-8 w-8 text-slate-500" />
                  <h3 className="text-sm font-extrabold text-white">No Key Play Snapshots</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    Goals, goalkeeper saves, woodwork hits, and power strikes are automatically
                    photographed here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {recap.snapshots.map((snap) => {
                    const badge = snapshotBadgeStyle(snap.type);
                    return (
                      <div
                        key={snap.id}
                        className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/90"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewSnapshot(snap)}
                          className="relative aspect-video w-full overflow-hidden bg-slate-900 text-left"
                        >
                          {snap.snapshotDataUrl ? (
                            <img
                              src={snap.snapshotDataUrl}
                              alt={snap.title}
                              className="h-full w-full object-cover transition duration-200 hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-bold text-slate-500">
                              KEY MOMENT
                            </div>
                          )}
                          <div
                            className={`absolute top-2 left-2 flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-black tracking-wider uppercase ${badge.badgeClass}`}
                          >
                            <SnapshotIcon type={snap.type} />
                            {badge.label}
                          </div>
                          <div className="absolute right-2 bottom-2 rounded bg-slate-950/85 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-200 tabular-nums">
                            {snap.matchTimeLabel} · {snap.scoreLabel}
                          </div>
                        </button>

                        <div className="flex flex-1 flex-col justify-between gap-2 p-3">
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: snap.clubColor }}
                              />
                              <span className="truncate">{snap.title}</span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-slate-400">
                              {snap.subtitle}
                            </p>
                          </div>

                          {snap.highlightId && (
                            <button
                              type="button"
                              onClick={() => onWatchReplay(snap.highlightId!)}
                              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-400/15 py-1.5 text-[11px] font-extrabold text-amber-300 hover:bg-amber-400 hover:text-slate-950"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              Watch Goal Replay
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'stats' && (
            <div className="mx-auto max-w-xl space-y-5 rounded-xl border border-slate-800 bg-slate-950/80 p-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs font-black uppercase">
                <div className="flex items-center gap-2 text-white">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: recap.homeColor }}
                  />
                  {recap.homeClubName}
                </div>
                <div className="flex items-center gap-2 text-white">
                  {recap.awayClubName}
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: recap.awayColor }}
                  />
                </div>
              </div>

              <StatComparisonRow
                label="Goals"
                homeValue={recap.homeScore}
                awayValue={recap.awayScore}
                homeColor={recap.homeColor}
                awayColor={recap.awayColor}
              />
              <StatComparisonRow
                label="Shots"
                homeValue={recap.stats.homeShots}
                awayValue={recap.stats.awayShots}
                homeColor={recap.homeColor}
                awayColor={recap.awayColor}
              />
              <StatComparisonRow
                label="Goalkeeper Saves"
                homeValue={recap.stats.homeSaves}
                awayValue={recap.stats.awaySaves}
                homeColor={recap.homeColor}
                awayColor={recap.awayColor}
              />
              <StatComparisonRow
                label="Completed Passes"
                homeValue={recap.stats.homePasses}
                awayValue={recap.stats.awayPasses}
                homeColor={recap.homeColor}
                awayColor={recap.awayColor}
              />
              <StatComparisonRow
                label="Tackles Won"
                homeValue={recap.stats.homeTackles}
                awayValue={recap.stats.awayTackles}
                homeColor={recap.homeColor}
                awayColor={recap.awayColor}
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/80 px-5 py-3.5 sm:px-7">
          {recap.highlights.length > 0 ? (
            <button
              type="button"
              onClick={() => onWatchReplay(recap.highlights[0].id)}
              className="flex items-center gap-2 rounded-xl border border-amber-400/60 bg-amber-400/15 px-4 py-2.5 text-xs font-black text-amber-300 hover:bg-amber-400 hover:text-slate-950"
            >
              <Play className="h-4 w-4 fill-current" />
              Play Highlight Reel
            </button>
          ) : (
            <div className="text-xs font-semibold text-slate-400">
              Ready for your next kickoff
            </div>
          )}

          <button
            type="button"
            onClick={onReturnHome}
            className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-300"
          >
            <RotateCcw className="h-4 w-4" />
            Return to Home Screen
          </button>
        </div>
      </div>

      {/* Snapshot Lightbox Modal */}
      {previewSnapshot && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-4">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="text-sm font-black text-white">{previewSnapshot.title}</div>
                <div className="text-xs text-slate-400">
                  {previewSnapshot.matchTimeLabel} · {previewSnapshot.subtitle}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewSnapshot(null)}
                className="rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-300 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="aspect-video w-full bg-slate-950">
              {previewSnapshot.snapshotDataUrl && (
                <img
                  src={previewSnapshot.snapshotDataUrl}
                  alt={previewSnapshot.title}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
            {previewSnapshot.highlightId && (
              <div className="flex justify-end border-t border-slate-800 bg-slate-950 px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    const hlId = previewSnapshot.highlightId!;
                    setPreviewSnapshot(null);
                    onWatchReplay(hlId);
                  }}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-300"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Launch 3D Goal Replay
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
