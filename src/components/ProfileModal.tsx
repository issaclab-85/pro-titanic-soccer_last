import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Search } from 'lucide-react';
import {
  BOOT_COLORS,
  CLUBS,
  HAIR_COLORS,
  HAIR_STYLES,
  normalizeHairStyle,
  SKIN_TONES,
} from '../data/clubs';
import type { AvatarConfig, PlayerProfile } from '../types/game';

interface ProfileModalProps {
  profile: PlayerProfile;
  requireForLan?: boolean;
  onSave: (updated: PlayerProfile) => void;
  onClose: () => void;
}

export function ProfileModal({ profile, requireForLan, onSave, onClose }: ProfileModalProps) {
  const [playerName, setPlayerName] = useState(profile.playerName);
  const [clubId, setClubId] = useState(profile.clubId);
  const [jerseyText, setJerseyText] = useState(profile.jerseyText);
  const [jerseyNumber, setJerseyNumber] = useState(profile.jerseyNumber);
  const [avatar, setAvatar] = useState<AvatarConfig>(() => ({
    ...profile.avatar,
    hairStyle: normalizeHairStyle(profile.avatar?.hairStyle),
  }));
  const [clubQuery, setClubQuery] = useState('');

  const activeHair = useMemo(
    () => HAIR_STYLES.find((hs) => hs.id === avatar.hairStyle) ?? HAIR_STYLES[0],
    [avatar.hairStyle],
  );

  const filteredClubs = useMemo(() => {
    const q = clubQuery.trim().toLowerCase();
    if (!q) return CLUBS;
    return CLUBS.filter(
      (c) => c.name.toLowerCase().includes(q) || c.shortName.toLowerCase().includes(q),
    );
  }, [clubQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim().slice(0, 14) || 'STRIKER';
    const cleanJersey = jerseyText.trim().toUpperCase().slice(0, 12) || cleanName.toUpperCase();
    onSave({
      ...profile,
      playerName: cleanName,
      clubId,
      jerseyText: cleanJersey,
      jerseyNumber: Math.max(1, Math.min(99, Number(jerseyNumber) || 10)),
      avatar,
      profileConfirmed: true,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="fixed inset-0 z-30 flex h-dvh w-screen flex-col bg-[#060911] text-slate-100"
    >
      {/* Full-Screen Fixed Header */}
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
            <h2 className="text-base font-black text-white sm:text-xl">
              Customize Player &amp; Club
            </h2>
            <p className="hidden text-xs text-slate-400 sm:block">
              {requireForLan
                ? 'Confirm your player identity and kit before entering LAN Team Match.'
                : 'Customize your 3D avatar, club jersey across 30 teams, and nameplate.'}
            </p>
          </div>
        </div>

        <span className="rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-[#F5C542] uppercase">
          {CLUBS.length} Clubs Available
        </span>
      </div>

      {/* Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-5">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* Identity Row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Player Name (Overhead Tag)
              </label>
              <input
                type="text"
                required
                maxLength={14}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0b101d] px-3.5 py-2 text-sm font-semibold text-white outline-none focus:border-[#F5C542]"
                placeholder="e.g. LEO_10"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div className="col-span-2">
                <label className="mb-1 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Back Jersey Text
                </label>
                <input
                  type="text"
                  required
                  maxLength={12}
                  value={jerseyText}
                  onChange={(e) => setJerseyText(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-700 bg-[#0b101d] px-3 py-2 font-mono text-sm font-bold text-[#F5C542] uppercase outline-none focus:border-[#F5C542]"
                  placeholder="TITANIC"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  No.
                </label>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={jerseyNumber}
                  onChange={(e) => setJerseyNumber(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0b101d] px-3 py-2 text-center font-mono text-sm font-bold text-white outline-none focus:border-[#F5C542]"
                />
              </div>
            </div>
          </div>

          {/* Club Selection (30 Clubs with Search Filter) */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Select Club ({CLUBS.length} Teams)
              </label>
              <div className="relative w-full min-[480px]:w-56">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={clubQuery}
                  onChange={(e) => setClubQuery(e.target.value)}
                  placeholder="Search club or tag..."
                  className="w-full rounded-lg border border-slate-700 bg-[#0b101d] py-1.5 pr-3 pl-8 text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#F5C542]"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 min-[560px]:grid-cols-5 sm:grid-cols-6">
              {filteredClubs.map((c) => {
                const active = c.id === clubId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClubId(c.id)}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${
                      active
                        ? 'border-[#F5C542] bg-[#141c31] text-white shadow-[0_0_12px_rgba(245,197,66,0.2)]'
                        : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex h-4 w-8 overflow-hidden rounded border border-white/20">
                      <span className="w-1/2" style={{ backgroundColor: c.primaryColor }} />
                      <span className="w-1/2" style={{ backgroundColor: c.secondaryColor }} />
                    </div>
                    <span className="line-clamp-1 text-[10px] font-bold leading-tight">
                      {c.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Avatar Appearance */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Skin Tone
              </label>
              <div className="flex gap-2">
                {SKIN_TONES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setAvatar({ ...avatar, skinTone: s.hex })}
                    className={`h-8 flex-1 rounded-lg border-2 transition ${
                      avatar.skinTone === s.hex ? 'border-[#F5C542] scale-105' : 'border-slate-700'
                    }`}
                    style={{ backgroundColor: s.hex }}
                    title={s.label}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Hair Color
              </label>
              <div className="flex items-center gap-2">
                {HAIR_COLORS.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setAvatar({ ...avatar, hairColor: h.hex })}
                    className={`h-8 flex-1 rounded-lg border-2 transition ${
                      avatar.hairColor === h.hex ? 'border-[#F5C542] scale-105' : 'border-slate-700'
                    }`}
                    style={{ backgroundColor: h.hex }}
                    title={h.label}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <label className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Hairstyle ({HAIR_STYLES.length} Styles)
                </label>
                <span className="text-[11px] font-medium text-[#F5C542]">
                  {activeHair.label} · {activeHair.subtitle}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 min-[480px]:grid-cols-4 sm:grid-cols-5">
                {HAIR_STYLES.map((hs) => {
                  const active = avatar.hairStyle === hs.id;
                  return (
                    <button
                      key={hs.id}
                      type="button"
                      title={`${hs.label} — ${hs.subtitle}`}
                      onClick={() => setAvatar({ ...avatar, hairStyle: hs.id })}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-semibold transition ${
                        active
                          ? 'border-[#F5C542] bg-[#141c31] text-white shadow-[0_0_10px_rgba(245,197,66,0.18)]'
                          : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600 hover:text-slate-200'
                      }`}
                    >
                      <span className="block truncate whitespace-nowrap">{hs.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                Boot Color
              </label>
              <div className="grid grid-cols-2 gap-2">
                {BOOT_COLORS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setAvatar({ ...avatar, bootColor: b.hex })}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      avatar.bootColor === b.hex
                        ? 'border-[#F5C542] bg-[#141c31] text-white'
                        : 'border-slate-800 bg-[#0a0f1c] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: b.hex }} />
                    <span className="truncate">{b.label}</span>
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
          type="submit"
          className="flex items-center gap-2 rounded-xl bg-[#F5C542] px-5 py-2 text-xs font-black text-[#05070d] hover:bg-amber-300 sm:text-sm"
        >
          <Check className="h-4 w-4" />
          Save Profile &amp; Equip Kit
        </button>
      </div>
    </form>
  );
}
