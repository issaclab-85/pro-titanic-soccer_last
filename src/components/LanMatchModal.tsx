import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Loader2,
  RefreshCw,
  Server,
  Shield,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { CLUBS, getClubById } from '../data/clubs';
import {
  generateShortRoomCode,
  getLanClientInstance,
  normalizeShortRoomCode,
  type LanSignalingState,
} from '../services/lanClient';
import {
  FIELD_DIMENSIONS,
  MATCH_SIZE_COUNTS,
  type FieldSize,
  type LanMatchSettings,
  type LanRoomState,
  type LanRoomSummary,
  type MatchFormat,
  type MatchMinutes,
  type MatchSize,
  type PlayerProfile,
  type PlayerRole,
  type TeamSide,
} from '../types/game';

interface LanMatchModalProps {
  profile: PlayerProfile;
  clientId: string;
  connected: boolean;
  rooms: LanRoomSummary[];
  currentRoom: LanRoomState | null;
  errorMessage: string | null;
  onScanRooms: () => void;
  onCreateRoom: (settings: LanMatchSettings, customRoomCode?: string) => void;
  onJoinRoom: (roomId: string, preferredTeam?: TeamSide) => void;
  onLeaveRoom: () => void;
  onUpdateSettings: (settings: LanMatchSettings) => void;
  onSelectSlot: (team: TeamSide, role: PlayerRole) => void;
  onSetAiControl: (targetClientId: string, aiControlCount: number) => void;
  onHostAssignPlayer: (
    targetClientId: string,
    assignment: { team?: TeamSide; role?: PlayerRole },
  ) => void;
  onToggleReady: () => void;
  onClose: () => void;
}

const MATCH_TIMES: MatchMinutes[] = [4, 6, 8, 10];
const MATCH_SIZES: MatchSize[] = ['2v2', '3v3', '4v4', '5v5', '6v6'];
const FIELD_SIZES: FieldSize[] = ['compact', 'standard', 'titanic'];
const PRESET_ROOM_CODES = ['SR10', 'GOAL9', 'KICK42', 'PRO11'];

async function copyTextReliable(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to execCommand below for insecure HTTP WebViews
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function LanMatchModal({
  profile,
  clientId,
  connected,
  rooms,
  currentRoom,
  errorMessage,
  onScanRooms,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onUpdateSettings,
  onSelectSlot,
  onSetAiControl,
  onHostAssignPlayer,
  onToggleReady,
  onClose,
}: LanMatchModalProps) {
  const [tab, setTab] = useState<'join' | 'host'>('join');
  const [preferredJoinTeam, setPreferredJoinTeam] = useState<'auto' | TeamSide>('auto');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [customRoomCode, setCustomRoomCode] = useState(() => generateShortRoomCode(4));
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);

  const [hostSettings, setHostSettings] = useState<LanMatchSettings>({
    matchMinutes: 6,
    matchSize: '5v5',
    fieldSize: 'standard',
    homeClubId: profile.clubId,
    awayClubId: profile.clubId === 'realmadrid' ? 'barcelona' : 'realmadrid',
    matchFormat: 'standard',
  });

  const [signaling, setSignaling] = useState<LanSignalingState>(() => {
    const client = getLanClientInstance(clientId);
    return (
      client?.getSignalingState() ?? {
        transportMode: 'local',
        wsConnected: false,
        wsConnecting: false,
        serverHost: '',
        roomCode: null,
        statusMessage: 'Local / Offline Hotspot Ready',
        joinStatus: 'idle',
        joinTargetCode: null,
        joinError: null,
      }
    );
  });

  const [showHostIpBox, setShowHostIpBox] = useState(Boolean(signaling.serverHost));
  const [hostIpInput, setHostIpInput] = useState(signaling.serverHost);

  useEffect(() => {
    const client = getLanClientInstance(clientId);
    if (!client) return;
    return client.subscribeSignaling((next) => {
      setSignaling(next);
    });
  }, [clientId, currentRoom?.roomId]);

  const meInRoom = currentRoom?.players.find((p) => p.clientId === clientId);
  const isHost = Boolean(meInRoom?.isHost);

  const handleHostSettingChange = (patch: Partial<LanMatchSettings>) => {
    const next = { ...hostSettings, ...patch };
    setHostSettings(next);
    if (currentRoom && isHost) {
      onUpdateSettings({ ...currentRoom.settings, ...patch });
    }
  };

  const handleCopyRoomCode = async () => {
    if (!currentRoom?.roomId) return;
    const ok = await copyTextReliable(currentRoom.roomId);
    if (ok) {
      setRoomCodeCopied(true);
      window.setTimeout(() => setRoomCodeCopied(false), 1800);
    }
  };

  const handleJoinByShortCode = () => {
    const normalized = normalizeShortRoomCode(joinCodeInput);
    setJoinCodeInput(normalized);
    onJoinRoom(normalized, preferredJoinTeam === 'auto' ? undefined : preferredJoinTeam);
  };

  const handleApplyServerHost = () => {
    const client = getLanClientInstance(clientId);
    if (!client) return;
    client.setServerHost(hostIpInput);
  };

  const normalizedCustomCode = normalizeShortRoomCode(customRoomCode);
  const canCreateHostRoom = normalizedCustomCode.length >= 4 && normalizedCustomCode.length <= 6;
  const activeError = errorMessage || signaling.joinError;

  return (
    <div className="fixed inset-0 z-30 flex h-dvh w-screen flex-col bg-[#060911] text-slate-100">
      {/* Full-Screen Fixed Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800/90 px-4 py-2.5 sm:px-8 sm:py-3.5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-[#F5C542]/15 p-2 text-[#F5C542]">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white sm:text-xl">LAN Team Match</h2>
            <p className="text-[11px] text-slate-400 sm:text-xs">
              Player: <span className="text-slate-200">{profile.playerName}</span> ·{' '}
              <span
                className={
                  signaling.wsConnected
                    ? 'font-semibold text-emerald-400'
                    : connected
                      ? 'font-semibold text-[#F5C542]'
                      : 'text-slate-400'
                }
              >
                {signaling.statusMessage}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (currentRoom) onLeaveRoom();
            onClose();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-[#0d1322] px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-[#F5C542] hover:text-[#F5C542]"
          aria-label="Close LAN Lobby"
        >
          <X className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </button>
      </div>

      {/* Scrollable Full-Screen Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5 sm:px-8 sm:py-5">
        <div className="mx-auto w-full max-w-5xl">
          {activeError && (
            <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-950/60 px-4 py-2.5 text-xs font-semibold text-rose-200">
              {activeError}
            </div>
          )}

          {/* Active Shared Lobby View */}
          {currentRoom ? (
            <div>
              {/* Countdown & Automated Coin Toss Banner */}
              {currentRoom.status === 'countdown' && (
                <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-400 bg-amber-400/15 px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <Coins className="h-6 w-6 text-amber-400" />
                    <div>
                      <div className="text-sm font-black text-amber-300">
                        AUTOMATED COIN TOSS WINNER:{' '}
                        {currentRoom.kickoffTeam === 'home'
                          ? getClubById(currentRoom.settings.homeClubId).name
                          : getClubById(currentRoom.settings.awayClubId).name}
                      </div>
                      <div className="text-xs text-slate-200">
                        All players ready! Kick-off begins in...
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-3xl font-black text-amber-300 tabular-nums">
                    {currentRoom.countdownSeconds}s
                  </div>
                </div>
              )}

              {/* Short Room Code Banner */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D4AF37]/45 bg-[#0b1120] px-4 py-3">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                      {isHost ? 'Hosting Room' : 'Joined Room'}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-2xl font-black tracking-[0.18em] text-[#F5C542]">
                        {currentRoom.roomId}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-extrabold transition ${
                          roomCodeCopied
                            ? 'bg-emerald-400 text-slate-950'
                            : 'border border-slate-700 bg-slate-800 text-slate-100 hover:border-[#F5C542]'
                        }`}
                      >
                        {roomCodeCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copy Code
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-bold text-emerald-300">
                    <Users className="h-3.5 w-3.5" />
                    {currentRoom.playerCount}/{currentRoom.maxPlayers} Players
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Friends just enter code{' '}
                    <span className="font-mono font-bold text-slate-200">{currentRoom.roomId}</span>{' '}
                    in Join Match.
                  </p>
                </div>
              </div>

              {/* Match Settings Bar */}
              <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950 p-3.5 sm:p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                    Host: {currentRoom.hostName}
                  </span>
                  <span className="rounded bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                    {isHost ? 'Authoritative Host' : 'Connected to Host'}
                  </span>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Mode
                    </label>
                    <select
                      disabled={!isHost || currentRoom.status !== 'lobby'}
                      value={currentRoom.settings.matchFormat || 'standard'}
                      onChange={(e) =>
                        handleHostSettingChange({ matchFormat: e.target.value as MatchFormat })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      <option value="standard">Standard Match</option>
                      <option value="penalty_shootout">Penalty Shootout Only</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Home Club
                    </label>
                    <select
                      disabled={!isHost || currentRoom.status !== 'lobby'}
                      value={currentRoom.settings.homeClubId}
                      onChange={(e) => handleHostSettingChange({ homeClubId: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      {CLUBS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Away Club
                    </label>
                    <select
                      disabled={!isHost || currentRoom.status !== 'lobby'}
                      value={currentRoom.settings.awayClubId}
                      onChange={(e) => handleHostSettingChange({ awayClubId: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      {CLUBS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Time
                    </label>
                    <select
                      disabled={
                        !isHost ||
                        currentRoom.status !== 'lobby' ||
                        currentRoom.settings.matchFormat === 'penalty_shootout'
                      }
                      value={currentRoom.settings.matchMinutes}
                      onChange={(e) =>
                        handleHostSettingChange({
                          matchMinutes: Number(e.target.value) as MatchMinutes,
                        })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      {MATCH_TIMES.map((m) => (
                        <option key={m} value={m}>
                          {m} Minutes
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Size
                    </label>
                    <select
                      disabled={!isHost || currentRoom.status !== 'lobby'}
                      value={currentRoom.settings.matchSize}
                      onChange={(e) =>
                        handleHostSettingChange({ matchSize: e.target.value as MatchSize })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      {MATCH_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-bold text-slate-500 uppercase">
                      Field
                    </label>
                    <select
                      disabled={!isHost || currentRoom.status !== 'lobby'}
                      value={currentRoom.settings.fieldSize}
                      onChange={(e) =>
                        handleHostSettingChange({ fieldSize: e.target.value as FieldSize })
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-65"
                    >
                      {FIELD_SIZES.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_DIMENSIONS[f].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Two Team Columns for Role Assignment */}
              <div className="grid gap-4 sm:grid-cols-2">
                {(['home', 'away'] as TeamSide[]).map((teamSide) => {
                  const club = getClubById(
                    teamSide === 'home'
                      ? currentRoom.settings.homeClubId
                      : currentRoom.settings.awayClubId,
                  );
                  const roster = currentRoom.players.filter((p) => p.team === teamSide);
                  const perTeamLimit = MATCH_SIZE_COUNTS[currentRoom.settings.matchSize] ?? 5;
                  const humanOutfieldCount = roster.filter((p) => p.role === 'outfield').length;
                  const teamAiOutfieldSlots = Math.max(0, perTeamLimit - 1 - humanOutfieldCount);
                  const totalTeamAiBots = Math.max(0, perTeamLimit - roster.length);
                  const teamFullForNewJoiner =
                    meInRoom?.team !== teamSide && roster.length >= perTeamLimit;
                  const gkTaken = roster.some(
                    (p) => p.role === 'goalkeeper' && p.clientId !== clientId,
                  );

                  return (
                    <div
                      key={teamSide}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 sm:p-4"
                    >
                      <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3.5 w-3.5 rounded-sm border border-white/25"
                            style={{ backgroundColor: club.primaryColor }}
                          />
                          <span className="text-sm font-extrabold text-white">
                            {teamSide === 'home' ? 'HOME' : 'AWAY'} · {club.name}
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400">
                          {roster.length} {roster.length === 1 ? 'Human' : 'Humans'}
                          {totalTeamAiBots > 0 ? ` · ${totalTeamAiBots} AI` : ' · Full'}
                        </span>
                      </div>

                      <div className="mb-3 flex gap-2">
                        <button
                          type="button"
                          disabled={teamFullForNewJoiner}
                          onClick={() => onSelectSlot(teamSide, 'outfield')}
                          className={`flex-1 rounded-lg border px-2.5 py-2 text-xs font-bold transition disabled:opacity-45 ${
                            meInRoom?.team === teamSide && meInRoom?.role === 'outfield'
                              ? 'border-sky-400 bg-sky-400/20 text-sky-200'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {teamFullForNewJoiner ? 'Team Full' : 'Join as Outfield'}
                        </button>
                        <button
                          type="button"
                          disabled={teamFullForNewJoiner || gkTaken}
                          onClick={() => onSelectSlot(teamSide, 'goalkeeper')}
                          className={`flex-1 rounded-lg border px-2.5 py-2 text-xs font-bold transition disabled:opacity-45 ${
                            meInRoom?.team === teamSide && meInRoom?.role === 'goalkeeper'
                              ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                          }`}
                        >
                          {gkTaken
                            ? 'GK Claimed'
                            : teamFullForNewJoiner
                              ? 'Team Full'
                              : 'Play as GK'}
                        </button>
                      </div>

                      <div className="space-y-2">
                        {roster.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500">
                            Full AI Squad ({perTeamLimit} AI Bots) — Odd &amp; asymmetric teams
                            supported
                          </div>
                        ) : (
                          roster.map((p) => {
                            const assignedCount = Math.min(
                              teamAiOutfieldSlots,
                              Math.max(0, p.aiControlCount ?? 0),
                            );
                            return (
                              <div
                                key={p.clientId}
                                className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Shield
                                      className={`h-3.5 w-3.5 ${
                                        p.role === 'goalkeeper' ? 'text-amber-400' : 'text-sky-400'
                                      }`}
                                    />
                                    <span className="font-bold text-white">{p.playerName}</span>
                                    {p.isHost && (
                                      <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                        HOST
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] text-slate-400 uppercase">
                                      {p.role === 'goalkeeper' ? 'GK' : 'Outfield'}
                                    </span>
                                    <span
                                      className={`font-bold ${
                                        p.ready ? 'text-emerald-400' : 'text-slate-500'
                                      }`}
                                    >
                                      {p.ready ? 'READY' : 'WAIT'}
                                    </span>
                                  </div>
                                </div>

                                {isHost && currentRoom.status === 'lobby' && (
                                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-1.5 text-[10px]">
                                    <span className="font-bold tracking-wider text-amber-300/90 uppercase">
                                      Host Override
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const otherTeam: TeamSide =
                                            teamSide === 'home' ? 'away' : 'home';
                                          onHostAssignPlayer(p.clientId, { team: otherTeam });
                                        }}
                                        className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-bold text-slate-200 hover:border-sky-400 hover:text-white"
                                      >
                                        {currentRoom.players.filter(
                                          (x) =>
                                            x.team === (teamSide === 'home' ? 'away' : 'home'),
                                        ).length >= perTeamLimit
                                          ? `Swap ↔ ${teamSide === 'home' ? 'Away' : 'Home'}`
                                          : teamSide === 'home'
                                            ? 'Move → Away'
                                            : '← Move Home'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onHostAssignPlayer(p.clientId, {
                                            role:
                                              p.role === 'goalkeeper' ? 'outfield' : 'goalkeeper',
                                          })
                                        }
                                        className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-bold text-amber-300 hover:border-amber-400"
                                      >
                                        {p.role === 'goalkeeper' ? 'Set Outfield' : 'Set GK'}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {p.role === 'outfield' && teamAiOutfieldSlots > 0 && (
                                  <div className="mt-2 flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[11px]">
                                    <span className="text-slate-400">AI Co-Control on Pass</span>
                                    {isHost && currentRoom.status === 'lobby' ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          disabled={assignedCount <= 0}
                                          onClick={() =>
                                            onSetAiControl(
                                              p.clientId,
                                              Math.max(0, assignedCount - 1),
                                            )
                                          }
                                          className="flex h-5 w-5 items-center justify-center rounded border border-slate-700 bg-slate-800 font-bold text-white hover:border-amber-400 disabled:opacity-40"
                                        >
                                          -
                                        </button>
                                        <span className="min-w-[44px] text-center font-mono font-bold text-cyan-300">
                                          {assignedCount}/{teamAiOutfieldSlots} AI
                                        </span>
                                        <button
                                          type="button"
                                          disabled={assignedCount >= teamAiOutfieldSlots}
                                          onClick={() =>
                                            onSetAiControl(
                                              p.clientId,
                                              Math.min(teamAiOutfieldSlots, assignedCount + 1),
                                            )
                                          }
                                          className="flex h-5 w-5 items-center justify-center rounded border border-slate-700 bg-slate-800 font-bold text-white hover:border-amber-400 disabled:opacity-40"
                                        >
                                          +
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="font-mono font-bold text-cyan-300">
                                        {assignedCount} AI {assignedCount === 1 ? 'Slot' : 'Slots'}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3.5">
                <button
                  type="button"
                  onClick={onLeaveRoom}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Leave Lobby
                </button>
                <button
                  type="button"
                  onClick={onToggleReady}
                  className={`flex items-center gap-2 rounded-xl px-6 py-2 text-sm font-extrabold transition ${
                    meInRoom?.ready
                      ? 'border border-emerald-400 bg-emerald-400/20 text-emerald-300'
                      : 'bg-[#F5C542] text-slate-950 hover:bg-amber-300'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {meInRoom?.ready ? 'Ready (Click to Cancel)' : 'Click Ready for Kick-Off'}
                </button>
              </div>
            </div>
          ) : (
            /* Join or Host View */
            <div>
              <div className="mb-4 flex gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setTab('join');
                    onScanRooms();
                  }}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${
                    tab === 'join' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Join Match
                </button>
                <button
                  type="button"
                  onClick={() => setTab('host')}
                  className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${
                    tab === 'host'
                      ? 'bg-[#F5C542] text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Host LAN Match
                </button>
              </div>

              {tab === 'join' ? (
                <div className="space-y-4">
                  {/* Single-Step Short Code Entry */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black tracking-wider text-[#F5C542] uppercase">
                          Enter Host Room Code
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Type the 4–6 character code shared by Host and tap Join.
                        </p>
                      </div>

                      <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px] font-bold">
                        <span className="px-1.5 text-slate-500">Team:</span>
                        {(['auto', 'home', 'away'] as const).map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => setPreferredJoinTeam(choice)}
                            className={`rounded-md px-2 py-1 capitalize transition ${
                              preferredJoinTeam === choice
                                ? choice === 'home'
                                  ? 'bg-sky-500 text-slate-950'
                                  : choice === 'away'
                                    ? 'bg-rose-500 text-white'
                                    : 'bg-[#F5C542] text-slate-950'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {choice === 'auto' ? 'Auto' : choice === 'home' ? 'Home' : 'Away'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
                      <input
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={6}
                        value={joinCodeInput}
                        onChange={(e) => setJoinCodeInput(normalizeShortRoomCode(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && joinCodeInput.length >= 4) {
                            handleJoinByShortCode();
                          }
                        }}
                        placeholder="SR10"
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-center font-mono text-xl font-black tracking-[0.28em] text-white uppercase placeholder:tracking-[0.2em] placeholder:text-slate-600 focus:border-[#F5C542] focus:outline-none sm:text-left"
                      />
                      <button
                        type="button"
                        disabled={
                          joinCodeInput.length < 4 || signaling.joinStatus === 'connecting'
                        }
                        onClick={handleJoinByShortCode}
                        className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#F5C542] px-7 py-3 text-sm font-black text-slate-950 hover:bg-amber-300 disabled:opacity-45"
                      >
                        {signaling.joinStatus === 'connecting' ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          'Join Match'
                        )}
                      </button>
                    </div>

                    {signaling.joinStatus === 'connecting' && signaling.joinTargetCode && (
                      <div className="mt-2.5 flex items-center gap-2 text-xs font-semibold text-sky-300">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Connecting to {signaling.joinTargetCode}...
                      </div>
                    )}
                  </div>

                  {/* Discovered Open Lobbies */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/85 p-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                        Available Rooms ({rooms.length})
                      </span>
                      <button
                        type="button"
                        onClick={onScanRooms}
                        className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-[#F5C542] hover:text-[#F5C542]"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Refresh
                      </button>
                    </div>

                    {rooms.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-800 px-4 py-5 text-center text-xs text-slate-500">
                        No open lobbies detected automatically yet. Enter the Host&apos;s short
                        room code above or tap Refresh.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {rooms.map((room) => {
                          const home = getClubById(room.settings.homeClubId);
                          const away = getClubById(room.settings.awayClubId);
                          return (
                            <div
                              key={room.roomId}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5"
                            >
                              <div className="flex items-center gap-3">
                                <span className="rounded-lg border border-[#D4AF37]/40 bg-[#0b1120] px-2.5 py-1 font-mono text-sm font-black tracking-wider text-[#F5C542]">
                                  {room.roomId}
                                </span>
                                <div>
                                  <div className="flex items-center gap-2 text-sm font-extrabold text-white">
                                    <span>{room.hostName}&apos;s Room</span>
                                    <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-sky-300">
                                      {room.settings.matchFormat === 'penalty_shootout'
                                        ? 'PENALTY'
                                        : `${room.settings.matchSize} · ${room.settings.matchMinutes}m`}
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    {home.name} vs {away.name} · {room.playerCount}/
                                    {room.maxPlayers} Players
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  onJoinRoom(
                                    room.roomId,
                                    preferredJoinTeam === 'auto' ? undefined : preferredJoinTeam,
                                  )
                                }
                                className="rounded-xl bg-sky-400 px-4 py-2 text-xs font-black text-slate-950 hover:bg-sky-300"
                              >
                                Join
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Optional LAN Host Server IP (collapsed unless standalone APK user needs custom IP) */}
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2.5">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setShowHostIpBox((prev) => !prev)}
                        className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                      >
                        <Server className="h-3.5 w-3.5 text-[#F5C542]" />
                        <span>
                          {signaling.serverHost
                            ? `Custom LAN Host IP: ${signaling.serverHost}`
                            : 'Different Wi-Fi Host IP? (Optional)'}
                        </span>
                      </button>
                      {signaling.wsConnected && (
                        <span className="text-[10px] font-bold text-emerald-400">
                          Server Connected
                        </span>
                      )}
                    </div>

                    {showHostIpBox && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2.5">
                        <input
                          type="text"
                          value={hostIpInput}
                          onChange={(e) => setHostIpInput(e.target.value)}
                          placeholder="e.g. 192.168.43.1:3000"
                          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-white placeholder:text-slate-500"
                        />
                        <button
                          type="button"
                          onClick={handleApplyServerHost}
                          className="rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-sky-300"
                        >
                          Connect
                        </button>
                        {signaling.serverHost && (
                          <button
                            type="button"
                            onClick={() => {
                              setHostIpInput('');
                              getLanClientInstance(clientId)?.setServerHost('');
                            }}
                            className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:text-white"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Host Tab */
                <div className="space-y-4">
                  {/* Custom Short Room Code Setup */}
                  <div className="rounded-xl border border-[#D4AF37]/40 bg-slate-950 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <label className="block text-xs font-black tracking-wider text-[#F5C542] uppercase">
                          Room Code (4–6 Characters)
                        </label>
                        <p className="text-[11px] text-slate-400">
                          Customize your short code or pick a quick preset for friends to type.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCustomRoomCode(generateShortRoomCode(4))}
                        className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-slate-200 hover:border-[#F5C542] hover:text-[#F5C542]"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Randomize
                      </button>
                    </div>

                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        inputMode="text"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength={6}
                        value={customRoomCode}
                        onChange={(e) => setCustomRoomCode(normalizeShortRoomCode(e.target.value))}
                        placeholder="SR10"
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-center font-mono text-lg font-black tracking-[0.25em] text-[#F5C542] uppercase focus:border-[#F5C542] focus:outline-none sm:w-48"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-[11px] font-semibold text-slate-500">
                          Presets:
                        </span>
                        {PRESET_ROOM_CODES.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setCustomRoomCode(preset)}
                            className={`rounded-lg border px-2.5 py-1 font-mono text-xs font-bold transition ${
                              normalizedCustomCode === preset
                                ? 'border-[#F5C542] bg-[#F5C542]/20 text-[#F5C542]'
                                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    {!canCreateHostRoom && (
                      <p className="mt-1.5 text-[11px] font-semibold text-amber-300">
                        Enter at least 4 letters or numbers for your Room Code.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-sky-400 uppercase">
                        Team 1 (Home)
                      </label>
                      <select
                        value={hostSettings.homeClubId}
                        onChange={(e) => handleHostSettingChange({ homeClubId: e.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {CLUBS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-bold text-rose-400 uppercase">
                        Team 2 (Away)
                      </label>
                      <select
                        value={hostSettings.awayClubId}
                        onChange={(e) => handleHostSettingChange({ awayClubId: e.target.value })}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {CLUBS.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-400 uppercase">
                        Match Format
                      </label>
                      <select
                        value={hostSettings.matchFormat}
                        onChange={(e) =>
                          handleHostSettingChange({ matchFormat: e.target.value as MatchFormat })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        <option value="standard">
                          Standard Match (With Extra Time / Tiebreaker)
                        </option>
                        <option value="penalty_shootout">Penalty Shootout Only</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-400 uppercase">
                        Match Time
                      </label>
                      <select
                        disabled={hostSettings.matchFormat === 'penalty_shootout'}
                        value={hostSettings.matchMinutes}
                        onChange={(e) =>
                          handleHostSettingChange({
                            matchMinutes: Number(e.target.value) as MatchMinutes,
                          })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-45"
                      >
                        {MATCH_TIMES.map((m) => (
                          <option key={m} value={m}>
                            {m} Minutes
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-400 uppercase">
                        Player Quantity
                      </label>
                      <select
                        value={hostSettings.matchSize}
                        onChange={(e) =>
                          handleHostSettingChange({ matchSize: e.target.value as MatchSize })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {MATCH_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-bold text-slate-400 uppercase">
                        Field Size
                      </label>
                      <select
                        value={hostSettings.fieldSize}
                        onChange={(e) =>
                          handleHostSettingChange({ fieldSize: e.target.value as FieldSize })
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
                      >
                        {FIELD_SIZES.map((f) => (
                          <option key={f} value={f}>
                            {FIELD_DIMENSIONS[f].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={!canCreateHostRoom}
                      onClick={() => onCreateRoom(hostSettings, normalizedCustomCode)}
                      className="rounded-xl bg-[#F5C542] px-6 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-300 disabled:opacity-45"
                    >
                      Open Host Lobby ({normalizedCustomCode || 'CODE'})
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
