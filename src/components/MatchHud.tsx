import { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Eye,
  FastForward,
  Film,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { MatchHudState, SetPieceKind } from '../types/game';

interface MatchHudProps {
  hud: MatchHudState;
  muted: boolean;
  canSkipCutscenes: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  onSkipReplay: () => void;
  onSkipPreMatch: () => void;
  onVirtualAxis: (x: number, z: number) => void;
  onVirtualSprint: (active: boolean) => void;
  onVirtualAction: (
    action:
      | 'groundedPass'
      | 'throughPass'
      | 'loftOrTackle'
      | 'shoot'
      | 'standTackle'
      | 'slideTackle'
      | 'secondDefenderPress'
      | 'gkJumpOrDive'
      | 'gkJump',
  ) => void;
  onSwitchPlayer: () => void;
  onQuickGlance: (active: boolean) => void;
  onResetCamera: () => void;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatSetPieceLabel(kind: SetPieceKind): string {
  switch (kind) {
    case 'corner':
      return 'CORNER KICK';
    case 'throw_in':
      return 'THROW-IN';
    case 'goal_kick':
      return 'GOAL KICK';
    case 'free_kick':
      return 'FREE KICK';
  }
}

export function MatchHud({
  hud,
  muted,
  canSkipCutscenes,
  onToggleMute,
  onPause,
  onSkipReplay,
  onSkipPreMatch,
  onVirtualAxis,
  onVirtualSprint,
  onVirtualAction,
  onSwitchPlayer,
  onQuickGlance,
  onResetCamera,
}: MatchHudProps) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const activeStickPointerIdRef = useRef<number | null>(null);
  const sprintPointerIdRef = useRef<number | null>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [sprintPressed, setSprintPressed] = useState(false);

  const updateStickFromPointer = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.4;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setKnobPos({ x: dx, y: dy });
    onVirtualAxis(dx / maxR, dy / maxR);
  };

  const resetStick = (pointerId?: number) => {
    if (pointerId !== undefined && activeStickPointerIdRef.current !== pointerId) return;
    activeStickPointerIdRef.current = null;
    setKnobPos({ x: 0, y: 0 });
    onVirtualAxis(0, 0);
  };

  const endSprint = (pointerId?: number) => {
    if (pointerId !== undefined && sprintPointerIdRef.current !== pointerId) return;
    sprintPointerIdRef.current = null;
    setSprintPressed(false);
    onVirtualSprint(false);
  };

  const isGk = hud.activeRole === 'goalkeeper';
  const liveReplay = hud.liveGoalReplay?.active ? hud.liveGoalReplay : null;
  const preMatch = hud.preMatch?.active ? hud.preMatch : null;

  // Stamina SVG ring geometry for Sprint button
  const staminaClamped = Math.max(0, Math.min(100, hud.stamina));
  const ringRadius = 40;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - staminaClamped / 100);
  const staminaColor =
    staminaClamped > 55 ? '#34D399' : staminaClamped > 25 ? '#FACC15' : '#FB7185';

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex h-dvh w-screen flex-col justify-between overflow-hidden px-3 py-2.5 sm:px-5 sm:py-4">
      {/* Top-Left Broadcast Scoreboard (Fixed Compact Single-Line) & Top-Right Utility Controls */}
      <div className="flex shrink-0 items-start justify-between gap-2 sm:gap-3">
        <div className="relative flex flex-col items-start">
          <div className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-700/80 bg-[#060911]/90 px-2.5 shadow-xl sm:h-10 sm:gap-3 sm:px-3.5">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm sm:h-3 sm:w-3"
                style={{ backgroundColor: hud.homeColor }}
              />
              <span className="text-[11px] font-black tracking-wide text-white sm:text-xs">
                {hud.homeClubName}
              </span>
            </div>
            <div className="rounded-md bg-[#0e1526] px-2 py-0.5 font-mono text-sm font-black text-[#F5C542] tabular-nums sm:text-base">
              {hud.homeScore} – {hud.awayScore}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-black tracking-wide text-white sm:text-xs">
                {hud.awayClubName}
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm sm:h-3 sm:w-3"
                style={{ backgroundColor: hud.awayColor }}
              />
            </div>
            <div
              className={`ml-0.5 border-l border-slate-700 pl-2 font-mono text-xs font-bold tabular-nums sm:ml-1 sm:pl-3 sm:text-sm ${
                hud.shootout?.active &&
                hud.shootout.phase === 'aiming' &&
                hud.shootout.shotClockSeconds <= 1
                  ? 'text-rose-400'
                  : 'text-emerald-300'
              }`}
            >
              {hud.shootout?.active
                ? `${hud.shootout.shotClockSeconds}s`
                : formatClock(hud.timeRemainingSeconds)}
            </div>
            {hud.highlightsCount > 0 && !hud.shootout?.active && (
              <div className="hidden items-center gap-1 border-l border-slate-700 pl-3 text-[11px] font-bold text-[#F5C542] sm:flex">
                <Film className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                  {hud.highlightsCount} {hud.highlightsCount === 1 ? 'Replay' : 'Replays'}
                </span>
              </div>
            )}
          </div>

          {/* Floating Non-Expanding Set-Piece & LAN Notice Badges (Never shifts HUD/controls) */}
          {(hud.lanNotice || (hud.setPiece?.active && !liveReplay && !preMatch)) && (
            <div className="absolute top-full left-0 z-20 mt-1.5 flex flex-col items-start gap-1">
              {hud.lanNotice && (
                <div className="whitespace-nowrap rounded-md border border-[#F5C542]/75 bg-[#060911]/92 px-2.5 py-0.5 text-[10px] font-black tracking-[0.14em] text-[#F5C542] uppercase shadow-lg">
                  {hud.lanNotice}
                </div>
              )}

              {hud.setPiece?.active && !liveReplay && !preMatch && (
                <div className="whitespace-nowrap rounded-md border border-sky-400/70 bg-[#060911]/92 px-2.5 py-1 shadow-lg">
                  <div className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.14em] text-sky-300 uppercase">
                    <span>
                      {formatSetPieceLabel(hud.setPiece.kind)} · {hud.setPiece.clubShort}
                    </span>
                    {hud.setPiece.countdownSeconds !== null && (
                      <span className="font-mono text-[#F5C542] tabular-nums">
                        {hud.setPiece.countdownSeconds}s
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-semibold text-slate-300">
                    {hud.setPiece.isLocalTaker
                      ? 'Aim & Pass / Cross'
                      : `${hud.setPiece.takerName} preparing`}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Active Player, Camera Glance/Reset & Mute/Pause */}
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2.5 rounded-xl border border-slate-700/80 bg-slate-950/88 px-3 py-2 sm:flex">
            <span className="text-xs font-bold text-slate-200">{hud.activePlayerName}</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 uppercase">
              {isGk ? 'GK' : 'OUT'}
            </span>
            {!isGk && (
              <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full transition-[width] duration-75"
                  style={{
                    width: `${Math.round(staminaClamped)}%`,
                    backgroundColor: staminaColor,
                  }}
                />
              </div>
            )}
          </div>

          {!hud.shootout?.active && !liveReplay && !preMatch && (
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                onQuickGlance(true);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                onQuickGlance(false);
              }}
              onPointerLeave={() => onQuickGlance(false)}
              onPointerCancel={() => onQuickGlance(false)}
              className={`pointer-events-auto flex touch-none items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${
                hud.quickGlancing
                  ? 'border-sky-300 bg-sky-400 text-slate-950'
                  : 'border-slate-700/80 bg-slate-950/88 text-slate-200 hover:border-sky-400'
              }`}
              aria-label="Glance at ball"
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Glance</span>
            </button>
          )}

          {!hud.shootout?.active && !liveReplay && !preMatch && hud.cameraOrbited && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onResetCamera}
              className="pointer-events-auto flex items-center gap-1 rounded-xl border border-amber-400/70 bg-slate-950/88 px-2.5 py-2.5 text-xs font-bold text-amber-300 hover:bg-slate-900"
              aria-label="Reset camera"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Cam</span>
            </button>
          )}

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onToggleMute}
            className="pointer-events-auto rounded-xl border border-slate-700/80 bg-slate-950/88 p-2.5 text-slate-200 hover:border-amber-400"
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onPause}
            className="pointer-events-auto rounded-xl border border-slate-700/80 bg-slate-950/88 p-2.5 text-slate-200 hover:border-amber-400"
            aria-label="Pause match"
          >
            <Pause className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Center Overlays: Shootout Tracker & Goal Celebration Only */}
      <div className="my-auto flex flex-col items-center justify-center gap-3">
        {hud.shootout?.active && (
          <div className="rounded-2xl border border-slate-700/90 bg-slate-950/90 px-4 py-2.5 text-center shadow-xl">
            <div className="flex items-center justify-center gap-2 text-[10px] font-black tracking-[0.22em] text-amber-400 uppercase">
              <span>
                {hud.shootout.isSuddenDeath
                  ? `SUDDEN DEATH · RD ${hud.shootout.round}`
                  : `PENALTY SHOOTOUT · RD ${hud.shootout.round}/5`}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-300">
                {hud.shootout.phase === 'run_up'
                  ? hud.shootout.localRole === 'gk'
                    ? 'GET READY TO DIVE!'
                    : 'RUN-UP · STRIKING...'
                  : hud.shootout.localRole === 'kicker'
                    ? `AIM & SHOOT (${hud.shootout.shotClockSeconds}s)`
                    : hud.shootout.localRole === 'gk'
                      ? '360° STICK + DIVE'
                      : `${hud.shootout.kickerName} VS ${hud.shootout.gkName}`}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black text-white">{hud.homeClubName}</span>
                <div className="flex gap-1">
                  {Array.from({ length: Math.max(5, hud.shootout.homeKicks.length) }).map((_, i) => {
                    const res = hud.shootout?.homeKicks[i];
                    return (
                      <span
                        key={i}
                        className={`h-3 w-3 rounded-full border ${
                          res === 'goal'
                            ? 'border-emerald-300 bg-emerald-400'
                            : res === 'miss'
                              ? 'border-rose-400 bg-rose-500'
                              : 'border-slate-600 bg-slate-800'
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="ml-1 font-mono text-sm font-black text-amber-300 tabular-nums">
                  {hud.shootout.homeShootoutScore}
                </span>
              </div>

              <span className="text-xs font-bold text-slate-600">:</span>

              <div className="flex items-center gap-1.5">
                <span className="mr-1 font-mono text-sm font-black text-amber-300 tabular-nums">
                  {hud.shootout.awayShootoutScore}
                </span>
                <div className="flex gap-1">
                  {Array.from({ length: Math.max(5, hud.shootout.awayKicks.length) }).map((_, i) => {
                    const res = hud.shootout?.awayKicks[i];
                    return (
                      <span
                        key={i}
                        className={`h-3 w-3 rounded-full border ${
                          res === 'goal'
                            ? 'border-emerald-300 bg-emerald-400'
                            : res === 'miss'
                              ? 'border-rose-400 bg-rose-500'
                              : 'border-slate-600 bg-slate-800'
                        }`}
                      />
                    );
                  })}
                </div>
                <span className="text-[11px] font-black text-white">{hud.awayClubName}</span>
              </div>
            </div>
          </div>
        )}

        {hud.shootout?.active && hud.shootout.resultBanner && (
          <div className="rounded-2xl border-2 border-amber-400 bg-slate-950/94 px-8 py-3 text-center shadow-2xl">
            <div className="text-2xl font-black tracking-tight text-white">
              {hud.shootout.resultBanner}
            </div>
          </div>
        )}

        {hud.goalBanner && !liveReplay && (
          <div className="rounded-2xl border-2 border-amber-400 bg-slate-950/94 px-8 py-4 text-center shadow-2xl">
            <div className="text-xs font-extrabold tracking-[0.3em] text-amber-400 uppercase">
              Goal Scored
            </div>
            <div className="mt-1 text-3xl font-black tracking-tight text-white">
              {hud.goalBanner.scorer}
            </div>
            {hud.goalBanner.scorerName && (
              <div className="mt-1 text-xs font-bold text-slate-200">
                #{hud.goalBanner.scorerNumber ?? 10} {hud.goalBanner.scorerName}
                {hud.goalBanner.assistName ? ` · Assist: ${hud.goalBanner.assistName}` : ''}
                {hud.goalBanner.shotSpeedKmh ? ` · ${hud.goalBanner.shotSpeedKmh} km/h` : ''}
              </div>
            )}
            {hud.goalBanner.highlightSaved && (
              <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-0.5 text-[10px] font-extrabold tracking-widest text-amber-300 uppercase">
                <Film className="h-3 w-3" />
                Highlight Replay Captured
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls + Bottom-Center 2D Mini-Map Radar */}
      {preMatch ? (
        <div className="flex w-full items-end justify-end">
          {canSkipCutscenes && preMatch.canSkip && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onSkipPreMatch}
              aria-label="Skip pre-match intro"
              className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/25 bg-slate-950/92 px-3.5 py-2 text-xs font-bold tracking-wide text-white shadow-lg transition hover:border-amber-300 hover:bg-slate-900 active:scale-95"
            >
              <FastForward className="h-3.5 w-3.5 text-amber-300" />
              <span>Skip Intro</span>
            </button>
          )}
        </div>
      ) : !liveReplay ? (
        <div className="relative flex w-full items-end justify-between">
          {/* Left Movement Virtual Joystick */}
          <div
            ref={padRef}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (activeStickPointerIdRef.current !== null) return;
              activeStickPointerIdRef.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              updateStickFromPointer(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (activeStickPointerIdRef.current !== e.pointerId) return;
              e.stopPropagation();
              updateStickFromPointer(e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              e.stopPropagation();
              resetStick(e.pointerId);
            }}
            onPointerCancel={(e) => {
              e.stopPropagation();
              resetStick(e.pointerId);
            }}
            className="pointer-events-auto relative flex h-24 w-24 touch-none items-center justify-center rounded-full border-2 border-slate-500/60 bg-slate-950/50 min-[480px]:h-28 min-[480px]:w-28 sm:h-32 sm:w-32"
          >
            <div className="pointer-events-none h-9 w-9 rounded-full border border-slate-600/70 sm:h-10 sm:w-10" />
            <div
              className="pointer-events-none absolute h-10 w-10 rounded-full border-2 border-amber-300 bg-amber-400/80 shadow-lg sm:h-11 sm:w-11"
              style={{
                transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
              }}
            />
          </div>

          {/* Bottom-Center 2D Mini-Map Radar (Teammates = Blue, Opponents = Red, Ball = Glowing White) */}
          {hud.radar && !hud.shootout?.active && (
            <div
              className="pointer-events-none absolute bottom-1 left-1/2 hidden -translate-x-1/2 overflow-hidden rounded-lg border border-slate-500/70 bg-emerald-950/75 shadow-xl min-[460px]:block sm:h-[92px] sm:w-[152px] h-[72px] w-[118px]"
              aria-hidden="true"
            >
              {/* Pitch markings */}
              <div className="absolute inset-1 rounded-sm border border-white/30">
                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30" />
                <div className="absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/30" />
                <div className="absolute top-1/4 bottom-1/4 left-0 w-3 border-y border-r border-white/30" />
                <div className="absolute top-1/4 right-0 bottom-1/4 w-3 border-y border-l border-white/30" />
              </div>

              {/* Players */}
              {hud.radar.players.map((p) => {
                const isTeammate = p.team === hud.localTeam;
                const leftPct = ((1 - p.zNorm) / 2) * 88 + 6;
                const topPct = ((1 + p.xNorm) / 2) * 86 + 7;
                return (
                  <div
                    key={p.id}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                      p.isLocal
                        ? 'z-10 h-2.5 w-2.5 border-2 border-amber-300 bg-sky-400 shadow-[0_0_6px_rgba(250,204,21,0.9)]'
                        : isTeammate
                          ? 'h-2 w-2 border border-white/60 bg-sky-500'
                          : 'h-2 w-2 border border-white/50 bg-rose-500'
                    }`}
                    style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  />
                );
              })}

              {/* Glowing Ball Dot */}
              <div
                className="absolute z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900 bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.95)]"
                style={{
                  left: `${((1 - hud.radar.ballZNorm) / 2) * 88 + 6}%`,
                  top: `${((1 + hud.radar.ballXNorm) / 2) * 86 + 7}%`,
                }}
              />
            </div>
          )}

          {/* Right-Side Ergonomic Circular Action Arc (Responsive scale on short landscape viewports) */}
          <div className="pointer-events-none relative h-[246px] w-[220px] origin-bottom-right scale-[0.82] min-[480px]:scale-[0.9] sm:h-[260px] sm:w-[232px] sm:scale-100">
            {isGk ? (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onVirtualAction('gkJumpOrDive');
                  }}
                  className="pointer-events-auto absolute right-0 bottom-0 flex h-[86px] w-[86px] touch-none flex-col items-center justify-center rounded-full border-2 border-amber-300/90 bg-amber-400/60 text-xs font-black tracking-wide text-white shadow-lg transition active:scale-90 active:bg-amber-400/85 sm:h-[94px] sm:w-[94px]"
                >
                  <span>DIVE</span>
                  <span className="text-[9px] font-bold text-amber-100/95">360° STICK</span>
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onVirtualAction('gkJump');
                  }}
                  className="pointer-events-auto absolute right-[6px] bottom-[102px] flex h-[70px] w-[70px] touch-none items-center justify-center rounded-full border-2 border-sky-300/80 bg-slate-950/60 text-xs font-black tracking-wide text-sky-200 shadow-lg transition active:scale-90 active:bg-sky-400/70 active:text-slate-950 sm:bottom-[110px] sm:h-[76px] sm:w-[76px]"
                >
                  JUMP
                </button>
              </>
            ) : (
              <>
                {/* 1. Sprint Button with Circular Stamina Arc Ring */}
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    sprintPointerIdRef.current = e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setSprintPressed(true);
                    onVirtualSprint(true);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    endSprint(e.pointerId);
                  }}
                  onPointerCancel={(e) => {
                    e.stopPropagation();
                    endSprint(e.pointerId);
                  }}
                  className={`pointer-events-auto absolute right-0 bottom-0 flex h-[82px] w-[82px] touch-none items-center justify-center rounded-full border-2 text-xs font-black tracking-wider shadow-lg transition active:scale-95 sm:h-[88px] sm:w-[88px] ${
                    sprintPressed
                      ? 'border-emerald-300 bg-emerald-400/75 text-slate-950'
                      : 'border-slate-500/60 bg-slate-950/60 text-white'
                  }`}
                >
                  <svg
                    viewBox="0 0 92 92"
                    className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="46"
                      cy="46"
                      r={ringRadius}
                      fill="none"
                      stroke="rgba(255,255,255,0.14)"
                      strokeWidth="4.5"
                    />
                    <circle
                      cx="46"
                      cy="46"
                      r={ringRadius}
                      fill="none"
                      stroke={staminaColor}
                      strokeWidth="4.5"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringOffset}
                    />
                  </svg>
                  <span className="relative z-10">SPRINT</span>
                </button>

                {/* 2–5. Context-Sensitive Attacking / Defending Action Arc */}
                {(() => {
                  const attackingMode = hud.teamHasBall || Boolean(hud.setPiece?.active);
                  return (
                    <>
                      {/* 2. Shoot (Attack) / Stand Tackle Press (Defense) */}
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onVirtualAction(attackingMode ? 'shoot' : 'standTackle');
                        }}
                        className={`pointer-events-auto absolute right-[6px] bottom-[98px] flex h-[70px] w-[70px] touch-none items-center justify-center rounded-full border-2 text-xs font-black tracking-wider text-white shadow-lg transition active:scale-90 sm:bottom-[106px] sm:h-[76px] sm:w-[76px] ${
                          attackingMode
                            ? 'border-amber-300/90 bg-amber-400/55 active:bg-amber-400/85'
                            : 'border-rose-400/90 bg-rose-500/60 active:bg-rose-400/85'
                        }`}
                      >
                        {attackingMode ? 'SHOOT' : 'PRESS'}
                      </button>

                      {/* 3. Grounded Pass (Attack) / Slide Tackle (Defense) */}
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onVirtualAction(attackingMode ? 'groundedPass' : 'slideTackle');
                        }}
                        className={`pointer-events-auto absolute right-[98px] bottom-[4px] flex h-16 w-16 touch-none items-center justify-center rounded-full border-2 text-xs font-black tracking-wider shadow-lg transition active:scale-90 active:text-slate-950 sm:right-[106px] sm:h-[68px] sm:w-[68px] ${
                          attackingMode
                            ? 'border-indigo-300/80 bg-slate-950/55 text-indigo-200 active:bg-indigo-400/75'
                            : 'border-orange-300/85 bg-slate-950/60 text-orange-200 active:bg-orange-400/80'
                        }`}
                      >
                        {attackingMode ? 'PASS' : 'SLIDE'}
                      </button>

                      {/* 4. Lofted Pass (Attack Only) */}
                      {attackingMode && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onVirtualAction('loftOrTackle');
                          }}
                          className="pointer-events-auto absolute right-[134px] bottom-[78px] flex h-[62px] w-[62px] touch-none items-center justify-center rounded-full border-2 border-emerald-300/80 bg-slate-950/55 text-[11px] font-black tracking-wide text-emerald-200 shadow-lg transition active:scale-90 active:bg-emerald-400/75 active:text-slate-950 sm:right-[142px] sm:bottom-[84px] sm:h-16 sm:w-16"
                        >
                          LOFT
                        </button>
                      )}

                      {/* 5. Through Pass (Attack) / 2nd Defender Press (Defense) */}
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onVirtualAction(attackingMode ? 'throughPass' : 'secondDefenderPress');
                        }}
                        className={`pointer-events-auto absolute right-[88px] bottom-[138px] flex h-[62px] w-[62px] touch-none items-center justify-center rounded-full border-2 text-[10px] font-black tracking-wide shadow-lg transition active:scale-90 sm:right-[94px] sm:bottom-[148px] sm:h-16 sm:w-16 ${
                          attackingMode
                            ? 'border-sky-300/80 bg-slate-950/55 text-sky-200 active:bg-sky-400/75 active:text-slate-950'
                            : hud.secondDefenderActive
                              ? 'border-emerald-300 bg-emerald-400/80 text-slate-950'
                              : 'border-amber-300/80 bg-slate-950/60 text-amber-200 active:bg-amber-400/75 active:text-slate-950'
                        }`}
                      >
                        {attackingMode ? 'THRU' : '2ND DEF'}
                      </button>
                    </>
                  );
                })()}

                {/* 6. Dynamic Player Switch Button */}
                {!hud.shootout?.active && hud.canSwitchPlayer && (
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSwitchPlayer();
                    }}
                    aria-label="Switch active teammate"
                    className="pointer-events-auto absolute right-[10px] bottom-[182px] flex h-[54px] w-[54px] touch-none flex-col items-center justify-center gap-0.5 rounded-full border-2 border-cyan-300/80 bg-slate-950/60 text-[10px] font-black tracking-wide text-cyan-200 shadow-lg transition active:scale-90 active:bg-cyan-400/80 active:text-slate-950 sm:right-[14px] sm:bottom-[194px] sm:h-[58px] sm:w-[58px]"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    <span>SWITCH</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex w-full items-end justify-end">
          {canSkipCutscenes ? (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onSkipReplay}
              aria-label="Skip instant replay"
              className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/25 bg-slate-950/92 px-3 py-1.5 text-xs font-bold tracking-wide text-white/95 shadow-lg transition hover:border-amber-300/80 hover:bg-slate-900 active:scale-95"
            >
              <FastForward className="h-3.5 w-3.5 text-amber-300" />
              <span>Skip</span>
            </button>
          ) : (
            <div />
          )}
        </div>
      )}
    </div>
  );
}
