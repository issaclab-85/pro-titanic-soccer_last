import { Clock, Crosshair, Users } from 'lucide-react';
import type { DrawDecisionState, DrawVoteOption, LanRoomState } from '../types/game';

interface DrawDecisionModalProps {
  drawState: DrawDecisionState;
  homeClubName: string;
  awayClubName: string;
  isLan: boolean;
  localClientId: string;
  room: LanRoomState | null;
  onVote: (choice: DrawVoteOption) => void;
}

export function DrawDecisionModal({
  drawState,
  homeClubName,
  awayClubName,
  isLan,
  localClientId,
  room,
  onVote,
}: DrawDecisionModalProps) {
  const myVote = drawState.votes[localClientId];
  const voteCount = Object.keys(drawState.votes).length;
  const moreTimeVotes = Object.values(drawState.votes).filter((v) => v === 'more_time').length;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/84 p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-400/60 bg-slate-900 p-6 text-slate-100 shadow-2xl">
        <div className="text-center">
          <div className="text-xs font-extrabold tracking-[0.26em] text-amber-400 uppercase">
            Match Tied at Full Time
          </div>
          <h2 className="mt-1 text-2xl font-black text-white">
            {homeClubName} {drawState.homeScore} – {drawState.awayScore} {awayClubName}
          </h2>
          <p className="mt-1.5 text-xs text-slate-400">
            {isLan
              ? 'All players must agree on More Time (+2m), or choose Tiebreaker to launch Penalty Shootout.'
              : 'Choose whether to play 2 extra minutes or settle it immediately in a Penalty Shootout.'}
          </p>
        </div>

        {isLan && (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold tracking-wider text-slate-400 uppercase">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-sky-400" />
                LAN Player Votes ({voteCount}/{drawState.totalPlayers})
              </span>
              <span className="text-emerald-300">
                {moreTimeVotes}/{drawState.totalPlayers} More Time
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(room?.players ?? []).map((p) => {
                const vote = drawState.votes[p.clientId];
                return (
                  <span
                    key={p.clientId}
                    className={`rounded-md border px-2 py-1 text-[11px] font-bold ${
                      vote === 'more_time'
                        ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200'
                        : vote === 'tiebreaker'
                          ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400'
                    }`}
                  >
                    {p.playerName}:{' '}
                    {vote === 'more_time'
                      ? 'More Time'
                      : vote === 'tiebreaker'
                        ? 'Tiebreaker'
                        : 'Pending'}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={Boolean(isLan && myVote === 'more_time')}
            onClick={() => onVote('more_time')}
            className={`flex flex-col items-center justify-center rounded-xl border p-4 text-center transition ${
              myVote === 'more_time'
                ? 'border-emerald-400 bg-emerald-400/20 text-white'
                : 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
            }`}
          >
            <Clock className="h-6 w-6 text-emerald-300" />
            <span className="mt-2 text-sm font-black uppercase">More Time</span>
            <span className="mt-0.5 text-[11px] text-emerald-200/80">
              {myVote === 'more_time' ? 'Voted (+2 Min)' : 'Add +2 Extra Minutes'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onVote('tiebreaker')}
            className="flex flex-col items-center justify-center rounded-xl border border-amber-400 bg-amber-400/20 p-4 text-center text-white transition hover:bg-amber-400/30"
          >
            <Crosshair className="h-6 w-6 text-amber-300" />
            <span className="mt-2 text-sm font-black uppercase">Tiebreaker</span>
            <span className="mt-0.5 text-[11px] text-amber-200/90">
              Launch Penalty Shootout
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
