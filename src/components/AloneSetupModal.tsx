import { useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import { CLUBS, getClubById } from '../data/clubs';
import {
  FIELD_DIMENSIONS,
  type AiDifficulty,
  type AloneMatchConfig,
  type FieldSize,
  type MatchFormat,
  type MatchMinutes,
  type MatchSize,
  type PlayerRole,
} from '../types/game';

interface AloneSetupModalProps {
  defaultClubId: string;
  onStart: (config: AloneMatchConfig) => void;
  onClose: () => void;
}

const MATCH_TIMES: MatchMinutes[] = [4, 6, 8, 10];
const MATCH_SIZES: MatchSize[] = ['2v2', '3v3', '4v4', '5v5', '6v6'];
const FIELD_SIZES: FieldSize[] = ['compact', 'standard', 'titanic'];
const AI_DIFFICULTIES: Array<{ id: AiDifficulty; label: string; desc: string }> = [
  { id: 'rookie', label: 'Rookie', desc: 'Relaxed press & spacing' },
  { id: 'pro', label: 'Pro', desc: 'Smart passing & marking' },
  { id: 'titanic', label: 'Titanic', desc: 'Clinical tactical AI' },
];

export function AloneSetupModal({ defaultClubId, onStart, onClose }: AloneSetupModalProps) {
  const [userClubId, setUserClubId] = useState(defaultClubId);
  const [aiClubId, setAiClubId] = useState(
    defaultClubId === 'realmadrid' ? 'barcelona' : 'realmadrid',
  );
  const [matchMinutes, setMatchMinutes] = useState<MatchMinutes>(4);
  const [matchSize, setMatchSize] = useState<MatchSize>('5v5');
  const [fieldSize, setFieldSize] = useState<FieldSize>('standard');
  const [userRole, setUserRole] = useState<PlayerRole>('outfield');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('standard');
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('pro');

  const userClub = getClubById(userClubId);
  const aiClub = getClubById(aiClubId);

  return (
    <div className="fixed inset-0 z-30 flex h-dvh w-screen flex-col bg-[#060911] text-slate-100">
      {/* Fixed Header */}
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
            <h2 className="text-base font-black text-white sm:text-xl">Alone vs AI — Match Setup</h2>
            <p className="hidden text-xs text-slate-400 sm:block">
              Select from {CLUBS.length} clubs, match rules, squad format, difficulty &amp; role.
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto max-w-5xl space-y-4">
          {/* Teams Row */}
          <div className="grid gap-3 min-[500px]:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-[#0a0f1c] p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-bold tracking-wider text-sky-400 uppercase">
                  Your Team
                </label>
                <div className="flex h-3.5 w-6 overflow-hidden rounded border border-white/20">
                  <span className="w-1/2" style={{ backgroundColor: userClub.primaryColor }} />
                  <span className="w-1/2" style={{ backgroundColor: userClub.secondaryColor }} />
                </div>
              </div>
              <select
                value={userClubId}
                onChange={(e) => setUserClubId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060911] px-3 py-2 text-xs font-semibold text-white sm:text-sm"
              >
                {CLUBS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.shortName})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0a0f1c] p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                  AI Opponent Team
                </label>
                <div className="flex h-3.5 w-6 overflow-hidden rounded border border-white/20">
                  <span className="w-1/2" style={{ backgroundColor: aiClub.primaryColor }} />
                  <span className="w-1/2" style={{ backgroundColor: aiClub.secondaryColor }} />
                </div>
              </div>
              <select
                value={aiClubId}
                onChange={(e) => setAiClubId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060911] px-3 py-2 text-xs font-semibold text-white sm:text-sm"
              >
                {CLUBS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.shortName})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Match Format + Role */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Match Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMatchFormat('standard')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    matchFormat === 'standard'
                      ? 'border-[#F5C542] bg-[#F5C542]/15 text-white'
                      : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold sm:text-sm">Standard Match</div>
                  <div className="text-[10px] text-slate-400 sm:text-[11px]">
                    Timed match with extra time
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMatchFormat('penalty_shootout')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    matchFormat === 'penalty_shootout'
                      ? 'border-emerald-400 bg-emerald-400/15 text-white'
                      : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold sm:text-sm">Penalty Shootout</div>
                  <div className="text-[10px] text-slate-400 sm:text-[11px]">
                    Best-of-5 spot kicks
                  </div>
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Your Match Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUserRole('outfield')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    userRole === 'outfield'
                      ? 'border-[#F5C542] bg-[#F5C542]/15 text-white'
                      : 'border-slate-800 bg-[#0a0f1c] text-slate-400'
                  }`}
                >
                  <div className="text-xs font-bold sm:text-sm">Outfield Player</div>
                  <div className="text-[10px] text-slate-400 sm:text-[11px]">
                    Dribble, pass, tackle &amp; shoot
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setUserRole('goalkeeper')}
                  className={`rounded-xl border p-2.5 text-left transition ${
                    userRole === 'goalkeeper'
                      ? 'border-[#F5C542] bg-[#F5C542]/15 text-white'
                      : 'border-slate-800 bg-[#0a0f1c] text-slate-400'
                  }`}
                >
                  <div className="text-xs font-bold sm:text-sm">Goalkeeper</div>
                  <div className="text-[10px] text-slate-400 sm:text-[11px]">
                    Locked GK goalmouth saves
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Clock + Quantity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Match Time (Minutes)
              </label>
              <div className="grid grid-cols-4 gap-2">
                {MATCH_TIMES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={matchFormat === 'penalty_shootout'}
                    onClick={() => setMatchMinutes(m)}
                    className={`rounded-xl border py-2 text-xs font-bold transition disabled:opacity-40 sm:text-sm ${
                      matchMinutes === m
                        ? 'border-[#F5C542] bg-[#F5C542]/15 text-[#F5C542]'
                        : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Player Quantity
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {MATCH_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setMatchSize(s)}
                    className={`rounded-xl border py-2 text-xs font-bold transition sm:text-sm ${
                      matchSize === s
                        ? 'border-sky-400 bg-sky-400/15 text-sky-300'
                        : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Field Size + AI Difficulty */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Field Size
              </label>
              <div className="grid grid-cols-3 gap-2">
                {FIELD_SIZES.map((fs) => {
                  const info = FIELD_DIMENSIONS[fs];
                  return (
                    <button
                      key={fs}
                      type="button"
                      onClick={() => setFieldSize(fs)}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        fieldSize === fs
                          ? 'border-emerald-400 bg-emerald-400/15 text-white'
                          : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-bold sm:text-sm">{info.label}</div>
                      <div className="mt-0.5 text-[10px] opacity-80">{info.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                AI Tactical Difficulty
              </label>
              <div className="grid grid-cols-3 gap-2">
                {AI_DIFFICULTIES.map((diff) => (
                  <button
                    key={diff.id}
                    type="button"
                    onClick={() => setAiDifficulty(diff.id)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      aiDifficulty === diff.id
                        ? 'border-rose-400 bg-rose-400/15 text-white'
                        : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-xs font-bold sm:text-sm">{diff.label}</div>
                    <div className="mt-0.5 text-[10px] opacity-80">{diff.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Bottom Action Bar */}
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-800/90 bg-[#05070d] px-4 py-2.5 sm:px-8 sm:py-3.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800 sm:text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            onStart({
              userClubId,
              aiClubId,
              matchMinutes,
              matchSize,
              fieldSize,
              userRole,
              matchFormat,
              aiDifficulty,
            })
          }
          className="flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-2 text-xs font-black text-[#05070d] hover:bg-emerald-300 sm:text-sm"
        >
          <Play className="h-4 w-4 fill-[#05070d]" />
          {matchFormat === 'penalty_shootout' ? 'Start Shootout' : 'Start Match'}
        </button>
      </div>
    </div>
  );
}
