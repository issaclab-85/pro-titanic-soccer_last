export type MatchSize = '2v2' | '3v3' | '4v4' | '5v5' | '6v6';
export type FieldSize = 'compact' | 'standard' | 'titanic';
export type MatchMinutes = 4 | 6 | 8 | 10;
export type MatchFormat = 'standard' | 'penalty_shootout';
export type AiDifficulty = 'rookie' | 'pro' | 'titanic';
export type PlayerRole = 'outfield' | 'goalkeeper';
export type TeamSide = 'home' | 'away';
export type GameScreen = 'home' | 'playing' | 'paused' | 'fulltime' | 'quit';
export type GameMode = 'alone' | 'lan';

export type JerseyPattern = 'stripes' | 'solid' | 'hoops' | 'sash' | 'halves';

export interface ClubConfig {
  id: string;
  name: string;
  shortName: string;
  primaryColor: string;
  secondaryColor: string;
  shortsColor: string;
  socksColor: string;
  accentColor: string;
  pattern: JerseyPattern;
  awayPrimary: string;
  awaySecondary: string;
  gkColor: string;
}

export type HairStyleId =
  | 'ronaldo'
  | 'choudhury'
  | 'cucurella'
  | 'neymar'
  | 'mbappe'
  | 'haaland'
  | 'bellingham'
  | 'salah'
  | 'grealish'
  | 'vinicius'
  | 'beckham'
  | 'gullit'
  | 'pogba'
  | 'modric'
  | 'kante'
  | 'ramos'
  | 'garnacho'
  | 'zidane'
  | 'tactical_bun'
  | 'classic_crew';

export interface AvatarConfig {
  skinTone: string;
  hairColor: string;
  hairStyle: HairStyleId;
  bootColor: string;
}

export interface PlayerProfile {
  id: string;
  playerName: string;
  clubId: string;
  jerseyText: string;
  jerseyNumber: number;
  avatar: AvatarConfig;
  profileConfirmed: boolean;
}

export interface AloneMatchConfig {
  userClubId: string;
  aiClubId: string;
  matchMinutes: MatchMinutes;
  matchSize: MatchSize;
  fieldSize: FieldSize;
  userRole: PlayerRole;
  matchFormat: MatchFormat;
  aiDifficulty?: AiDifficulty;
}

export interface LanMatchSettings {
  matchMinutes: MatchMinutes;
  matchSize: MatchSize;
  fieldSize: FieldSize;
  homeClubId: string;
  awayClubId: string;
  matchFormat: MatchFormat;
}

export interface LanLobbyPlayer {
  clientId: string;
  playerName: string;
  jerseyText: string;
  jerseyNumber: number;
  avatar: AvatarConfig;
  isHost: boolean;
  team: TeamSide;
  role: PlayerRole;
  ready: boolean;
  aiControlCount: number;
}

export interface LanRoomSummary {
  roomId: string;
  hostName: string;
  settings: LanMatchSettings;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'countdown' | 'playing';
}

export interface LanRoomState extends LanRoomSummary {
  players: LanLobbyPlayer[];
  kickoffTeam: TeamSide | null;
  countdownSeconds: number;
}

export interface ClientMatchInput {
  seq?: number;
  moveX: number;
  moveZ: number;
  sprint: boolean;
  groundedPass: boolean;
  throughPass: boolean;
  loftOrTackle: boolean;
  shoot: boolean;
  gkJumpOrDive: boolean;
  gkQuickAction?: 'jump';
  standTackle?: boolean;
  slideTackle?: boolean;
  secondDefenderPress?: boolean;
  switchPlayer?: boolean;
}

export interface SyncedPlayerState {
  id: string;
  team: TeamSide;
  role: PlayerRole;
  x: number;
  y: number;
  z: number;
  rotY: number;
  vx: number;
  vz: number;
  stamina: number;
  diveState: 'none' | 'jump' | 'left' | 'right' | 'forward';
  diveDirX?: number;
  diveDirY?: number;
  tackleTimer: number;
  standTackleTimer?: number;
  jerseyText: string;
  jerseyNumber: number;
  skinTone: string;
  hairColor: string;
  hairStyle: AvatarConfig['hairStyle'];
  bootColor: string;
  controlledByClientId: string | null;
}

export interface SyncedGoalBanner {
  team: TeamSide;
  scorer: string;
  scorerName?: string;
  scorerNumber?: number;
  assistName?: string | null;
  shotSpeedKmh?: number;
  highlightSaved?: boolean;
}

export interface MatchSummaryStats {
  homeShots: number;
  awayShots: number;
  homeSaves: number;
  awaySaves: number;
  homePasses: number;
  awayPasses: number;
  homeTackles: number;
  awayTackles: number;
}

export type ShootoutKickResult = 'goal' | 'miss';
export type ShootoutPhase = 'aiming' | 'run_up' | 'ball_in_flight' | 'result';
export type DrawVoteOption = 'more_time' | 'tiebreaker';

export interface ShootoutHudState {
  active: boolean;
  round: number;
  turnTeam: TeamSide;
  phase: ShootoutPhase;
  homeShootoutScore: number;
  awayShootoutScore: number;
  homeKicks: ShootoutKickResult[];
  awayKicks: ShootoutKickResult[];
  isSuddenDeath: boolean;
  localRole: 'kicker' | 'gk' | 'spectator';
  kickerName: string;
  gkName: string;
  shotClockSeconds: number;
  resultBanner: string | null;
  aimX: number;
  aimY: number;
  activeKickerActorId: string | null;
  activeGkActorId: string | null;
}

export interface DrawDecisionState {
  active: boolean;
  homeScore: number;
  awayScore: number;
  votes: Record<string, DrawVoteOption>;
  totalPlayers: number;
  extraTimeCount: number;
}

export type GraphicsQuality = 'low' | 'medium' | 'high';
export type SetPieceKind = 'corner' | 'throw_in' | 'goal_kick' | 'free_kick';

export interface SetPieceHudState {
  active: boolean;
  kind: SetPieceKind;
  team: TeamSide;
  clubShort: string;
  takerName: string;
  isLocalTaker: boolean;
  isHumanTaker: boolean;
  countdownSeconds: number | null;
}

export interface LiveGoalReplayHudState {
  active: boolean;
  scoringClubShort: string;
  scoringColor: string;
  scorerLabel: string;
  remainingSeconds: number;
}

export interface PreMatchLineupPlayer {
  id: string;
  name: string;
  number: number;
  roleLabel: string;
  isHuman: boolean;
  controllerName?: string;
}

export interface PreMatchCutsceneHudState {
  active: boolean;
  scene: 1 | 2 | 3 | 4;
  sceneLabel: string;
  showLineupOverlay: boolean;
  countdownSeconds: number;
  canSkip: boolean;
  homeClubName: string;
  awayClubName: string;
  homeColor: string;
  awayColor: string;
  homeFormation: string;
  awayFormation: string;
  homeLineup: PreMatchLineupPlayer[];
  awayLineup: PreMatchLineupPlayer[];
}

export interface RadarDot {
  id: string;
  team: TeamSide;
  role: PlayerRole;
  xNorm: number; // -1..1 across field width
  zNorm: number; // -1..1 across field length
  isLocal: boolean;
}

export interface RadarHudState {
  players: RadarDot[];
  ballXNorm: number;
  ballZNorm: number;
}

export interface SyncedMatchSnapshot {
  tick: number;
  clockSeconds: number;
  homeScore: number;
  awayScore: number;
  kickoffTeam: TeamSide;
  goalBanner: SyncedGoalBanner | null;
  setPiece?: SetPieceHudState | null;
  shootout?: ShootoutHudState | null;
  preMatch?: PreMatchCutsceneHudState | null;
  liveGoalReplay?: LiveGoalReplayHudState | null;
  secondDefenderHomeActive?: boolean;
  secondDefenderAwayActive?: boolean;
  localControlledMap?: Record<string, string>;
  stats?: MatchSummaryStats;
  ball: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
  };
  players: SyncedPlayerState[];
}

export interface HighlightActorPose {
  id: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  vx: number;
  vz: number;
  diveState: 'none' | 'jump' | 'left' | 'right' | 'forward';
  tackleTimer: number;
  kickAnimTimer: number;
}

export interface HighlightFrame {
  t: number;
  ball: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
  };
  actors: HighlightActorPose[];
}

export type KeyPlayType = 'goal' | 'save' | 'post' | 'shot';

export interface GoalHighlight {
  id: string;
  goalNumber: number;
  scoringTeam: TeamSide;
  scoringClubName: string;
  scoringClubShort: string;
  scoringColor: string;
  scorerName: string;
  scorerNumber: number;
  assistName: string | null;
  matchTimeLabel: string;
  homeScoreAfter: number;
  awayScoreAfter: number;
  shotSpeedKmh: number;
  snapshotDataUrl: string;
  frames: HighlightFrame[];
  duration: number;
  goalTimestamp: number;
}

export interface KeyPlaySnapshot {
  id: string;
  type: KeyPlayType;
  title: string;
  subtitle: string;
  team: TeamSide;
  clubShort: string;
  clubColor: string;
  playerName: string;
  matchTimeLabel: string;
  scoreLabel: string;
  snapshotDataUrl: string;
  highlightId?: string;
}

export interface MatchRecapData {
  homeScore: number;
  awayScore: number;
  homeShootoutScore?: number;
  awayShootoutScore?: number;
  decidedByShootout?: boolean;
  homeClubName: string;
  awayClubName: string;
  homeClubShort: string;
  awayClubShort: string;
  homeColor: string;
  awayColor: string;
  durationLabel: string;
  highlights: GoalHighlight[];
  snapshots: KeyPlaySnapshot[];
  stats: MatchSummaryStats;
}

export type ReplayCameraAngle = 'broadcast' | 'goalcam' | 'scorercam';

export interface ReplayPlaybackState {
  activeHighlightId: string;
  goalNumber: number;
  scoringClubShort: string;
  scoringColor: string;
  scorerName: string;
  matchTimeLabel: string;
  scoreLabel: string;
  playing: boolean;
  speed: 0.5 | 1 | 1.5;
  currentTime: number;
  duration: number;
  goalTimestamp: number;
  cameraAngle: ReplayCameraAngle;
  goalBannerVisible: boolean;
}

export interface MatchHudState {
  homeScore: number;
  awayScore: number;
  timeRemainingSeconds: number;
  totalSeconds: number;
  homeClubName: string;
  awayClubName: string;
  homeColor: string;
  awayColor: string;
  activePlayerName: string;
  activeRole: PlayerRole;
  localTeam: TeamSide;
  canSwitchPlayer: boolean;
  stamina: number;
  hasBall: boolean;
  teamHasBall: boolean;
  secondDefenderActive: boolean;
  kickoffTeam: TeamSide;
  goalBanner: SyncedGoalBanner | null;
  lastActionHint: string;
  cameraOrbited: boolean;
  quickGlancing: boolean;
  highlightsCount: number;
  shootout: ShootoutHudState | null;
  setPiece: SetPieceHudState | null;
  liveGoalReplay: LiveGoalReplayHudState | null;
  preMatch: PreMatchCutsceneHudState | null;
  radar: RadarHudState | null;
  lanNotice?: string | null;
}

export const MATCH_SIZE_COUNTS: Record<MatchSize, number> = {
  '2v2': 2,
  '3v3': 3,
  '4v4': 4,
  '5v5': 5,
  '6v6': 6,
};

export const FIELD_DIMENSIONS: Record<
  FieldSize,
  { width: number; length: number; label: string; desc: string }
> = {
  compact: { width: 42, length: 64, label: 'Compact', desc: 'Fast 42m × 64m cage pace' },
  standard: { width: 54, length: 82, label: 'Standard', desc: 'Balanced 54m × 82m arena' },
  titanic: { width: 68, length: 102, label: 'Titanic', desc: 'Full 68m × 102m stadium pitch' },
};
