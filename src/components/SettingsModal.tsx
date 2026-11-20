import { ArrowLeft, Monitor, Music, Volume2, VolumeX, Waves } from 'lucide-react';
import type { GraphicsQuality } from '../types/game';

interface SettingsModalProps {
  graphicsQuality: GraphicsQuality;
  muted: boolean;
  musicEnabled: boolean;
  ambienceEnabled: boolean;
  onChangeQuality: (quality: GraphicsQuality) => void;
  onToggleMute: () => void;
  onToggleMusic: () => void;
  onToggleAmbience: () => void;
  onClose: () => void;
}

const QUALITY_OPTIONS: {
  id: GraphicsQuality;
  label: string;
  spec: string;
  desc: string;
}[] = [
  {
    id: 'low',
    label: 'Low',
    spec: '1x Res · Shadows Off · 120 Crowd',
    desc: 'Best battery & smoothest 60 FPS on compact mobile devices.',
  },
  {
    id: 'medium',
    label: 'Medium',
    spec: '1.5x Res · Soft Shadows · 300 Crowd',
    desc: 'Balanced stadium lighting, floodlight beams & crisp turf detail.',
  },
  {
    id: 'high',
    label: 'High',
    spec: 'Native 2x · HD Shadows · 560 Crowd',
    desc: 'Full stadium spectacle, dense animated stands & sharpest visuals.',
  },
];

export function SettingsModal({
  graphicsQuality,
  muted,
  musicEnabled,
  ambienceEnabled,
  onChangeQuality,
  onToggleMute,
  onToggleMusic,
  onToggleAmbience,
  onClose,
}: SettingsModalProps) {
  return (
    <div className="fixed inset-0 z-30 flex h-dvh w-screen flex-col bg-[#060911] text-slate-100">
      {/* Full-Screen Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800/90 px-4 py-3 sm:px-8 sm:py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0d1322] px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-[#F5C542] hover:text-[#F5C542]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.25em] text-[#F5C542] uppercase">
              Performance &amp; Audio
            </p>
            <h2 className="text-base font-black text-white sm:text-xl">Game Settings</h2>
          </div>
        </div>
      </div>

      {/* Scrollable Landscape Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-6">
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
          {/* Graphics Quality Section */}
          <div>
            <div className="mb-2.5 flex items-center gap-2 text-xs font-bold tracking-wider text-slate-300 uppercase">
              <Monitor className="h-3.5 w-3.5 text-sky-400" />
              Graphics Quality
            </div>
            <div className="space-y-2">
              {QUALITY_OPTIONS.map((opt) => {
                const active = graphicsQuality === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeQuality(opt.id)}
                    className={`flex w-full items-start justify-between rounded-xl border px-3.5 py-2.5 text-left transition ${
                      active
                        ? 'border-[#F5C542] bg-[#F5C542]/12'
                        : 'border-slate-800 bg-[#0a0f1c] hover:border-slate-600'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-extrabold ${
                            active ? 'text-[#F5C542]' : 'text-white'
                          }`}
                        >
                          {opt.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{opt.spec}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">{opt.desc}</p>
                    </div>
                    <span
                      className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                        active ? 'border-[#F5C542] bg-[#F5C542]' : 'border-slate-600 bg-transparent'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audio Toggles Section */}
          <div>
            <div className="mb-2.5 text-xs font-bold tracking-wider text-slate-300 uppercase">
              Audio Mix
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={onToggleMute}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-bold transition ${
                  !muted
                    ? 'border-emerald-400/70 bg-emerald-500/12 text-emerald-200'
                    : 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                }`}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                <span>{muted ? 'Muted' : 'Master On'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleMusic}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-bold transition ${
                  musicEnabled && !muted
                    ? 'border-sky-400/70 bg-sky-500/12 text-sky-200'
                    : 'border-slate-800 bg-[#0a0f1c] text-slate-400'
                }`}
              >
                <Music className="h-5 w-5" />
                <span>{musicEnabled ? 'Menu Music' : 'Music Off'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleAmbience}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-bold transition ${
                  ambienceEnabled && !muted
                    ? 'border-[#F5C542]/70 bg-[#F5C542]/12 text-[#F5C542]'
                    : 'border-slate-800 bg-[#0a0f1c] text-slate-400'
                }`}
              >
                <Waves className="h-5 w-5" />
                <span>{ambienceEnabled ? 'Crowd On' : 'Crowd Off'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Action Bar */}
      <div className="flex shrink-0 items-center justify-end border-t border-slate-800/90 bg-[#05070d] px-4 py-2.5 sm:px-8 sm:py-3.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-[#F5C542] px-6 py-2 text-xs font-black text-[#05070d] transition hover:bg-amber-300 sm:text-sm"
        >
          Apply &amp; Close
        </button>
      </div>
    </div>
  );
}
