import {
  ArrowLeft,
  ChevronRight,
  Cpu,
  LogOut,
  Play,
  RotateCw,
  Settings,
  SlidersHorizontal,
  Wifi,
} from 'lucide-react';
import { getClubById } from '../data/clubs';
import type { PlayerProfile } from '../types/game';

interface HomeMenuProps {
  profile: PlayerProfile;
  showPlayModePicker: boolean;
  onTogglePlayModePicker: (open: boolean) => void;
  onOpenAloneSetup: () => void;
  onOpenLanMatch: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onToggleBackView: () => void;
  onQuit: () => void;
}

export function HomeMenu({
  profile,
  showPlayModePicker,
  onTogglePlayModePicker,
  onOpenAloneSetup,
  onOpenLanMatch,
  onOpenProfile,
  onOpenSettings,
  onToggleBackView,
  onQuit,
}: HomeMenuProps) {
  const club = getClubById(profile.clubId);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-10 flex h-dvh w-screen flex-col justify-between overflow-hidden px-4 py-2.5 sm:px-8 sm:py-5">
        {/* Top Row: Left Club & Player Badge + Quick Kit Flip */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-[#D4AF37]/40 bg-[#080c16]/85 px-3 py-1.5 text-xs text-slate-100 shadow-lg">
            <span
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-white/25"
              style={{ backgroundColor: club.primaryColor }}
            />
            <span className="truncate font-bold tracking-wide">{club.shortName}</span>
            <span className="text-slate-600">·</span>
            <span className="font-mono font-bold whitespace-nowrap text-[#F5C542]">
              #{profile.jerseyNumber} {profile.jerseyText}
            </span>
            <button
              type="button"
              onClick={onToggleBackView}
              className="ml-1 flex items-center gap-1 rounded border border-slate-700/80 bg-[#0d1424] px-2 py-0.5 text-[10px] font-bold text-slate-300 transition hover:border-[#F5C542] hover:text-[#F5C542]"
              aria-label="Inspect jersey back"
            >
              <RotateCw className="h-3 w-3" />
              <span className="hidden sm:inline">Flip</span>
            </button>
          </div>
        </div>

        {/* Center-Right: Custom Title PNG + Frameless Golden-Bordered Action Stack */}
        <div className="my-auto flex min-h-0 w-full items-center justify-end py-0.5">
          <div className="pointer-events-auto flex w-[236px] max-w-[52vw] flex-col gap-1.5 sm:w-[296px] sm:gap-2.5">
            <img
              src="/assets/aistudio/pro_titanic_soccer_logo_91a3a484.png"
              alt="Pro Titanic Soccer"
              className="mx-auto mb-0.5 h-14 w-auto max-w-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.95)] sm:mb-1.5 sm:h-20"
            />

            {/* 1. PLAY */}
            <button
              type="button"
              onClick={() => onTogglePlayModePicker(true)}
              className="group flex w-full shrink-0 items-center justify-between rounded-xl border-2 border-[#F5C542] bg-[#0b111f]/88 px-4 py-2 text-left shadow-[0_0_22px_rgba(212,175,55,0.22)] transition hover:bg-[#F5C542] hover:text-[#05070d] active:scale-[0.98] sm:px-5 sm:py-3"
            >
              <span className="flex items-center gap-2.5 text-sm font-black tracking-wider text-[#F5C542] uppercase group-hover:text-[#05070d] sm:text-base">
                <Play className="h-4 w-4 fill-current sm:h-5 sm:w-5" />
                PLAY
              </span>
              <ChevronRight className="h-4 w-4 text-[#F5C542] transition-transform group-hover:translate-x-0.5 group-hover:text-[#05070d]" />
            </button>

            {/* 2. Customize */}
            <button
              type="button"
              onClick={onOpenProfile}
              className="group flex w-full shrink-0 items-center justify-between rounded-xl border border-[#D4AF37]/80 bg-[#080c16]/85 px-4 py-1.5 text-left text-slate-100 transition hover:border-[#F5C542] hover:bg-[#11182b] active:scale-[0.98] sm:px-5 sm:py-2.5"
            >
              <span className="flex items-center gap-2.5 text-xs font-extrabold tracking-wide uppercase sm:text-sm">
                <SlidersHorizontal className="h-4 w-4 text-[#F5C542]" />
                Customize
              </span>
              <span className="max-w-[90px] truncate text-[10px] font-semibold text-slate-400 group-hover:text-[#F5C542]">
                {profile.playerName}
              </span>
            </button>

            {/* 3. Settings */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="group flex w-full shrink-0 items-center justify-between rounded-xl border border-[#D4AF37]/80 bg-[#080c16]/85 px-4 py-1.5 text-left text-slate-100 transition hover:border-[#F5C542] hover:bg-[#11182b] active:scale-[0.98] sm:px-5 sm:py-2.5"
            >
              <span className="flex items-center gap-2.5 text-xs font-extrabold tracking-wide uppercase sm:text-sm">
                <Settings className="h-4 w-4 text-[#F5C542]" />
                Settings
              </span>
              <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#F5C542]" />
            </button>

            {/* 4. Quit */}
            <button
              type="button"
              onClick={onQuit}
              className="group flex w-full shrink-0 items-center justify-between rounded-xl border border-[#D4AF37]/65 bg-[#080c16]/80 px-4 py-1.5 text-left text-slate-300 transition hover:border-rose-400/80 hover:bg-rose-950/35 hover:text-rose-200 active:scale-[0.98] sm:px-5 sm:py-2.5"
            >
              <span className="flex items-center gap-2.5 text-xs font-extrabold tracking-wide uppercase sm:text-sm">
                <LogOut className="h-4 w-4 text-[#D4AF37] group-hover:text-rose-300" />
                Quit
              </span>
            </button>
          </div>
        </div>

        {/* Bottom Subtle 360° Avatar Rotation Hint */}
        <div className="flex shrink-0 items-center justify-between text-[11px] font-medium text-slate-300 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
          <span className="flex items-center gap-1.5">
            <RotateCw className="h-3 w-3 text-[#D4AF37]" />
            Drag player left/right to rotate 360°
          </span>
          <span className="hidden text-[10px] tracking-widest text-slate-400 uppercase sm:inline">
            {club.name}
          </span>
        </div>
      </div>

      {/* Full-Screen Play Mode Selection View */}
      {showPlayModePicker && (
        <div className="fixed inset-0 z-20 flex h-dvh w-screen flex-col bg-[#060911] text-slate-100">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-800/90 px-4 py-2.5 sm:px-8 sm:py-3.5">
            <button
              type="button"
              onClick={() => onTogglePlayModePicker(false)}
              className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-[#0d1322] px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-[#F5C542] hover:text-[#F5C542]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-black tracking-wide text-slate-200 uppercase sm:text-lg">
                Select Match Mode
              </h2>
              <img
                src="/assets/aistudio/pro_titanic_soccer_logo_91a3a484.png"
                alt="Pro Titanic Soccer"
                className="h-9 w-auto object-contain sm:h-11"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6">
            <div className="mx-auto grid h-full max-w-4xl grid-cols-1 items-center gap-3 min-[480px]:grid-cols-2 sm:gap-6">
              {/* Mode 1: Alone vs AI */}
              <button
                type="button"
                onClick={onOpenAloneSetup}
                className="group flex h-full max-h-[290px] flex-col justify-between rounded-2xl border border-[#D4AF37]/50 bg-[#0a0f1d] p-4 text-left transition hover:border-[#F5C542] hover:bg-[#10182b] sm:p-6"
              >
                <div>
                  <div className="mb-3 inline-flex rounded-xl border border-sky-400/35 bg-sky-500/15 p-3 text-sky-300">
                    <Cpu className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-black text-white sm:text-2xl">Alone vs AI</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:text-sm">
                    Single-player tactical match across 30 European clubs. Customize duration,
                    format (2v2–6v6), pitch size, difficulty, and Outfield or GK role.
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs font-extrabold tracking-wider text-sky-300 uppercase">
                  <span>Configure Kick-Off</span>
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>

              {/* Mode 2: LAN Team Match */}
              <button
                type="button"
                onClick={onOpenLanMatch}
                className="group flex h-full max-h-[290px] flex-col justify-between rounded-2xl border border-[#D4AF37]/70 bg-[#0a0f1d] p-4 text-left transition hover:border-[#F5C542] hover:bg-[#10182b] sm:p-6"
              >
                <div>
                  <div className="mb-3 inline-flex rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 p-3 text-[#F5C542]">
                    <Wifi className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-black text-white sm:text-2xl">LAN Team Match</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400 sm:text-sm">
                    100% offline Wi-Fi Hotspot P2P multiplayer. Host or join friends, assign AI
                    co-control, claim Outfield or GK slots, and flip coin toss.
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs font-extrabold tracking-wider text-[#F5C542] uppercase">
                  <span>Open Hotspot Lobby</span>
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
