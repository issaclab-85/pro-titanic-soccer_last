import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getClubById } from '../data/clubs';
import {
  FIELD_DIMENSIONS,
  MATCH_SIZE_COUNTS,
  type AiDifficulty,
  type AloneMatchConfig,
  type AvatarConfig,
  type ClientMatchInput,
  type ClubConfig,
  type FieldSize,
  type GoalHighlight,
  type GraphicsQuality,
  type HighlightFrame,
  type KeyPlaySnapshot,
  type KeyPlayType,
  type LanLobbyPlayer,
  type LanRoomState,
  type LiveGoalReplayHudState,
  type MatchFormat,
  type MatchHudState,
  type MatchRecapData,
  type MatchSize,
  type MatchSummaryStats,
  type PlayerProfile,
  type PlayerRole,
  type PreMatchCutsceneHudState,
  type PreMatchLineupPlayer,
  type RadarHudState,
  type ReplayCameraAngle,
  type ReplayPlaybackState,
  type SetPieceHudState,
  type SetPieceKind,
  type ShootoutHudState,
  type ShootoutKickResult,
  type SyncedGoalBanner,
  type SyncedMatchSnapshot,
  type SyncedPlayerState,
  type TeamSide,
} from '../types/game';
import {
  createFootballMesh,
  createPlayerRig,
  createStadiumEnvironment,
  type PlayerRig,
} from './models';
import { soccerAudio } from './sound';
import { createContactShadowTexture } from './textures';

// Module-scope reusable scratch math helpers (Zero GC in the render loop)
const _camTarget = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _ballAxis = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);

type TacticalRole = 'defender' | 'midfielder' | 'forward';
type FormationRole = 'gk' | 'cb' | 'lb' | 'rb' | 'cm' | 'lw' | 'rw' | 'st';

interface AiDifficultyTuning {
  thinkInterval: number;
  speedScale: number;
  sprintScale: number;
  passVisionRange: number;
  pressAggression: number;
  tackleChance: number;
  tackleCooldown: number;
  interceptionRange: number;
  shotPrecision: number;
}

const AI_DIFFICULTY_TUNINGS: Record<AiDifficulty, AiDifficultyTuning> = {
  rookie: {
    thinkInterval: 0.36,
    speedScale: 0.9,
    sprintScale: 0.88,
    passVisionRange: 34,
    pressAggression: 0.65,
    tackleChance: 0.42,
    tackleCooldown: 2.8,
    interceptionRange: 4.6,
    shotPrecision: 0.55,
  },
  pro: {
    thinkInterval: 0.2,
    speedScale: 1.0,
    sprintScale: 1.0,
    passVisionRange: 48,
    pressAggression: 0.92,
    tackleChance: 0.78,
    tackleCooldown: 1.9,
    interceptionRange: 7.4,
    shotPrecision: 0.82,
  },
  titanic: {
    thinkInterval: 0.13,
    speedScale: 1.08,
    sprintScale: 1.08,
    passVisionRange: 60,
    pressAggression: 1.08,
    tackleChance: 0.96,
    tackleCooldown: 1.4,
    interceptionRange: 9.8,
    shotPrecision: 0.94,
  },
};

interface TeamTacticalPlan {
  phase: 'attack' | 'defend' | 'loose';
  defensiveLineZ: number;
  presserId: string | null;
  coverId: string | null;
  counterTimer: number;
  markAssignments: Map<string, string>;
}

interface MatchActor {
  id: string;
  team: TeamSide;
  role: PlayerRole;
  tacticalRole: TacticalRole;
  formationRole: FormationRole;
  zoneMinX: number;
  zoneMaxX: number;
  zoneMinZ: number;
  zoneMaxZ: number;
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotY: number;
  stamina: number;
  diveState: 'none' | 'jump' | 'left' | 'right' | 'forward';
  diveTimer: number;
  diveDirX: number;
  diveDirY: number;
  vy: number;
  tackleTimer: number;
  standTackleTimer: number;
  kickAnimTimer: number;
  stridePhase: number;
  aiThinkTimer: number;
  aiStrafeDir: number;
  aiStrafeTimer: number;
  aiTackleCooldown: number;
  aiActionCooldown: number;
  aiCarryTimer: number;
  aiSprintTimer: number;
  aiSprintCooldown: number;
  aiTargetPos: THREE.Vector3;
  jerseyText: string;
  jerseyNumber: number;
  skinTone: string;
  hairColor: string;
  hairStyle: AvatarConfig['hairStyle'];
  bootColor: string;
  controlledByClientId: string | null;
  rig: PlayerRig;
}

interface BurstParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onHudUpdate: (hud: MatchHudState) => void;
  onFullTime: (recap: MatchRecapData) => void;
  onDrawAtFullTime?: (info: {
    homeScore: number;
    awayScore: number;
    extraTimeCount: number;
  }) => void;
  onPauseRequested: () => void;
  onReplayUpdate?: (replay: ReplayPlaybackState | null) => void;
  onLanSnapshotEmit?: (snapshot: SyncedMatchSnapshot) => void;
  onLanClientInputEmit?: (input: ClientMatchInput) => void;
}

function colorsTooClose(hexA: string, hexB: string): boolean {
  const c1 = new THREE.Color(hexA);
  const c2 = new THREE.Color(hexB);
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) < 0.38;
}

export class TitanicSoccerEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private maxAnisotropy = 4;
  private sharedShadowTexture: THREE.Texture;

  private frameId = 0;
  private disposed = false;
  private paused = false;

  // Lighting
  private keyLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private rimLight!: THREE.DirectionalLight;

  // Current scene mode
  private mode: 'showcase' | 'match' | 'replay' = 'showcase';
  private showcaseGroup: THREE.Group | null = null;
  private showcaseRig: PlayerRig | null = null;
  private showcaseSpinAngle = 0;
  private showcaseUserYaw = 0;
  private showcaseSpinVel = 0;
  private showcaseTargetYaw: number | null = null;
  private showcaseDragPointerId: number | null = null;
  private showcaseDragLastX = 0;
  private showcaseShowBack = false;
  private showcaseDisposables: { dispose: () => void }[] = [];

  private matchGroup: THREE.Group | null = null;
  private matchDisposables: { dispose: () => void }[] = [];
  private stadiumControls: {
    setCrowdDensity: (quality: GraphicsQuality) => void;
    updateCrowdAnimation: (elapsedTime: number, excitement: number) => void;
    triggerGoalNetImpact: (
      zSign: -1 | 1,
      worldX: number,
      worldY: number,
      intensity: number,
    ) => void;
    updateGoalNets: (dt: number) => void;
    resetGoalNets: () => void;
  } | null = null;
  private graphicsQuality: GraphicsQuality = 'medium';
  private crowdExcitement = 0.22;
  private crowdBoostTimer = 0;
  private halftimeWhistlePlayed = false;
  private actors: MatchActor[] = [];
  private ballPos = new THREE.Vector3(0, 0.24, 0);
  private ballVel = new THREE.Vector3(0, 0, 0);
  private ballOwnerId: string | null = null;
  private lastKickerId: string | null = null;
  private lastKickerGraceTimer = 0;
  private ballVisual: ReturnType<typeof createFootballMesh> | null = null;

  private fieldWidth = 54;
  private fieldLength = 82;
  private homeClub!: ClubConfig;
  private awayClub!: ClubConfig;
  private homeScore = 0;
  private awayScore = 0;
  private totalSeconds = 240;
  private timeRemainingSeconds = 240;
  private kickoffTeam: TeamSide = 'home';
  private goalResetTimer = 0;
  private goalBanner: SyncedGoalBanner | null = null;
  private cameraShake = 0;
  private lastActionHint = '';
  private actionHintTimer = 0;
  private matchEnded = false;
  private extraTimeCount = 0;
  private decidedByShootout = false;
  private shootoutAimMarker: THREE.Mesh | null = null;
  private setPieceState: {
    kind: SetPieceKind;
    team: TeamSide;
    spotX: number;
    spotZ: number;
    takerId: string;
    countdown: number;
  } | null = null;
  private preMatchState: {
    active: boolean;
    elapsed: number;
    duration: number;
    homeFormation: string;
    awayFormation: string;
    homeLineup: PreMatchLineupPlayer[];
    awayLineup: PreMatchLineupPlayer[];
  } | null = null;
  private preMatchClientMirror: PreMatchCutsceneHudState | null = null;
  private setPieceClientMirror: SetPieceHudState | null = null;
  private liveGoalReplayClientMirror: LiveGoalReplayHudState | null = null;
  private liveGoalReplayState: {
    active: boolean;
    celebrationTimer: number;
    elapsed: number;
    duration: number;
    scoringTeam: TeamSide;
    scoringClubShort: string;
    scoringColor: string;
    scorerLabel: string;
    frames: HighlightFrame[];
    clipDuration: number;
    burstFired: boolean;
  } | null = null;
  private shootoutState: {
    active: boolean;
    round: number;
    turnTeam: TeamSide;
    phase: 'aiming' | 'run_up' | 'ball_in_flight' | 'result';
    homeScore: number;
    awayScore: number;
    homeKicks: ShootoutKickResult[];
    awayKicks: ShootoutKickResult[];
    isSuddenDeath: boolean;
    shotClock: number;
    phaseTimer: number;
    runUpTimer: number;
    runUpDuration: number;
    runUpStartX: number;
    runUpStartZ: number;
    pendingTargetX: number;
    pendingTargetY: number;
    aiDelay: number;
    aiTargetX: number;
    aiTargetY: number;
    aiGkDived: boolean;
    aimX: number;
    aimY: number;
    kickerActorId: string | null;
    gkActorId: string | null;
    resultBanner: string | null;
    homeKickRotation: number;
    awayKickRotation: number;
    userPreferredRole: PlayerRole;
  } | null = null;

  // Match Highlights, Key Play Snapshots & Replay Theater
  private replayCamera = new THREE.PerspectiveCamera(44, 16 / 9, 0.2, 350);
  private snapshotCanvas: HTMLCanvasElement;
  private snapshotCtx: CanvasRenderingContext2D | null;
  private highlightBuffer: HighlightFrame[] = [];
  private highlightSampleAccum = 0;
  private matchElapsedTime = 0;
  private goalHighlights: GoalHighlight[] = [];
  private keyPlaySnapshots: KeyPlaySnapshot[] = [];
  private pendingGoalCapture: {
    highlight: GoalHighlight;
    snapshot: KeyPlaySnapshot;
    startBufferTime: number;
    goalBufferTime: number;
    tailTimer: number;
  } | null = null;
  private pendingSnapshotTasks: Array<{
    targetId: string;
    kind: 'goal' | 'snapshot';
    focusX: number;
    focusY: number;
    focusZ: number;
    camX: number;
    camY: number;
    camZ: number;
  }> = [];
  private lastTouchActor: {
    id: string;
    team: TeamSide;
    name: string;
    number: number;
    time: number;
  } | null = null;
  private prevTouchActor: {
    id: string;
    team: TeamSide;
    name: string;
    number: number;
    time: number;
  } | null = null;
  private matchStats: MatchSummaryStats = {
    homeShots: 0,
    awayShots: 0,
    homeSaves: 0,
    awaySaves: 0,
    homePasses: 0,
    awayPasses: 0,
    homeTackles: 0,
    awayTackles: 0,
  };
  private saveSnapshotCooldown = 0;
  private postSnapshotCooldown = 0;
  private shotSnapshotCooldown = 0;

  // 3D Replay Playback state
  private activeReplay: GoalHighlight | null = null;
  private replayPlaying = true;
  private replaySpeed: 0.5 | 1 | 1.5 = 1;
  private replayTime = 0;
  private replayPauseTail = 0;
  private replayCameraAngle: ReplayCameraAngle = 'broadcast';
  private replayGoalBurstFired = false;
  private replayEmitAccum = 0;

  // Networking roles for LAN Match
  private lanMode: 'offline' | 'host' | 'client' = 'offline';
  private aloneUserRole: PlayerRole = 'outfield';
  private localClientId = 'local';
  private localControlledActorId: string | null = null;
  private remoteInputs = new Map<string, ClientMatchInput>();
  private lanClientPrimaryActor = new Map<string, string>();
  private lanClientActiveActor = new Map<string, string>();
  private lanClientCoControlPool = new Map<string, string[]>();
  private lanActorToCoController = new Map<string, string>();
  private lanHasSwitchPool = false;
  private homeSecondDefTimer = 0;
  private awaySecondDefTimer = 0;
  private secondDefenderHomeClientMirror = false;
  private secondDefenderAwayClientMirror = false;
  private snapshotEmitAccum = 0;
  private clientInputEmitAccum = 0;
  private hudEmitAccum = 0;
  private snapshotTick = 0;
  private lastAppliedSnapshotTick = 0;
  private clientInputSeq = 0;
  private pendingClientEdges = {
    groundedPass: false,
    throughPass: false,
    loftOrTackle: false,
    shoot: false,
    gkJumpOrDive: false,
    gkQuickAction: undefined as ClientMatchInput['gkQuickAction'],
    standTackle: false,
    slideTackle: false,
    secondDefenderPress: false,
    switchPlayer: false,
  };
  private lanNotice: string | null = null;
  private lanNoticeTimer = 0;

  // AI Tactical State & Difficulty Scaling
  private aiDifficulty: AiDifficulty = 'pro';
  private homeTacticalPlan: TeamTacticalPlan = {
    phase: 'loose',
    defensiveLineZ: 20,
    presserId: null,
    coverId: null,
    counterTimer: 0,
    markAssignments: new Map<string, string>(),
  };
  private awayTacticalPlan: TeamTacticalPlan = {
    phase: 'loose',
    defensiveLineZ: -20,
    presserId: null,
    coverId: null,
    counterTimer: 0,
    markAssignments: new Map<string, string>(),
  };
  private _tmpThreats: MatchActor[] = [];
  private _tmpAssignedMarkers = new Set<string>();

  // Input state (separated held vs edge-triggered justPressed)
  private heldKeys = new Set<string>();
  private justPressedKeys = new Set<string>();
  private virtualAxis = { x: 0, z: 0 };
  private virtualSprint = false;
  private virtualEdgeActions = {
    groundedPass: false,
    throughPass: false,
    loftOrTackle: false,
    shoot: false,
    gkJumpOrDive: false,
    gkQuickAction: undefined as ClientMatchInput['gkQuickAction'],
    standTackle: false,
    slideTackle: false,
    secondDefenderPress: false,
  };

  // Strict Player-Locked 3rd-Person Camera state (zero ball-tracking)
  private manualOrbitYaw = 0;
  private manualOrbitPitch = 0.44;
  private smoothCameraYaw = 0;
  private smoothCameraPitch = 0.44;
  private cameraLookStick = { x: 0, y: 0 };
  private quickGlanceHeld = false;
  private activeDragPointerId: number | null = null;
  private lastDragPos = { x: 0, y: 0 };

  // Pooled particle bursts
  private particlePool: BurstParticle[] = [];
  private particleGroup = new THREE.Group();

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const rect = this.container.getBoundingClientRect();
    const initW = Math.max(320, rect.width || window.innerWidth);
    const initH = Math.max(240, rect.height || window.innerHeight);
    this.renderer.setSize(initW, initH);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy() || 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#091326');
    this.scene.fog = new THREE.FogExp2('#091326', 0.0082);

    // Mandatory procedural RoomEnvironment IBL
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(46, initW / initH, 0.2, 350);
    this.camera.position.set(0, 8, 16);

    this.sharedShadowTexture = createContactShadowTexture();

    this.snapshotCanvas = document.createElement('canvas');
    this.snapshotCanvas.width = 384;
    this.snapshotCanvas.height = 216;
    this.snapshotCtx = this.snapshotCanvas.getContext('2d');

    this.setupLighting();
    this.applyGraphicsQualityToRenderer();
    this.initParticlePool();
    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.clock.start();
    this.tick();
  }

  public setGraphicsQuality(quality: GraphicsQuality) {
    this.graphicsQuality = quality;
    this.applyGraphicsQualityToRenderer();
    this.stadiumControls?.setCrowdDensity(quality);
  }

  public getGraphicsQuality(): GraphicsQuality {
    return this.graphicsQuality;
  }

  private applyGraphicsQualityToRenderer() {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      if (this.keyLight) this.keyLight.castShadow = false;
      return;
    }

    const deviceDpr = window.devicePixelRatio || 1;
    const targetDpr =
      this.graphicsQuality === 'low'
        ? 1
        : this.graphicsQuality === 'medium'
          ? Math.min(deviceDpr, 1.5)
          : Math.min(deviceDpr, 2);
    this.renderer.setPixelRatio(targetDpr);

    const shadowsOn = this.graphicsQuality !== 'low';
    this.renderer.shadowMap.enabled = shadowsOn;
    this.renderer.shadowMap.needsUpdate = true;

    if (this.keyLight) {
      this.keyLight.castShadow = shadowsOn;
      const targetSize = this.graphicsQuality === 'high' ? 2048 : 1024;
      if (this.keyLight.shadow.mapSize.width !== targetSize) {
        this.keyLight.shadow.mapSize.width = targetSize;
        this.keyLight.shadow.mapSize.height = targetSize;
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
      }
      this.keyLight.shadow.needsUpdate = true;
    }

    this.renderer.toneMappingExposure =
      this.graphicsQuality === 'low' ? 1.06 : this.graphicsQuality === 'high' ? 1.16 : 1.12;
  }

  private setupLighting() {
    this.hemiLight = new THREE.HemisphereLight(0x8bb8ff, 0x163222, 0.78);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    this.keyLight.position.set(24, 42, 22);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 130;
    const d = 48;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x60a5fa, 0.75);
    this.rimLight.position.set(-28, 22, -32);
    this.scene.add(this.rimLight);
  }

  private initParticlePool() {
    const geo = new THREE.SphereGeometry(0.08, 6, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: '#A3E635',
      roughness: 0.7,
      metalness: 0.1,
    });
    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.particleGroup.add(mesh);
      this.particlePool.push({
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.45,
      });
    }
    this.scene.add(this.particleGroup);
  }

  private spawnBurst(x: number, y: number, z: number, count = 8) {
    let spawned = 0;
    for (const p of this.particlePool) {
      if (p.life > 0) continue;
      p.life = 0.42;
      p.maxLife = 0.42;
      p.mesh.visible = true;
      p.mesh.position.set(x, Math.max(0.08, y), z);
      p.mesh.scale.setScalar(1);
      p.vel.set(
        (Math.random() - 0.5) * 6.5,
        2.4 + Math.random() * 4.2,
        (Math.random() - 0.5) * 6.5,
      );
      spawned += 1;
      if (spawned >= count) break;
    }
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handleCanvasPointerDown);
    dom.addEventListener('pointermove', this.handleCanvasPointerMove);
    dom.addEventListener('pointerup', this.handleCanvasPointerUp);
    dom.addEventListener('pointercancel', this.handleCanvasPointerUp);
  }

  private handleCanvasPointerDown = (e: PointerEvent) => {
    if (this.mode === 'showcase') {
      if (this.showcaseDragPointerId !== null) return;
      this.showcaseDragPointerId = e.pointerId;
      this.showcaseDragLastX = e.clientX;
      this.showcaseSpinVel = 0;
      this.showcaseTargetYaw = null;
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore if capture unavailable
      }
      return;
    }

    if (this.mode !== 'match' || this.paused) return;
    if (this.activeDragPointerId !== null) return;

    // Shooter-style free touch-drag camera look across the right half of the screen
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width * 0.5) return;

    this.activeDragPointerId = e.pointerId;
    this.lastDragPos.x = e.clientX;
    this.lastDragPos.y = e.clientY;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unavailable
    }
  };

  private handleCanvasPointerMove = (e: PointerEvent) => {
    if (this.mode === 'showcase') {
      if (this.showcaseDragPointerId !== e.pointerId) return;
      const dx = e.clientX - this.showcaseDragLastX;
      this.showcaseDragLastX = e.clientX;
      const deltaYaw = dx * 0.0115;
      this.showcaseUserYaw += deltaYaw;
      this.showcaseSpinVel = THREE.MathUtils.clamp(deltaYaw * 48, -9, 9);
      return;
    }

    if (this.mode !== 'match' || this.paused) return;
    if (this.activeDragPointerId !== e.pointerId) return;
    const dx = e.clientX - this.lastDragPos.x;
    const dy = e.clientY - this.lastDragPos.y;
    this.lastDragPos.x = e.clientX;
    this.lastDragPos.y = e.clientY;

    this.manualOrbitYaw -= dx * 0.0072;
    this.manualOrbitPitch = THREE.MathUtils.clamp(
      this.manualOrbitPitch + dy * 0.0048,
      0.22,
      0.86,
    );
  };

  private handleCanvasPointerUp = (e: PointerEvent) => {
    if (this.showcaseDragPointerId === e.pointerId) {
      this.showcaseDragPointerId = null;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    if (this.activeDragPointerId !== e.pointerId) return;
    this.activeDragPointerId = null;
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  private handleResize = () => {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(320, rect.width || window.innerWidth);
    const h = Math.max(240, rect.height || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      return;
    }

    if (
      e.code.startsWith('Arrow') ||
      e.code === 'Space' ||
      e.code === 'Tab'
    ) {
      if (this.mode === 'match') e.preventDefault();
    }

    if (!this.heldKeys.has(e.code)) {
      this.justPressedKeys.add(e.code);
    }
    this.heldKeys.add(e.code);

    if (e.code === 'Escape' && !this.matchEnded && this.mode === 'match') {
      this.callbacks.onPauseRequested();
    } else if (e.code === 'Escape' && this.mode === 'replay') {
      this.stopHighlightReplay();
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private handleBlur = () => {
    this.heldKeys.clear();
    this.justPressedKeys.clear();
    this.virtualAxis.x = 0;
    this.virtualAxis.z = 0;
    this.virtualSprint = false;
    this.cameraLookStick.x = 0;
    this.cameraLookStick.y = 0;
    this.quickGlanceHeld = false;
    this.activeDragPointerId = null;
  };

  // Virtual Mobile D-Pad & Action Buttons API
  public setVirtualAxis(x: number, z: number) {
    this.virtualAxis.x = THREE.MathUtils.clamp(x, -1, 1);
    this.virtualAxis.z = THREE.MathUtils.clamp(z, -1, 1);
  }

  public setVirtualSprint(active: boolean) {
    this.virtualSprint = active;
  }

  public triggerVirtualAction(
    action:
      | 'groundedPass'
      | 'throughPass'
      | 'loftOrTackle'
      | 'shoot'
      | 'gkJumpOrDive'
      | 'gkJump'
      | 'standTackle'
      | 'slideTackle'
      | 'secondDefenderPress',
  ) {
    if (action === 'gkJump') this.virtualEdgeActions.gkQuickAction = 'jump';
    else this.virtualEdgeActions[action] = true;
  }

  // Player-Locked 3rd-Person Camera Controls (Right-Stick / Touch-Drag / Quick Glance)
  public setCameraLookStick(x: number, y: number) {
    this.cameraLookStick.x = THREE.MathUtils.clamp(x, -1, 1);
    this.cameraLookStick.y = THREE.MathUtils.clamp(y, -1, 1);
  }

  public setQuickGlance(active: boolean) {
    this.quickGlanceHeld = active;
  }

  public resetCameraOrbit() {
    this.manualOrbitYaw = 0;
    this.manualOrbitPitch = 0.44;
  }

  public setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.handleBlur();
    }
  }

  public toggleShowcaseBackView() {
    this.showcaseShowBack = !this.showcaseShowBack;
    this.showcaseSpinVel = 0;
    const twoPi = Math.PI * 2;
    const baseTurn = Math.round(this.showcaseUserYaw / twoPi) * twoPi;
    this.showcaseTargetYaw = this.showcaseShowBack ? baseTurn + Math.PI : baseTurn;
  }

  private canSwitchTeamPlayers(): boolean {
    if (
      this.mode !== 'match' ||
      this.aloneUserRole !== 'outfield' ||
      this.preMatchState?.active ||
      this.preMatchClientMirror?.active ||
      this.shootoutState?.active ||
      this.liveGoalReplayState?.active ||
      this.liveGoalReplayClientMirror?.active
    ) {
      return false;
    }
    if (this.lanMode === 'offline') return true;
    return this.lanHasSwitchPool;
  }

  private isHumanControlledActor(actor: MatchActor): boolean {
    if (this.lanMode === 'offline') {
      return actor.id === this.localControlledActorId;
    }
    return actor.controlledByClientId !== null;
  }

  public switchActivePlayer() {
    if (!this.canSwitchTeamPlayers()) return;
    if (this.lanMode === 'client') {
      this.pendingClientEdges.switchPlayer = true;
      return;
    }
    if (this.lanMode === 'host') {
      this.cycleLanClientActor(this.localClientId);
      this.emitLanSnapshot();
      this.emitHud();
      return;
    }

    const current = this.actors.find((a) => a.id === this.localControlledActorId);
    if (!current || current.role !== 'outfield') return;

    const candidates = this.actors.filter(
      (a) => a.team === current.team && a.role === 'outfield' && a.id !== current.id,
    );
    if (candidates.length === 0) return;

    // During a set-piece for the user's team, prioritize switching to the set-piece taker
    if (this.setPieceState && this.setPieceState.team === current.team) {
      const taker = candidates.find((c) => c.id === this.setPieceState?.takerId);
      if (taker) {
        this.localControlledActorId = taker.id;
        this.emitHud();
        return;
      }
    }

    const predX = this.ballPos.x + this.ballVel.x * 0.25;
    const predZ = this.ballPos.z + this.ballVel.z * 0.25;
    candidates.sort((a, b) => {
      const da = (a.pos.x - predX) ** 2 + (a.pos.z - predZ) ** 2;
      const db = (b.pos.x - predX) ** 2 + (b.pos.z - predZ) ** 2;
      return da - db;
    });
    this.localControlledActorId = candidates[0].id;
    this.emitHud();
  }

  // ------------------------------------------------------------------
  // MATCH HIGHLIGHTS & 3D REPLAY THEATER API
  // ------------------------------------------------------------------
  public getRecapData(): MatchRecapData {
    this.finalizePendingGoalCapture();
    const totalMins = Math.round(this.totalSeconds / 60);
    const so = this.shootoutState;
    return {
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      homeShootoutScore: so ? so.homeScore : undefined,
      awayShootoutScore: so ? so.awayScore : undefined,
      decidedByShootout: this.decidedByShootout,
      homeClubName: this.homeClub?.name || 'Home Club',
      awayClubName: this.awayClub?.name || 'Away Club',
      homeClubShort: this.homeClub?.shortName || 'HOM',
      awayClubShort: this.awayClub?.shortName || 'AWY',
      homeColor: this.homeClub?.primaryColor || '#3B82F6',
      awayColor: this.awayClub?.primaryColor || '#EF4444',
      durationLabel: this.decidedByShootout
        ? `${totalMins > 0 ? `${totalMins} MIN + ` : ''}PENALTY SHOOTOUT`
        : `${totalMins} MIN MATCH`,
      highlights: [...this.goalHighlights],
      snapshots: [...this.keyPlaySnapshots],
      stats: { ...this.matchStats },
    };
  }

  public startHighlightReplay(highlightId: string) {
    const clip =
      this.goalHighlights.find((h) => h.id === highlightId) ?? this.goalHighlights[0];
    if (!clip || !this.matchGroup) return;

    this.mode = 'replay';
    this.activeReplay = clip;
    this.replayPlaying = true;
    this.replayTime = 0;
    this.replayPauseTail = 0;
    this.replayGoalBurstFired = false;
    this.replayEmitAccum = 0;

    // Seed initial frame & camera immediately so there is no single-frame jump
    this.sampleAndApplyReplayFrame(0, 0.016);
    this.snapReplayCameraToClip(clip);
    this.emitReplayState();
  }

  public stopHighlightReplay() {
    if (this.mode !== 'replay') return;
    this.mode = 'match';
    this.activeReplay = null;
    this.replayPlaying = false;
    this.callbacks.onReplayUpdate?.(null);
  }

  public setReplayPlaying(playing: boolean) {
    this.replayPlaying = playing;
    this.emitReplayState();
  }

  public setReplaySpeed(speed: 0.5 | 1 | 1.5) {
    this.replaySpeed = speed;
    this.emitReplayState();
  }

  public setReplayCameraAngle(angle: ReplayCameraAngle) {
    this.replayCameraAngle = angle;
    if (this.activeReplay) {
      this.snapReplayCameraToClip(this.activeReplay);
    }
    this.emitReplayState();
  }

  public seekReplay(timeSeconds: number) {
    if (!this.activeReplay) return;
    this.replayTime = THREE.MathUtils.clamp(timeSeconds, 0, this.activeReplay.duration);
    this.replayPauseTail = 0;
    this.replayGoalBurstFired = this.replayTime >= this.activeReplay.goalTimestamp;
    this.sampleAndApplyReplayFrame(this.replayTime, 0.016);
    this.emitReplayState();
  }

  public finishLanClientMatch() {
    if (this.mode === 'match' && !this.matchEnded) {
      this.triggerFullTime();
    }
  }

  // ------------------------------------------------------------------
  // HOME SCREEN 3D AVATAR SHOWCASE (Transparent Overlay on Dark Room PNG + 360° Drag)
  // ------------------------------------------------------------------
  public loadShowcase(profile: PlayerProfile) {
    this.clearMatch();
    this.clearShowcase();
    this.mode = 'showcase';
    this.paused = false;
    this.showcaseDragPointerId = null;
    this.showcaseSpinVel = 0;
    this.showcaseTargetYaw = null;
    soccerAudio.startMenuMusic();

    // Transparent canvas clear so the dark gradient backdrop renders seamlessly behind the 3D avatar
    this.renderer.setClearColor(0x000000, 0);
    this.scene.background = null;
    this.scene.fog = null;

    // Warm overhead + subtle golden cove rim lighting matching the dark room aesthetic
    if (this.hemiLight) {
      this.hemiLight.color.setHex(0x64748b);
      this.hemiLight.groundColor.setHex(0x05070d);
      this.hemiLight.intensity = 0.56;
    }
    if (this.keyLight) {
      this.keyLight.color.setHex(0xffe7bf);
      this.keyLight.intensity = 1.15;
      this.keyLight.position.set(4.5, 6.8, 5.2);
    }
    if (this.rimLight) {
      this.rimLight.color.setHex(0xf5c542);
      this.rimLight.intensity = 0.95;
      this.rimLight.position.set(-4.8, 4.2, -3.6);
    }

    const club = getClubById(profile.clubId);
    const group = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];

    // Subtle dark grounded pedestal disc + golden trim directly beneath avatar boots
    const padGeo = new THREE.CylinderGeometry(1.08, 1.24, 0.09, 40);
    const padMat = new THREE.MeshStandardMaterial({
      color: '#0a0f1c',
      roughness: 0.25,
      metalness: 0.82,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, 0.045, 0);
    pad.receiveShadow = true;
    group.add(pad);

    const trimGeo = new THREE.TorusGeometry(1.1, 0.024, 10, 56);
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#D4AF37',
      emissive: '#9E7B16',
      emissiveIntensity: 0.65,
      roughness: 0.28,
      metalness: 0.85,
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.set(0, 0.09, 0);
    group.add(trim);

    // Soft indirect cove fill lights (warm ceiling gold wash + cool stadium window highlight)
    const warmCoveLight = new THREE.PointLight('#f5c542', 3.2, 13, 1.8);
    warmCoveLight.position.set(1.8, 3.6, -2.4);
    const coolWallLight = new THREE.PointLight('#60a5fa', 2.4, 12, 1.8);
    coolWallLight.position.set(-2.4, 2.7, -2.2);
    group.add(warmCoveLight, coolWallLight);

    // Customized Player Rig standing on podium (y = 0.09)
    const rig = createPlayerRig({
      club,
      useAwayKit: false,
      isGoalkeeper: false,
      jerseyText: profile.jerseyText || profile.playerName,
      jerseyNumber: profile.jerseyNumber || 10,
      avatar: profile.avatar,
      floatingName: profile.playerName,
      maxAnisotropy: this.maxAnisotropy,
      shadowTexture: this.sharedShadowTexture,
    });
    rig.root.position.set(0, 0.09, 0);
    group.add(rig.root);

    // Showcase soccer ball resting beside avatar's boot
    const ball = createFootballMesh(this.maxAnisotropy, this.sharedShadowTexture);
    ball.group.position.set(0.56, 0.33, 0.32);
    ball.ballShadow.position.set(0.56, 0.102, 0.32);
    group.add(ball.group, ball.ballShadow);

    disposables.push(
      padGeo,
      padMat,
      trimGeo,
      trimMat,
      { dispose: () => warmCoveLight.dispose() },
      { dispose: () => coolWallLight.dispose() },
      ...rig.disposables,
      ...ball.disposables,
    );

    this.showcaseGroup = group;
    this.showcaseRig = rig;
    this.showcaseDisposables = disposables;
    this.scene.add(group);

    // Position camera so the avatar stands cleanly on the LEFT dark floor opening,
    // leaving open dark room wall on the RIGHT side for the custom logo & golden buttons.
    if (this.camera.fov !== 46) {
      this.camera.fov = 46;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(1.55, 1.82, 4.78);
    this.camera.lookAt(1.38, 1.22, 0);
  }

  private clearShowcase() {
    this.showcaseDragPointerId = null;
    if (this.showcaseGroup) {
      this.scene.remove(this.showcaseGroup);
      this.showcaseGroup = null;
    }
    this.showcaseRig = null;
    for (const d of this.showcaseDisposables) {
      d.dispose();
    }
    this.showcaseDisposables = [];
  }

  // ------------------------------------------------------------------
  // MATCH SETUP: ALONE VS AI
  // ------------------------------------------------------------------
  public startAloneMatch(config: AloneMatchConfig, profile: PlayerProfile) {
    this.clearShowcase();
    this.clearMatch();

    const homeClub = getClubById(config.userClubId);
    const awayClub = getClubById(config.aiClubId);
    const playersPerTeam = MATCH_SIZE_COUNTS[config.matchSize];

    this.lanMode = 'offline';
    this.aloneUserRole = config.userRole;
    this.localClientId = 'local';
    this.aiDifficulty = config.aiDifficulty || 'pro';
    this.kickoffTeam = Math.random() < 0.5 ? 'home' : 'away';

    this.initMatchArena({
      homeClub,
      awayClub,
      fieldSize: config.fieldSize,
      matchMinutes: config.matchFormat === 'penalty_shootout' ? 0 : config.matchMinutes,
      matchSize: config.matchSize,
      matchFormat: config.matchFormat || 'standard',
      userRole: config.userRole,
      humanSlots: [
        {
          clientId: 'local',
          playerName: profile.playerName,
          jerseyText: profile.jerseyText,
          jerseyNumber: profile.jerseyNumber,
          avatar: profile.avatar,
          isHost: true,
          team: 'home',
          role: config.userRole,
          ready: true,
          aiControlCount: 0,
        },
      ],
      playersPerTeam,
    });
  }

  // ------------------------------------------------------------------
  // MATCH SETUP: LAN TEAM MATCH
  // ------------------------------------------------------------------
  public startLanMatch(room: LanRoomState, localClientId: string, isRejoin = false) {
    this.clearShowcase();
    this.clearMatch();

    const me = room.players.find((p) => p.clientId === localClientId);
    this.lanMode = me?.isHost ? 'host' : 'client';
    this.aloneUserRole = me?.role || 'outfield';
    this.localClientId = localClientId;
    this.aiDifficulty = 'pro';
    this.kickoffTeam = room.kickoffTeam || 'home';

    const homeClub = getClubById(room.settings.homeClubId);
    const awayClub = getClubById(room.settings.awayClubId);
    const playersPerTeam = MATCH_SIZE_COUNTS[room.settings.matchSize];
    const format: MatchFormat = room.settings.matchFormat || 'standard';

    if (me && me.role === 'outfield') {
      const teamHumanOutfield = room.players.filter(
        (p) => p.team === me.team && p.role === 'outfield',
      ).length;
      const teamAiOutfield = Math.max(0, playersPerTeam - 1 - teamHumanOutfield);
      this.lanHasSwitchPool = (me.aiControlCount ?? 0) > 0 && teamAiOutfield > 0;
    } else {
      this.lanHasSwitchPool = false;
    }

    this.initMatchArena({
      homeClub,
      awayClub,
      fieldSize: room.settings.fieldSize,
      matchMinutes: format === 'penalty_shootout' ? 0 : room.settings.matchMinutes,
      matchSize: room.settings.matchSize,
      matchFormat: format,
      userRole: me?.role || 'outfield',
      humanSlots: room.players,
      playersPerTeam,
      skipPreMatchCutscene: isRejoin,
    });
  }

  public promoteToLanHost(room: LanRoomState, localClientId: string) {
    if (this.mode !== 'match') return;
    this.lanMode = 'host';
    this.localClientId = localClientId;
    this.preMatchClientMirror = null;
    this.liveGoalReplayClientMirror = null;

    const activeClientIds = new Set(room.players.map((p) => p.clientId));
    // Release any actor previously held by disconnected clients back to AI control
    for (const actor of this.actors) {
      if (actor.controlledByClientId && !activeClientIds.has(actor.controlledByClientId)) {
        actor.controlledByClientId = null;
      }
    }
    this.remoteInputs.forEach((_inp, cid) => {
      if (!activeClientIds.has(cid)) {
        this.remoteInputs.delete(cid);
      }
    });

    this.buildLanCoControlAssignments(room.players);
    this.lanHasSwitchPool = (this.lanClientCoControlPool.get(localClientId)?.length ?? 0) > 0;
    this.lanNotice = 'HOST MIGRATED · YOU ARE NOW HOST';
    this.lanNoticeTimer = 3.5;

    this.emitLanSnapshot();
    this.emitHud();
  }

  private initMatchArena(params: {
    homeClub: ClubConfig;
    awayClub: ClubConfig;
    fieldSize: FieldSize;
    matchMinutes: number;
    matchSize: MatchSize;
    matchFormat?: MatchFormat;
    userRole?: PlayerRole;
    humanSlots: LanLobbyPlayer[];
    playersPerTeam: number;
    skipPreMatchCutscene?: boolean;
  }) {
    const {
      homeClub,
      awayClub,
      fieldSize,
      matchMinutes,
      matchFormat = 'standard',
      userRole = 'outfield',
      humanSlots,
      playersPerTeam,
      skipPreMatchCutscene = false,
    } = params;
    this.mode = 'match';
    this.paused = false;
    this.matchEnded = false;
    this.extraTimeCount = 0;
    this.decidedByShootout = false;
    this.shootoutState = null;
    this.shootoutAimMarker = null;
    this.homeClub = homeClub;
    this.awayClub = awayClub;
    this.homeScore = 0;
    this.awayScore = 0;
    this.totalSeconds = matchMinutes * 60;
    this.timeRemainingSeconds = matchMinutes * 60;
    this.goalResetTimer = 0;
    this.goalBanner = null;
    this.setPieceState = null;
    this.preMatchState = null;
    this.preMatchClientMirror = null;
    this.liveGoalReplayClientMirror = null;
    this.liveGoalReplayState = null;
    this.halftimeWhistlePlayed = false;
    this.crowdExcitement = 0.22;
    this.crowdBoostTimer = 0;
    this.homeSecondDefTimer = 0;
    this.awaySecondDefTimer = 0;
    this.secondDefenderHomeClientMirror = false;
    this.secondDefenderAwayClientMirror = false;
    this.cameraShake = 0;
    this.lastActionHint = `KICK-OFF: ${this.kickoffTeam === 'home' ? homeClub.shortName : awayClub.shortName}`;
    this.actionHintTimer = 2.6;
    this.remoteInputs.clear();
    this.lastAppliedSnapshotTick = 0;
    this.lanNotice = null;
    this.lanNoticeTimer = 0;
    this.pendingClientEdges = {
      groundedPass: false,
      throughPass: false,
      loftOrTackle: false,
      shoot: false,
      gkJumpOrDive: false,
      gkQuickAction: undefined,
      standTackle: false,
      slideTackle: false,
      secondDefenderPress: false,
      switchPlayer: false,
    };
    soccerAudio.startStadiumAmbience();

    // Restore opaque floodlit stadium sky, fog, and match lighting after dark showcase room
    this.renderer.setClearColor(0x091326, 1);
    this.scene.background = new THREE.Color('#091326');
    this.scene.fog = new THREE.FogExp2('#091326', 0.0082);
    if (this.hemiLight) {
      this.hemiLight.color.setHex(0x8bb8ff);
      this.hemiLight.groundColor.setHex(0x163222);
      this.hemiLight.intensity = 0.78;
    }
    if (this.keyLight) {
      this.keyLight.color.setHex(0xfff1dc);
      this.keyLight.intensity = 1.85;
      this.keyLight.position.set(24, 42, 22);
    }
    if (this.rimLight) {
      this.rimLight.color.setHex(0x60a5fa);
      this.rimLight.intensity = 0.75;
      this.rimLight.position.set(-28, 22, -32);
    }

    // Reset highlights, snapshots & match stats for the new match
    this.highlightBuffer = [];
    this.highlightSampleAccum = 0;
    this.matchElapsedTime = 0;
    this.goalHighlights = [];
    this.keyPlaySnapshots = [];
    this.pendingGoalCapture = null;
    this.pendingSnapshotTasks = [];
    this.lastTouchActor = null;
    this.prevTouchActor = null;
    this.matchStats = {
      homeShots: 0,
      awayShots: 0,
      homeSaves: 0,
      awaySaves: 0,
      homePasses: 0,
      awayPasses: 0,
      homeTackles: 0,
      awayTackles: 0,
    };
    this.saveSnapshotCooldown = 0;
    this.postSnapshotCooldown = 0;
    this.shotSnapshotCooldown = 0;
    this.activeReplay = null;

    const dims = FIELD_DIMENSIONS[fieldSize];
    this.fieldWidth = dims.width;
    this.fieldLength = dims.length;

    const useAwayKit = colorsTooClose(homeClub.primaryColor, awayClub.primaryColor);

    const group = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];

    const stadium = createStadiumEnvironment({
      fieldSize,
      width: dims.width,
      length: dims.length,
      homeClub,
      awayClub,
      maxAnisotropy: this.maxAnisotropy,
      graphicsQuality: this.graphicsQuality,
    });
    group.add(stadium.group);
    disposables.push(...stadium.disposables, stadium.shadowTexture);
    this.stadiumControls = {
      setCrowdDensity: stadium.setCrowdDensity,
      updateCrowdAnimation: stadium.updateCrowdAnimation,
      triggerGoalNetImpact: stadium.triggerGoalNetImpact,
      updateGoalNets: stadium.updateGoalNets,
      resetGoalNets: stadium.resetGoalNets,
    };

    const ball = createFootballMesh(this.maxAnisotropy, this.sharedShadowTexture);
    group.add(ball.group, ball.ballShadow);
    disposables.push(...ball.disposables);
    this.ballVisual = ball;

    // Build formation slots for Home (+Z defending, attacking -Z) & Away (-Z defending, attacking +Z)
    this.actors = [];
    const buildTeamActors = (team: TeamSide) => {
      const club = team === 'home' ? homeClub : awayClub;
      const isAwayKit = team === 'away' && useAwayKit;
      const teamHumans = humanSlots.filter((p) => p.team === team);
      const humanGk = teamHumans.find((p) => p.role === 'goalkeeper') ?? null;
      const humanOutfield = teamHumans.filter((p) => p.role === 'outfield');

      const slots = this.computeFormationPositions(team, playersPerTeam);

      // Slot 0 is always Goalkeeper
      const gkSlot = slots[0];
      const gkBotName = `${club.shortName}_GK`;
      const gkRig = createPlayerRig({
        club,
        useAwayKit: isAwayKit,
        isGoalkeeper: true,
        jerseyText: humanGk ? humanGk.jerseyText : gkBotName,
        jerseyNumber: humanGk ? humanGk.jerseyNumber : 1,
        avatar: humanGk ? humanGk.avatar : {
          skinTone: '#D99B72',
          hairColor: '#1B1D24',
          hairStyle: 'kante',
          bootColor: '#06B6D4',
        },
        floatingName: humanGk ? humanGk.playerName : undefined,
        maxAnisotropy: this.maxAnisotropy,
        shadowTexture: this.sharedShadowTexture,
      });
      disposables.push(...gkRig.disposables);
      group.add(gkRig.root);

      const gkActor: MatchActor = {
        id: `${team}_gk`,
        team,
        role: 'goalkeeper',
        tacticalRole: 'defender',
        formationRole: 'gk',
        zoneMinX: -11.5,
        zoneMaxX: 11.5,
        zoneMinZ: team === 'home' ? this.fieldLength / 2 - 15.5 : -this.fieldLength / 2 + 0.5,
        zoneMaxZ: team === 'home' ? this.fieldLength / 2 - 0.5 : -this.fieldLength / 2 + 15.5,
        homePos: gkSlot.clone(),
        pos: gkSlot.clone(),
        vel: new THREE.Vector3(),
        rotY: team === 'home' ? Math.PI : 0,
        stamina: 100,
        diveState: 'none',
        diveTimer: 0,
        diveDirX: 0,
        diveDirY: 0,
        vy: 0,
        tackleTimer: 0,
        standTackleTimer: 0,
        kickAnimTimer: 0,
        stridePhase: 0,
        aiThinkTimer: 0,
        aiStrafeDir: 1,
        aiStrafeTimer: 3.0,
        aiTackleCooldown: 0,
        aiActionCooldown: 0,
        aiCarryTimer: 0,
        aiSprintTimer: 0,
        aiSprintCooldown: 0,
        aiTargetPos: gkSlot.clone(),
        jerseyText: humanGk ? humanGk.jerseyText : gkBotName,
        jerseyNumber: humanGk ? humanGk.jerseyNumber : 1,
        skinTone: humanGk ? humanGk.avatar.skinTone : '#D99B72',
        hairColor: humanGk ? humanGk.avatar.hairColor : '#1B1D24',
        hairStyle: humanGk ? humanGk.avatar.hairStyle : 'kante',
        bootColor: humanGk ? humanGk.avatar.bootColor : '#06B6D4',
        controlledByClientId: humanGk ? humanGk.clientId : null,
        rig: gkRig,
      };
      this.actors.push(gkActor);

      // Outfield slots 1..(playersPerTeam - 1)
      const outfieldNumbers = [4, 6, 8, 9, 11];
      const ownZSign = team === 'home' ? 1 : -1;
      const halfW = this.fieldWidth / 2;
      const halfL = this.fieldLength / 2;
      const getSlotRoleAndZone = (slotIndex: number) => {
        let tacticalRole: TacticalRole = 'midfielder';
        let formationRole: FormationRole = 'cm';
        if (playersPerTeam <= 2) {
          tacticalRole = 'forward';
          formationRole = 'st';
        } else if (playersPerTeam === 3) {
          tacticalRole = slotIndex === 1 ? 'defender' : 'forward';
          formationRole = slotIndex === 1 ? 'cb' : 'st';
        } else if (playersPerTeam === 4) {
          tacticalRole = slotIndex === 1 ? 'defender' : slotIndex === 2 ? 'midfielder' : 'forward';
          formationRole = slotIndex === 1 ? 'cb' : slotIndex === 2 ? 'lw' : 'rw';
        } else if (playersPerTeam === 5) {
          tacticalRole = slotIndex <= 2 ? 'defender' : slotIndex === 3 ? 'midfielder' : 'forward';
          formationRole =
            slotIndex === 1 ? 'lb' : slotIndex === 2 ? 'rb' : slotIndex === 3 ? 'cm' : 'st';
        } else {
          tacticalRole = slotIndex <= 2 ? 'defender' : slotIndex <= 4 ? 'midfielder' : 'forward';
          formationRole =
            slotIndex === 1
              ? 'lb'
              : slotIndex === 2
                ? 'rb'
                : slotIndex === 3
                  ? 'lw'
                  : slotIndex === 4
                    ? 'rw'
                    : 'st';
        }

        // Define strict pitch quadrants/zones per role so out-of-possession AI holds tactical anchors
        let zMinX = -halfW + 2.5;
        let zMaxX = halfW - 2.5;
        let defDepthA = -halfL + 4.5;
        let defDepthB = halfL - 4.5;

        if (formationRole === 'lb') {
          zMinX = -halfW + 2.0;
          zMaxX = -1.2;
        } else if (formationRole === 'rb') {
          zMinX = 1.2;
          zMaxX = halfW - 2.0;
        } else if (formationRole === 'lw') {
          zMinX = -halfW + 2.0;
          zMaxX = -0.5;
        } else if (formationRole === 'rw') {
          zMinX = 0.5;
          zMaxX = halfW - 2.0;
        } else if (formationRole === 'cb') {
          zMinX = -halfW * 0.56;
          zMaxX = halfW * 0.56;
        } else if (formationRole === 'cm') {
          zMinX = -halfW * 0.48;
          zMaxX = halfW * 0.48;
        } else if (formationRole === 'st') {
          zMinX = playersPerTeam <= 2 ? -halfW + 2.2 : -halfW * 0.52;
          zMaxX = playersPerTeam <= 2 ? halfW - 2.2 : halfW * 0.52;
        }

        if (playersPerTeam <= 2) {
          defDepthA = -halfL + 4.0;
          defDepthB = halfL - 4.0;
        } else if (
          formationRole === 'st' ||
          formationRole === 'lw' ||
          formationRole === 'rw'
        ) {
          // Strikers and wingers can penetrate behind the defensive line all the way into the box
          const deepAtt =
            formationRole === 'st' ? ownZSign * 3.0 : ownZSign * (halfL * 0.28);
          const highAtt = -ownZSign * (halfL - 3.8);
          defDepthA = Math.min(deepAtt, highAtt);
          defDepthB = Math.max(deepAtt, highAtt);
        } else if (tacticalRole === 'defender') {
          // Strict defensive half anchor: own penalty box edge up to midfield line
          const deepOwn = ownZSign * (halfL - 5.0);
          const highPush = -ownZSign * 2.5;
          defDepthA = Math.min(deepOwn, highPush);
          defDepthB = Math.max(deepOwn, highPush);
        } else {
          // Central midfielder anchors middle third and supports into the edge of final third
          const deepMid = ownZSign * (halfL * 0.44);
          const highMid = -ownZSign * (halfL * 0.65);
          defDepthA = Math.min(deepMid, highMid);
          defDepthB = Math.max(deepMid, highMid);
        }

        return {
          tacticalRole,
          formationRole,
          zoneMinX: zMinX,
          zoneMaxX: zMaxX,
          zoneMinZ: defDepthA,
          zoneMaxZ: defDepthB,
        };
      };

      const aiHairPool: AvatarConfig['hairStyle'][] = [
        'ronaldo',
        'choudhury',
        'cucurella',
        'neymar',
        'mbappe',
        'haaland',
        'bellingham',
        'salah',
        'grealish',
        'vinicius',
        'beckham',
        'gullit',
        'pogba',
        'modric',
        'kante',
        'ramos',
        'garnacho',
        'zidane',
        'tactical_bun',
        'classic_crew',
      ];
      const aiSkinPool = ['#F3C6A5', '#D99B72', '#B97A57', '#6F422B'];
      const aiHairColorPool = ['#1B1D24', '#5C3824', '#D9AD4B', '#1B1D24'];

      for (let i = 1; i < playersPerTeam; i++) {
        const human = humanOutfield[i - 1] ?? null;
        const slotPos = slots[i];
        const jNum = human ? human.jerseyNumber : outfieldNumbers[(i - 1) % outfieldNumbers.length];
        const jText = human ? human.jerseyText : `${club.shortName}`;
        const roleMeta = getSlotRoleAndZone(i);
        const seedIdx = i + (team === 'away' ? 3 : 0);
        const aiAvatar: AvatarConfig = {
          skinTone: aiSkinPool[seedIdx % aiSkinPool.length],
          hairColor: aiHairColorPool[(seedIdx + 1) % aiHairColorPool.length],
          hairStyle: aiHairPool[seedIdx % aiHairPool.length],
          bootColor: club.accentColor,
        };
        const resolvedAvatar = human ? human.avatar : aiAvatar;

        const rig = createPlayerRig({
          club,
          useAwayKit: isAwayKit,
          isGoalkeeper: false,
          jerseyText: jText,
          jerseyNumber: jNum,
          avatar: resolvedAvatar,
          floatingName: human ? human.playerName : undefined,
          maxAnisotropy: this.maxAnisotropy,
          shadowTexture: this.sharedShadowTexture,
        });
        disposables.push(...rig.disposables);
        group.add(rig.root);

        this.actors.push({
          id: `${team}_out_${i}`,
          team,
          role: 'outfield',
          tacticalRole: roleMeta.tacticalRole,
          formationRole: roleMeta.formationRole,
          zoneMinX: roleMeta.zoneMinX,
          zoneMaxX: roleMeta.zoneMaxX,
          zoneMinZ: roleMeta.zoneMinZ,
          zoneMaxZ: roleMeta.zoneMaxZ,
          homePos: slotPos.clone(),
          pos: slotPos.clone(),
          vel: new THREE.Vector3(),
          rotY: team === 'home' ? Math.PI : 0,
          stamina: 100,
          diveState: 'none',
          diveTimer: 0,
          diveDirX: 0,
          diveDirY: 0,
          vy: 0,
          tackleTimer: 0,
          standTackleTimer: 0,
          kickAnimTimer: 0,
          stridePhase: 0,
          aiThinkTimer: i * 0.05,
          aiStrafeDir: i % 2 === 0 ? 1 : -1,
          aiStrafeTimer: 2.6 + i * 0.45,
          aiTackleCooldown: 0.4,
          aiActionCooldown: 0.2,
          aiCarryTimer: 0,
          aiSprintTimer: 0,
          aiSprintCooldown: 0,
          aiTargetPos: slotPos.clone(),
          jerseyText: jText,
          jerseyNumber: jNum,
          skinTone: resolvedAvatar.skinTone,
          hairColor: resolvedAvatar.hairColor,
          hairStyle: resolvedAvatar.hairStyle,
          bootColor: resolvedAvatar.bootColor,
          controlledByClientId: human ? human.clientId : null,
          rig,
        });
      }
    };

    buildTeamActors('home');
    buildTeamActors('away');

    // Strictly lock local camera & control onto the local player instance
    const localActor = this.actors.find((a) => a.controlledByClientId === this.localClientId);
    this.localControlledActorId = localActor ? localActor.id : 'home_out_1';
    this.buildLanCoControlAssignments(humanSlots);

    const aimGeo = new THREE.RingGeometry(0.32, 0.46, 24);
    const aimMat = new THREE.MeshBasicMaterial({
      color: '#34D399',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const aimMarker = new THREE.Mesh(aimGeo, aimMat);
    aimMarker.visible = false;
    aimMarker.renderOrder = 20;
    group.add(aimMarker);
    disposables.push(aimGeo, aimMat);
    this.shootoutAimMarker = aimMarker;

    this.matchGroup = group;
    this.matchDisposables = disposables;
    this.scene.add(group);

    this.resetPositionsForKickoff(this.kickoffTeam);

    // Initialize Player-Locked 3rd-Person Camera strictly behind the local controlled player
    if (this.camera.fov !== 46) {
      this.camera.fov = 46;
      this.camera.updateProjectionMatrix();
    }
    const active = this.actors.find((a) => a.id === this.localControlledActorId) ?? this.actors[0];
    this.manualOrbitYaw = 0;
    this.manualOrbitPitch = 0.44;
    this.quickGlanceHeld = false;
    if (active) {
      const baseYaw = active.team === 'home' ? 0 : Math.PI;
      this.smoothCameraYaw = baseYaw;
      this.smoothCameraPitch = this.manualOrbitPitch;
      const dist = active.role === 'goalkeeper' ? 11.5 : 14.2;
      const horiz = dist * Math.cos(this.smoothCameraPitch);
      this.camera.position.set(
        active.pos.x + horiz * Math.sin(this.smoothCameraYaw),
        active.pos.y + 1.45 + dist * Math.sin(this.smoothCameraPitch),
        active.pos.z + horiz * Math.cos(this.smoothCameraYaw),
      );
      this.camera.lookAt(active.pos.x, active.pos.y + 1.45, active.pos.z);
    }

    if (matchFormat === 'penalty_shootout') {
      this.startPenaltyShootout(userRole);
    } else if (!skipPreMatchCutscene && this.lanMode !== 'client') {
      this.startPreMatchCutscene(humanSlots, playersPerTeam);
      if (this.lanMode === 'host') {
        this.emitLanSnapshot();
      }
    } else {
      soccerAudio.playWhistle('kickoff');
      this.emitHud();
    }
  }

  private computeFormationPositions(team: TeamSide, count: number): THREE.Vector3[] {
    const zSign = team === 'home' ? 1 : -1;
    const halfL = this.fieldLength / 2;
    const halfW = this.fieldWidth / 2;
    const positions: THREE.Vector3[] = [];

    // GK right in front of goal line
    positions.push(new THREE.Vector3(0, 0, zSign * (halfL - 2.4)));

    if (count <= 2) {
      positions.push(new THREE.Vector3(0, 0, zSign * halfL * 0.24));
    } else if (count === 3) {
      positions.push(new THREE.Vector3(-halfW * 0.28, 0, zSign * halfL * 0.44));
      positions.push(new THREE.Vector3(halfW * 0.24, 0, zSign * halfL * 0.16));
    } else if (count === 4) {
      positions.push(new THREE.Vector3(0, 0, zSign * halfL * 0.52));
      positions.push(new THREE.Vector3(-halfW * 0.36, 0, zSign * halfL * 0.26));
      positions.push(new THREE.Vector3(halfW * 0.36, 0, zSign * halfL * 0.2));
    } else if (count === 5) {
      positions.push(new THREE.Vector3(-halfW * 0.3, 0, zSign * halfL * 0.52));
      positions.push(new THREE.Vector3(halfW * 0.3, 0, zSign * halfL * 0.52));
      positions.push(new THREE.Vector3(0, 0, zSign * halfL * 0.3));
      positions.push(new THREE.Vector3(0, 0, zSign * halfL * 0.12));
    } else {
      positions.push(new THREE.Vector3(-halfW * 0.32, 0, zSign * halfL * 0.55));
      positions.push(new THREE.Vector3(halfW * 0.32, 0, zSign * halfL * 0.55));
      positions.push(new THREE.Vector3(-halfW * 0.36, 0, zSign * halfL * 0.28));
      positions.push(new THREE.Vector3(halfW * 0.36, 0, zSign * halfL * 0.28));
      positions.push(new THREE.Vector3(0, 0, zSign * halfL * 0.12));
    }
    return positions;
  }

  private resetPositionsForKickoff(kickoffTeam: TeamSide) {
    this.ballPos.set(0, 0.24, 0);
    this.ballVel.set(0, 0, 0);
    this.ballOwnerId = null;
    this.homeTacticalPlan.counterTimer = 0;
    this.awayTacticalPlan.counterTimer = 0;
    this.homeSecondDefTimer = 0;
    this.awaySecondDefTimer = 0;
    this.stadiumControls?.resetGoalNets();

    for (const actor of this.actors) {
      actor.pos.copy(actor.homePos);
      // Place kickoff striker near center spot
      if (actor.team === kickoffTeam && actor.id.endsWith(`_out_${this.actors.filter((a) => a.team === kickoffTeam && a.role === 'outfield').length}`)) {
        actor.pos.set(0, 0, kickoffTeam === 'home' ? 1.4 : -1.4);
      }
      actor.vel.set(0, 0, 0);
      actor.vy = 0;
      actor.diveState = 'none';
      actor.diveTimer = 0;
      actor.diveDirX = 0;
      actor.diveDirY = 0;
      actor.tackleTimer = 0;
      actor.standTackleTimer = 0;
      actor.aiThinkTimer = Math.random() * 0.14;
      actor.aiStrafeDir = Math.random() < 0.5 ? -1 : 1;
      actor.aiStrafeTimer = 2.6 + Math.random() * 1.4;
      actor.aiTackleCooldown = 0.45;
      actor.aiActionCooldown = 0.2;
      actor.aiCarryTimer = 0;
      actor.aiSprintTimer = 0;
      actor.aiSprintCooldown = 0;
      actor.aiTargetPos.copy(actor.pos);
      actor.rotY = actor.team === 'home' ? Math.PI : 0;
      actor.rig.root.position.copy(actor.pos);
      actor.rig.root.rotation.y = actor.rotY;
    }
  }

  private clearMatch() {
    if (this.matchGroup) {
      this.scene.remove(this.matchGroup);
      this.matchGroup = null;
    }
    this.stadiumControls = null;
    this.setPieceState = null;
    this.setPieceClientMirror = null;
    this.preMatchState = null;
    this.preMatchClientMirror = null;
    this.liveGoalReplayClientMirror = null;
    this.liveGoalReplayState = null;
    this.actors = [];
    this.ballVisual = null;
    this.highlightBuffer = [];
    this.goalHighlights = [];
    this.keyPlaySnapshots = [];
    this.pendingGoalCapture = null;
    this.pendingSnapshotTasks = [];
    this.activeReplay = null;
    this.lanClientPrimaryActor.clear();
    this.lanClientActiveActor.clear();
    this.lanClientCoControlPool.clear();
    this.lanActorToCoController.clear();
    this.lanHasSwitchPool = false;
    this.callbacks.onReplayUpdate?.(null);
    for (const d of this.matchDisposables) {
      d.dispose();
    }
    this.matchDisposables = [];
  }

  public skipLiveGoalReplay() {
    if (this.lanMode === 'client') return;
    if (!this.liveGoalReplayState && this.goalResetTimer <= 0) return;
    this.liveGoalReplayState = null;
    this.goalResetTimer = 0;
    this.goalBanner = null;
    this.resetPositionsForKickoff(this.kickoffTeam);
    soccerAudio.playWhistle('kickoff');
    if (this.lanMode === 'host') {
      this.emitLanSnapshot();
    }
    this.emitHud();
  }

  // ------------------------------------------------------------------
  // LAN AI CO-CONTROL ASSIGNMENT & DYNAMIC POSSESSION SWITCHING
  // ------------------------------------------------------------------
  private buildLanCoControlAssignments(humanSlots: LanLobbyPlayer[]) {
    this.lanClientPrimaryActor.clear();
    this.lanClientActiveActor.clear();
    this.lanClientCoControlPool.clear();
    this.lanActorToCoController.clear();

    if (this.lanMode === 'offline') return;

    // Map each currently human-controlled actor to its primary clientId
    for (const actor of this.actors) {
      if (actor.controlledByClientId) {
        this.lanClientPrimaryActor.set(actor.controlledByClientId, actor.id);
        this.lanClientActiveActor.set(actor.controlledByClientId, actor.id);
      }
    }

    // Partition each team's remaining AI outfielders cleanly across human outfielders by aiControlCount
    for (const team of ['home', 'away'] as TeamSide[]) {
      const teamHumanOutfield = humanSlots.filter((p) => p.team === team && p.role === 'outfield');
      const teamAiOutfield = this.actors.filter(
        (a) => a.team === team && a.role === 'outfield' && a.controlledByClientId === null,
      );
      if (teamHumanOutfield.length === 0 || teamAiOutfield.length === 0) continue;

      let aiCursor = 0;
      for (const h of teamHumanOutfield) {
        const limit = Math.max(0, Math.min(teamAiOutfield.length - aiCursor, h.aiControlCount ?? 1));
        const pool: string[] = [];
        for (let k = 0; k < limit && aiCursor < teamAiOutfield.length; k++) {
          const aiActor = teamAiOutfield[aiCursor++];
          pool.push(aiActor.id);
          this.lanActorToCoController.set(aiActor.id, h.clientId);
        }
        this.lanClientCoControlPool.set(h.clientId, pool);
      }
    }
  }

  private cycleLanClientActor(clientId: string) {
    if (this.lanMode !== 'host') return;
    if (this.shootoutState?.active || this.preMatchState?.active) return;

    const primaryId = this.lanClientPrimaryActor.get(clientId);
    const activeId = this.lanClientActiveActor.get(clientId);
    const pool = this.lanClientCoControlPool.get(clientId) ?? [];
    if (!primaryId || pool.length === 0) return;

    const allowedIds = [primaryId, ...pool].filter((id) => id !== activeId);
    const candidates = this.actors.filter(
      (a) =>
        allowedIds.includes(a.id) &&
        a.role === 'outfield' &&
        (a.controlledByClientId === null || a.controlledByClientId === clientId),
    );
    if (candidates.length === 0) return;

    let nextActor: MatchActor | undefined;
    if (this.setPieceState) {
      const activeActor = activeId ? this.actors.find((a) => a.id === activeId) : null;
      if (activeActor && this.setPieceState.team === activeActor.team) {
        nextActor = candidates.find((c) => c.id === this.setPieceState?.takerId);
      }
    }
    if (!nextActor) {
      const predX = this.ballPos.x + this.ballVel.x * 0.25;
      const predZ = this.ballPos.z + this.ballVel.z * 0.25;
      candidates.sort(
        (a, b) =>
          (a.pos.x - predX) ** 2 +
          (a.pos.z - predZ) ** 2 -
          ((b.pos.x - predX) ** 2 + (b.pos.z - predZ) ** 2),
      );
      nextActor = candidates[0];
    }

    const prevActor = activeId ? this.actors.find((a) => a.id === activeId) : null;
    if (prevActor && prevActor.controlledByClientId === clientId) {
      prevActor.controlledByClientId = null;
    }

    nextActor.controlledByClientId = clientId;
    this.lanClientActiveActor.set(clientId, nextActor.id);
    if (clientId === this.localClientId) {
      this.localControlledActorId = nextActor.id;
    }
  }

  // ------------------------------------------------------------------
  // PRE-MATCH BROADCAST CUTSCENE (4-Scene Tunnel Walkout -> Line-Up -> Warm-Up -> Tactical Board)
  // ------------------------------------------------------------------
  private formatTeamFormationLabel(count: number): string {
    if (count <= 2) return '1-1';
    if (count === 3) return '1-1-1';
    if (count === 4) return '1-1-2';
    if (count === 5) return '1-2-1';
    return '1-2-2';
  }

  private buildTeamLineup(team: TeamSide, humanSlots: LanLobbyPlayer[]): PreMatchLineupPlayer[] {
    const teamActors = this.actors.filter((a) => a.team === team);
    return teamActors.map((a) => {
      const slot = a.controlledByClientId
        ? humanSlots.find((h) => h.clientId === a.controlledByClientId)
        : undefined;
      return {
        id: a.id,
        name: slot?.playerName || a.jerseyText || (a.role === 'goalkeeper' ? 'GK' : 'PLAYER'),
        number: a.jerseyNumber,
        roleLabel: a.formationRole.toUpperCase(),
        isHuman: Boolean(slot),
        controllerName: slot?.playerName,
      };
    });
  }

  private startPreMatchCutscene(humanSlots: LanLobbyPlayer[], playersPerTeam: number) {
    const homeLineup = this.buildTeamLineup('home', humanSlots);
    const awayLineup = this.buildTeamLineup('away', humanSlots);
    this.preMatchState = {
      active: true,
      elapsed: 0,
      duration: 14.5,
      homeFormation: this.formatTeamFormationLabel(playersPerTeam),
      awayFormation: this.formatTeamFormationLabel(playersPerTeam),
      homeLineup,
      awayLineup,
    };
    this.ballPos.set(0, 0.24, 0);
    this.ballVel.set(0, 0, 0);
    this.ballOwnerId = null;

    // Position teams at the West sideline tunnel in two columns
    const homeActors = this.actors.filter((a) => a.team === 'home');
    const awayActors = this.actors.filter((a) => a.team === 'away');
    const tunnelX = -this.fieldWidth / 2 - 1.4;
    homeActors.forEach((a, idx) => {
      a.pos.set(tunnelX - idx * 1.45, 0, 1.35);
      a.vel.set(0, 0, 0);
      a.rotY = Math.PI / 2;
      a.rig.root.position.copy(a.pos);
      a.rig.root.rotation.y = a.rotY;
    });
    awayActors.forEach((a, idx) => {
      a.pos.set(tunnelX - idx * 1.45, 0, -1.35);
      a.vel.set(0, 0, 0);
      a.rotY = Math.PI / 2;
      a.rig.root.position.copy(a.pos);
      a.rig.root.rotation.y = a.rotY;
    });

    this.crowdExcitement = 0.62;
    this.emitHud();
  }

  public skipPreMatchCutscene() {
    if (!this.preMatchState?.active && !this.preMatchClientMirror?.active) return;
    if (this.lanMode === 'client') {
      // Client forwards skip request to host via server
      return;
    }
    this.finishPreMatchCutscene();
  }

  private finishPreMatchCutscene() {
    this.preMatchState = null;
    this.preMatchClientMirror = null;
    this.resetPositionsForKickoff(this.kickoffTeam);
    this.crowdExcitement = 0.28;
    soccerAudio.playWhistle('kickoff');
    if (this.lanMode === 'host') {
      this.emitLanSnapshot();
    }
    this.emitHud();
  }

  private updatePreMatchCutscene(dt: number) {
    const pm = this.preMatchState;
    if (!pm) return;
    pm.elapsed += dt;

    if (pm.elapsed >= pm.duration) {
      this.finishPreMatchCutscene();
      return;
    }

    const homeActors = this.actors.filter((a) => a.team === 'home');
    const awayActors = this.actors.filter((a) => a.team === 'away');
    const tunnelX = -this.fieldWidth / 2 - 1.4;

    if (pm.elapsed < 3.2) {
      // Scene 1: Tunnel Walkout toward midfield center circle
      const p = THREE.MathUtils.clamp(pm.elapsed / 3.2, 0, 1);
      const ease = p * p * (3 - 2 * p);
      const stepTeam = (list: MatchActor[], zLine: number) => {
        list.forEach((a, idx) => {
          const startX = tunnelX - idx * 1.45;
          const endX = -2.0 - idx * 1.35;
          const tx = THREE.MathUtils.lerp(startX, endX, ease);
          const vx = (tx - a.pos.x) / Math.max(0.016, dt);
          a.vel.set(vx, 0, 0);
          a.pos.set(tx, 0, zLine);
          a.rotY = Math.PI / 2;
        });
      };
      stepTeam(homeActors, 1.35);
      stepTeam(awayActors, -1.35);
    } else if (pm.elapsed < 6.2) {
      // Scene 2: UEFA-style side-by-side Line-Up facing main broadcast stand
      const stepLineup = (list: MatchActor[], xOffset: number) => {
        const spacing = 1.32;
        list.forEach((a, idx) => {
          const tx = xOffset + (idx - (list.length - 1) / 2) * spacing;
          const tz = 1.6;
          const dx = tx - a.pos.x;
          const dz = tz - a.pos.z;
          a.pos.x = THREE.MathUtils.damp(a.pos.x, tx, 6.5, dt);
          a.pos.z = THREE.MathUtils.damp(a.pos.z, tz, 6.5, dt);
          const dist = Math.hypot(dx, dz);
          a.vel.set(dist > 0.14 ? dx * 3.2 : 0, 0, dist > 0.14 ? dz * 3.2 : 0);
          a.rotY = this.dampAngle(a.rotY, 0, 8, dt);
        });
      };
      stepLineup(homeActors, -Math.max(4.5, homeActors.length * 0.78));
      stepLineup(awayActors, Math.max(4.5, awayActors.length * 0.78));
    } else if (pm.elapsed < 8.8) {
      // Scene 3: Formation Jog & Warm-Up bounces
      const moveToKickoff = (list: MatchActor[], team: TeamSide) => {
        const outfieldCount = list.filter((x) => x.role === 'outfield').length;
        list.forEach((a) => {
          let tx = a.homePos.x;
          let tz = a.homePos.z;
          if (team === this.kickoffTeam && a.id.endsWith(`_out_${outfieldCount}`)) {
            tx = 0;
            tz = team === 'home' ? 1.4 : -1.4;
          }
          const dx = tx - a.pos.x;
          const dz = tz - a.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.25) {
            const spd = Math.min(7.8, d * 2.6);
            a.vel.set((dx / d) * spd, 0, (dz / d) * spd);
            a.pos.x += a.vel.x * dt;
            a.pos.z += a.vel.z * dt;
            a.rotY = this.dampAngle(a.rotY, Math.atan2(dx, dz), 10, dt);
          } else {
            a.vel.set(0, 0, 0);
            a.pos.x = tx;
            a.pos.z = tz;
            a.pos.y = Math.abs(Math.sin(pm.elapsed * 8.5 + a.jerseyNumber)) * 0.14;
            a.rotY = this.dampAngle(a.rotY, team === 'home' ? Math.PI : 0, 10, dt);
          }
        });
      };
      moveToKickoff(homeActors, 'home');
      moveToKickoff(awayActors, 'away');
    } else {
      // Scene 4: Settled in kickoff formation during Tactical Line-Up Broadcast Overlay
      const settle = (list: MatchActor[], team: TeamSide) => {
        const outfieldCount = list.filter((x) => x.role === 'outfield').length;
        list.forEach((a) => {
          let tx = a.homePos.x;
          let tz = a.homePos.z;
          if (team === this.kickoffTeam && a.id.endsWith(`_out_${outfieldCount}`)) {
            tx = 0;
            tz = team === 'home' ? 1.4 : -1.4;
          }
          a.pos.x = THREE.MathUtils.damp(a.pos.x, tx, 10, dt);
          a.pos.y = THREE.MathUtils.damp(a.pos.y, 0, 12, dt);
          a.pos.z = THREE.MathUtils.damp(a.pos.z, tz, 10, dt);
          a.vel.set(0, 0, 0);
          a.rotY = this.dampAngle(a.rotY, team === 'home' ? Math.PI : 0, 10, dt);
        });
      };
      settle(homeActors, 'home');
      settle(awayActors, 'away');
    }

    this.animateAllActorRigs(dt);
    this.syncBallVisual(dt);
    this.updateCrowdExcitementAndMesh(dt);

    if (this.lanMode === 'host') {
      this.snapshotEmitAccum += dt;
      if (this.snapshotEmitAccum >= 0.05) {
        this.snapshotEmitAccum = 0;
        this.emitLanSnapshot();
      }
    }
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private buildPreMatchHudState(): PreMatchCutsceneHudState | null {
    if (this.lanMode === 'client') {
      return this.preMatchClientMirror;
    }
    const pm = this.preMatchState;
    if (!pm || !pm.active) return null;

    let scene: 1 | 2 | 3 | 4 = 1;
    let sceneLabel = 'STADIUM TUNNEL WALKOUT';
    let showLineupOverlay = false;
    if (pm.elapsed >= 8.8) {
      scene = 4;
      sceneLabel = 'STARTING LINE-UPS & FORMATIONS';
      showLineupOverlay = true;
    } else if (pm.elapsed >= 6.2) {
      scene = 3;
      sceneLabel = 'TAKING POSITIONS & WARM-UP';
    } else if (pm.elapsed >= 3.2) {
      scene = 2;
      sceneLabel = 'TEAMS ON THE PITCH';
    }

    return {
      active: true,
      scene,
      sceneLabel,
      showLineupOverlay,
      countdownSeconds: Math.max(1, Math.ceil(pm.duration - pm.elapsed)),
      canSkip: true,
      homeClubName: this.homeClub?.name || 'Home Club',
      awayClubName: this.awayClub?.name || 'Away Club',
      homeColor: this.homeClub?.primaryColor || '#3B82F6',
      awayColor: this.awayClub?.primaryColor || '#EF4444',
      homeFormation: pm.homeFormation,
      awayFormation: pm.awayFormation,
      homeLineup: pm.homeLineup,
      awayLineup: pm.awayLineup,
    };
  }

  // ------------------------------------------------------------------
  // LAN NETWORK SYNC HOOKS
  // ------------------------------------------------------------------
  public applyRemoteClientInput(clientId: string, input: ClientMatchInput) {
    const prev = this.remoteInputs.get(clientId);
    // Preserve unconsumed edge triggers if multiple network packets arrive before next sim frame
    this.remoteInputs.set(clientId, {
      seq: input.seq,
      moveX: input.moveX,
      moveZ: input.moveZ,
      sprint: input.sprint,
      groundedPass: Boolean(prev?.groundedPass || input.groundedPass),
      throughPass: Boolean(prev?.throughPass || input.throughPass),
      loftOrTackle: Boolean(prev?.loftOrTackle || input.loftOrTackle),
      shoot: Boolean(prev?.shoot || input.shoot),
      gkJumpOrDive: Boolean(prev?.gkJumpOrDive || input.gkJumpOrDive),
      gkQuickAction: input.gkQuickAction || prev?.gkQuickAction,
      standTackle: Boolean(prev?.standTackle || input.standTackle),
      slideTackle: Boolean(prev?.slideTackle || input.slideTackle),
      secondDefenderPress: Boolean(prev?.secondDefenderPress || input.secondDefenderPress),
      switchPlayer: Boolean(prev?.switchPlayer || input.switchPlayer),
    });
  }

  public applyRemoteSnapshot(snapshot: SyncedMatchSnapshot) {
    if (this.mode !== 'match' || this.lanMode !== 'client') return;
    if (snapshot.tick <= this.lastAppliedSnapshotTick) return;
    this.lastAppliedSnapshotTick = snapshot.tick;

    const prevHome = this.homeScore;
    const prevAway = this.awayScore;
    const prevPreMatchActive = Boolean(this.preMatchClientMirror?.active);

    this.timeRemainingSeconds = snapshot.clockSeconds;
    this.homeScore = snapshot.homeScore;
    this.awayScore = snapshot.awayScore;
    this.kickoffTeam = snapshot.kickoffTeam;
    this.goalBanner = snapshot.goalBanner;
    this.preMatchClientMirror = snapshot.preMatch ?? null;
    this.liveGoalReplayClientMirror = snapshot.liveGoalReplay ?? null;
    this.secondDefenderHomeClientMirror = Boolean(snapshot.secondDefenderHomeActive);
    this.secondDefenderAwayClientMirror = Boolean(snapshot.secondDefenderAwayActive);

    if (prevPreMatchActive && !this.preMatchClientMirror?.active) {
      soccerAudio.playWhistle('kickoff');
    }

    if (snapshot.setPiece && snapshot.setPiece.active) {
      if (!this.setPieceState || this.setPieceState.kind !== snapshot.setPiece.kind) {
        soccerAudio.playWhistle(snapshot.setPiece.kind === 'free_kick' ? 'foul' : 'setpiece');
      }
      this.setPieceClientMirror = { ...snapshot.setPiece };
      this.setPieceState = {
        kind: snapshot.setPiece.kind,
        team: snapshot.setPiece.team,
        spotX: this.ballPos.x,
        spotZ: this.ballPos.z,
        takerId: '',
        countdown: snapshot.setPiece.countdownSeconds ?? 0,
      };
    } else {
      this.setPieceClientMirror = null;
      this.setPieceState = null;
    }
    if (snapshot.stats) {
      this.matchStats = { ...snapshot.stats };
    }

    if (snapshot.localControlledMap && snapshot.localControlledMap[this.localClientId]) {
      this.localControlledActorId = snapshot.localControlledMap[this.localClientId];
    }

    if (snapshot.shootout && snapshot.shootout.active) {
      const so = snapshot.shootout;
      if (!this.shootoutState) {
        this.decidedByShootout = true;
      }
      this.shootoutState = {
        active: true,
        round: so.round,
        turnTeam: so.turnTeam,
        phase: so.phase,
        homeScore: so.homeShootoutScore,
        awayScore: so.awayShootoutScore,
        homeKicks: [...so.homeKicks],
        awayKicks: [...so.awayKicks],
        isSuddenDeath: so.isSuddenDeath,
        shotClock: so.shotClockSeconds,
        phaseTimer: 0,
        runUpTimer: 0,
        runUpDuration: 0.62,
        runUpStartX: -0.78,
        runUpStartZ: -this.fieldLength / 2 + 14.6,
        pendingTargetX: 0,
        pendingTargetY: 1.25,
        aiDelay: 0,
        aiTargetX: 0,
        aiTargetY: 1,
        aiGkDived: false,
        aimX: so.aimX,
        aimY: so.aimY,
        kickerActorId: so.activeKickerActorId,
        gkActorId: so.activeGkActorId,
        resultBanner: so.resultBanner,
        homeKickRotation: 0,
        awayKickRotation: 0,
        userPreferredRole: 'outfield',
      };
      this.paused = false;
    } else if (!snapshot.shootout) {
      this.shootoutState = null;
      if (this.shootoutAimMarker) this.shootoutAimMarker.visible = false;
    }

    // Smoothly reconcile ball (snap if teleported > 4m, blend cleanly otherwise)
    const ballDeltaSq =
      (snapshot.ball.x - this.ballPos.x) ** 2 +
      (snapshot.ball.y - this.ballPos.y) ** 2 +
      (snapshot.ball.z - this.ballPos.z) ** 2;
    if (ballDeltaSq > 16) {
      this.ballPos.set(snapshot.ball.x, snapshot.ball.y, snapshot.ball.z);
    } else {
      this.ballPos.x = THREE.MathUtils.lerp(this.ballPos.x, snapshot.ball.x, 0.72);
      this.ballPos.y = THREE.MathUtils.lerp(this.ballPos.y, snapshot.ball.y, 0.72);
      this.ballPos.z = THREE.MathUtils.lerp(this.ballPos.z, snapshot.ball.z, 0.72);
    }
    this.ballVel.set(snapshot.ball.vx, snapshot.ball.vy, snapshot.ball.vz);

    for (const sp of snapshot.players) {
      const actor = this.actors.find((a) => a.id === sp.id);
      if (!actor) continue;
      const dSq = (sp.x - actor.pos.x) ** 2 + (sp.z - actor.pos.z) ** 2;
      if (dSq > 12) {
        actor.pos.set(sp.x, sp.y, sp.z);
      } else {
        actor.pos.x = THREE.MathUtils.lerp(actor.pos.x, sp.x, 0.68);
        actor.pos.y = THREE.MathUtils.lerp(actor.pos.y, sp.y, 0.68);
        actor.pos.z = THREE.MathUtils.lerp(actor.pos.z, sp.z, 0.68);
      }
      actor.rotY = sp.rotY;
      actor.vel.set(sp.vx, 0, sp.vz);
      actor.stamina = sp.stamina;
      actor.diveState = sp.diveState;
      actor.diveDirX = sp.diveDirX ?? 0;
      actor.diveDirY = sp.diveDirY ?? 0;
      actor.tackleTimer = sp.tackleTimer;
      actor.standTackleTimer = sp.standTackleTimer ?? 0;
      actor.controlledByClientId = sp.controlledByClientId;
    }

    // Detect newly scored goal on LAN client and capture local highlight + snapshot
    if (snapshot.homeScore > prevHome || snapshot.awayScore > prevAway) {
      const scoringTeam: TeamSide = snapshot.homeScore > prevHome ? 'home' : 'away';
      const goalZSign: -1 | 1 = scoringTeam === 'home' ? -1 : 1;
      this.stadiumControls?.triggerGoalNetImpact(goalZSign, this.ballPos.x, this.ballPos.y, 1.1);
      this.captureGoalHighlight(
        scoringTeam,
        snapshot.goalBanner?.scorerName || 'TEAM STRIKE',
        snapshot.goalBanner?.scorerNumber || 10,
        snapshot.goalBanner?.assistName ?? null,
        snapshot.goalBanner?.shotSpeedKmh || Math.round(this.ballVel.length() * 3.6),
      );
      soccerAudio.playWhistle('goal');
      soccerAudio.playCrowdGoalRoar();
    }

    if (
      snapshot.clockSeconds <= 0 &&
      !this.matchEnded &&
      !this.shootoutState?.active &&
      snapshot.homeScore !== snapshot.awayScore
    ) {
      this.triggerFullTime();
    }
  }

  // ------------------------------------------------------------------
  // MAIN ANIMATION LOOP (Clamped dt + Software WebGL afterDraw pacing)
  // ------------------------------------------------------------------
  private tick = () => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (this.mode === 'showcase') {
      this.updateShowcase(dt);
    } else if (this.mode === 'match') {
      if (!this.paused) {
        this.updateMatch(dt);
      }
      this.updateMatchCamera(dt);
    } else if (this.mode === 'replay') {
      this.updateReplayMode(dt);
    }

    if (!this.paused || this.mode !== 'match') {
      this.updateParticles(dt);
    }

    // Process any queued broadcast key-play snapshots BEFORE rendering the live player camera
    // so the browser never displays the temporary broadcast angle.
    if (this.pendingSnapshotTasks.length > 0 && this.mode === 'match') {
      this.processPendingSnapshots();
    }

    this.renderer.render(this.scene, this.camera);
    this.justPressedKeys.clear();
    this.virtualEdgeActions.groundedPass = false;
    this.virtualEdgeActions.throughPass = false;
    this.virtualEdgeActions.loftOrTackle = false;
    this.virtualEdgeActions.shoot = false;
    this.virtualEdgeActions.gkJumpOrDive = false;
    this.virtualEdgeActions.gkQuickAction = undefined;
    this.virtualEdgeActions.standTackle = false;
    this.virtualEdgeActions.slideTackle = false;
    this.virtualEdgeActions.secondDefenderPress = false;

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private updateShowcase(dt: number) {
    if (!this.showcaseRig) return;
    const t = this.clock.elapsedTime;

    if (this.showcaseDragPointerId === null) {
      if (this.showcaseTargetYaw !== null) {
        this.showcaseUserYaw = THREE.MathUtils.damp(
          this.showcaseUserYaw,
          this.showcaseTargetYaw,
          7,
          dt,
        );
        if (Math.abs(this.showcaseUserYaw - this.showcaseTargetYaw) < 0.015) {
          this.showcaseUserYaw = this.showcaseTargetYaw;
          this.showcaseTargetYaw = null;
        }
      } else if (Math.abs(this.showcaseSpinVel) > 0.005) {
        this.showcaseUserYaw += this.showcaseSpinVel * dt;
        this.showcaseSpinVel = THREE.MathUtils.damp(this.showcaseSpinVel, 0, 5.5, dt);
      } else {
        this.showcaseSpinVel = 0;
      }
    }

    const idleMicroSway =
      this.showcaseDragPointerId === null && this.showcaseTargetYaw === null
        ? Math.sin(t * 0.55) * 0.07
        : 0;
    this.showcaseSpinAngle = this.showcaseUserYaw + idleMicroSway;
    this.showcaseRig.root.rotation.y = this.showcaseSpinAngle;

    // Subtle athletic breathing & idle arm sway
    this.showcaseRig.torso.position.y = 1.16 + Math.sin(t * 2.2) * 0.01;
    this.showcaseRig.leftArm.rotation.x = Math.sin(t * 1.4) * 0.05;
    this.showcaseRig.rightArm.rotation.x = -Math.sin(t * 1.4) * 0.05;
    this.showcaseRig.headGroup.rotation.y = Math.sin(t * 0.9) * 0.07;

    if (this.showcaseRig.hairHasPhysics && this.showcaseRig.dynamicHairGroup) {
      this.showcaseRig.dynamicHairGroup.rotation.x =
        this.graphicsQuality === 'high' ? Math.sin(t * 2.1) * 0.045 : 0;
      this.showcaseRig.dynamicHairGroup.rotation.z =
        this.graphicsQuality === 'high' ? Math.cos(t * 1.4) * 0.035 : 0;
    }
  }

  // ------------------------------------------------------------------
  // READ LOCAL PLAYER INPUT (Exact User Spec for Outfield & GK)
  // Movement is transformed relative to the Player-Locked 3rd-Person Camera yaw
  // ------------------------------------------------------------------
  private gatherLocalInput(): ClientMatchInput {
    let rawX = this.virtualAxis.x;
    let rawZ = this.virtualAxis.z;

    if (this.heldKeys.has('ArrowLeft')) rawX -= 1;
    if (this.heldKeys.has('ArrowRight')) rawX += 1;
    if (this.heldKeys.has('ArrowUp')) rawZ -= 1;
    if (this.heldKeys.has('ArrowDown')) rawZ += 1;

    const len = Math.hypot(rawX, rawZ);
    if (len > 1) {
      rawX /= len;
      rawZ /= len;
    }

    // Rotate local input by the player's camera yaw (baseYaw + manualOrbitYaw)
    // so ArrowUp / D-Pad Up always moves forward from the player's camera angle.
    // During Penalty Shootout, BOTH shooter and goalkeeper share the fixed broadcast camera
    // behind the penalty spot facing -Z goal (baseYaw = 0, no manual orbit).
    const active = this.actors.find((a) => a.id === this.localControlledActorId);
    let baseYaw = active?.team === 'away' ? Math.PI : 0;
    if (this.shootoutState?.active) {
      baseYaw = 0;
    }
    const moveYaw = this.shootoutState?.active ? 0 : baseYaw + this.manualOrbitYaw;
    const cosY = Math.cos(moveYaw);
    const sinY = Math.sin(moveYaw);
    const moveX = rawX * cosY + rawZ * sinY;
    const moveZ = -rawX * sinY + rawZ * cosY;

    const sprint = this.heldKeys.has('ShiftLeft') || this.virtualSprint;
    const groundedPass = this.justPressedKeys.has('KeyS') || this.virtualEdgeActions.groundedPass;
    const throughPass = this.justPressedKeys.has('KeyW') || this.virtualEdgeActions.throughPass;
    const loftOrTackle = this.justPressedKeys.has('KeyA') || this.virtualEdgeActions.loftOrTackle;
    const shoot = this.justPressedKeys.has('KeyD') || this.virtualEdgeActions.shoot;
    const gkJumpOrDive = this.justPressedKeys.has('Space') || this.virtualEdgeActions.gkJumpOrDive;
    const gkQuickAction = this.virtualEdgeActions.gkQuickAction;
    const standTackle = this.virtualEdgeActions.standTackle;
    const slideTackle = this.virtualEdgeActions.slideTackle;
    const secondDefenderPress = this.virtualEdgeActions.secondDefenderPress;

    return {
      moveX,
      moveZ,
      sprint,
      groundedPass,
      throughPass,
      loftOrTackle,
      shoot,
      gkJumpOrDive,
      gkQuickAction,
      standTackle,
      slideTackle,
      secondDefenderPress,
    };
  }

  private updateMatch(dt: number) {
    if (this.matchEnded) return;

    if (this.lanNoticeTimer > 0) {
      this.lanNoticeTimer = Math.max(0, this.lanNoticeTimer - dt);
      if (this.lanNoticeTimer <= 0) this.lanNotice = null;
    }

    const localInput = this.gatherLocalInput();

    // Switch outfielder ONLY when explicitly triggered by Switch button or Q/Tab
    if (this.justPressedKeys.has('KeyQ') || this.justPressedKeys.has('Tab')) {
      this.switchActivePlayer();
    }

    if (this.lanMode === 'client') {
      // Latch any frame-level edge triggers so zero button taps are dropped between 30Hz packets
      if (localInput.groundedPass) this.pendingClientEdges.groundedPass = true;
      if (localInput.throughPass) this.pendingClientEdges.throughPass = true;
      if (localInput.loftOrTackle) this.pendingClientEdges.loftOrTackle = true;
      if (localInput.shoot) this.pendingClientEdges.shoot = true;
      if (localInput.gkJumpOrDive) this.pendingClientEdges.gkJumpOrDive = true;
      if (localInput.gkQuickAction) this.pendingClientEdges.gkQuickAction = localInput.gkQuickAction;
      if (localInput.standTackle) this.pendingClientEdges.standTackle = true;
      if (localInput.slideTackle) this.pendingClientEdges.slideTackle = true;
      if (localInput.secondDefenderPress) this.pendingClientEdges.secondDefenderPress = true;

      this.clientInputEmitAccum += dt;
      if (this.clientInputEmitAccum >= 0.033) {
        this.clientInputEmitAccum = 0;
        this.clientInputSeq += 1;
        this.callbacks.onLanClientInputEmit?.({
          ...localInput,
          seq: this.clientInputSeq,
          groundedPass: this.pendingClientEdges.groundedPass,
          throughPass: this.pendingClientEdges.throughPass,
          loftOrTackle: this.pendingClientEdges.loftOrTackle,
          shoot: this.pendingClientEdges.shoot,
          gkJumpOrDive: this.pendingClientEdges.gkJumpOrDive,
          gkQuickAction: this.pendingClientEdges.gkQuickAction,
          standTackle: this.pendingClientEdges.standTackle,
          slideTackle: this.pendingClientEdges.slideTackle,
          secondDefenderPress: this.pendingClientEdges.secondDefenderPress,
          switchPlayer: this.pendingClientEdges.switchPlayer,
        });
        this.pendingClientEdges.groundedPass = false;
        this.pendingClientEdges.throughPass = false;
        this.pendingClientEdges.loftOrTackle = false;
        this.pendingClientEdges.shoot = false;
        this.pendingClientEdges.gkJumpOrDive = false;
        this.pendingClientEdges.gkQuickAction = undefined;
        this.pendingClientEdges.standTackle = false;
        this.pendingClientEdges.slideTackle = false;
        this.pendingClientEdges.secondDefenderPress = false;
        this.pendingClientEdges.switchPlayer = false;
      }

      // Smooth velocity dead-reckoning between host snapshots
      for (const actor of this.actors) {
        actor.pos.x += actor.vel.x * dt * 0.45;
        actor.pos.z += actor.vel.z * dt * 0.45;
      }
      this.ballPos.addScaledVector(this.ballVel, dt * 0.45);
      if (this.ballPos.y < 0.24) this.ballPos.y = 0.24;

      this.animateAllActorRigs(dt);
      this.syncBallVisual(dt);
      this.stadiumControls?.updateGoalNets(dt);
      this.updateCrowdExcitementAndMesh(dt);
      this.advanceHighlightRecording(dt);
      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.09) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }
      return;
    }

    // Update net ripple spring simulation smoothly every frame
    this.stadiumControls?.updateGoalNets(dt);

    // Cinematic 4-Scene Pre-Match Broadcast Cutscene (Host / Offline)
    if (this.preMatchState?.active) {
      this.updatePreMatchCutscene(dt);
      return;
    }

    // Dedicated Penalty Shootout Flow (Host / Offline)
    if (this.shootoutState?.active) {
      this.updatePenaltyShootout(dt, localInput);
      this.updateCrowdExcitementAndMesh(dt);
      return;
    }

    // Snapshot & 2nd Defender Press timers
    if (this.saveSnapshotCooldown > 0) this.saveSnapshotCooldown -= dt;
    if (this.postSnapshotCooldown > 0) this.postSnapshotCooldown -= dt;
    if (this.shotSnapshotCooldown > 0) this.shotSnapshotCooldown -= dt;
    if (this.crowdBoostTimer > 0) this.crowdBoostTimer = Math.max(0, this.crowdBoostTimer - dt);

    const ballOwner = this.ballOwnerId
      ? this.actors.find((a) => a.id === this.ballOwnerId) ?? null
      : null;
    if (this.homeSecondDefTimer > 0) {
      if (ballOwner?.team === 'home') this.homeSecondDefTimer = 0;
      else this.homeSecondDefTimer = Math.max(0, this.homeSecondDefTimer - dt);
    }
    if (this.awaySecondDefTimer > 0) {
      if (ballOwner?.team === 'away') this.awaySecondDefTimer = 0;
      else this.awaySecondDefTimer = Math.max(0, this.awaySecondDefTimer - dt);
    }

    // Goal Celebration -> Live 3-Second Slow-Motion Goal Replay Flow
    if (this.goalResetTimer > 0) {
      this.goalResetTimer -= dt;
      const lr = this.liveGoalReplayState;

      if (lr && lr.active) {
        lr.elapsed += dt;
        const progress = THREE.MathUtils.clamp(lr.elapsed / lr.duration, 0, 1);
        const sampleTime = progress * lr.clipDuration;
        this.applyHighlightFrameAtTime(lr.frames, sampleTime, dt * 0.6);

        if (!lr.burstFired && progress >= 0.72) {
          lr.burstFired = true;
          this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 16);
        }

        if (lr.elapsed >= lr.duration || this.goalResetTimer <= 0) {
          this.liveGoalReplayState = null;
          this.goalResetTimer = 0;
          this.goalBanner = null;
          this.resetPositionsForKickoff(this.kickoffTeam);
          soccerAudio.playWhistle('kickoff');
        }

        this.updateCrowdExcitementAndMesh(dt);
        if (this.lanMode === 'host') {
          this.snapshotEmitAccum += dt;
          if (this.snapshotEmitAccum >= 0.05) {
            this.snapshotEmitAccum = 0;
            this.emitLanSnapshot();
          }
        }
        this.hudEmitAccum += dt;
        if (this.hudEmitAccum >= 0.08) {
          this.hudEmitAccum = 0;
          this.emitHud();
        }
        return;
      }

      if (lr && !lr.active) {
        this.updateBallPhysics(dt);
        this.animateAllActorRigs(dt);
        this.syncBallVisual(dt);
        this.updateCrowdExcitementAndMesh(dt);
        this.advanceHighlightRecording(dt);

        lr.celebrationTimer -= dt;
        if (lr.celebrationTimer <= 0) {
          const sliceStart = Math.max(0, this.matchElapsedTime - 2.35);
          const sliced = this.highlightBuffer.filter((f) => f.t >= sliceStart);
          if (sliced.length >= 2) {
            const baseT = sliced[0].t;
            lr.frames = sliced.map((f) => ({
              t: Math.max(0, f.t - baseT),
              ball: { ...f.ball },
              actors: f.actors.map((a) => ({ ...a })),
            }));
            lr.clipDuration = Math.max(0.8, lr.frames[lr.frames.length - 1].t);
            lr.active = true;
            lr.elapsed = 0;
            this.goalBanner = null;
            this.applyHighlightFrameAtTime(lr.frames, 0, 0.016);
            if (this.lanMode === 'host') {
              this.emitLanSnapshot();
            }
            this.emitHud();
            return;
          } else {
            this.liveGoalReplayState = null;
          }
        }
        if (this.lanMode === 'host') {
          this.snapshotEmitAccum += dt;
          if (this.snapshotEmitAccum >= 0.05) {
            this.snapshotEmitAccum = 0;
            this.emitLanSnapshot();
          }
        }
        this.hudEmitAccum += dt;
        if (this.hudEmitAccum >= 0.08) {
          this.hudEmitAccum = 0;
          this.emitHud();
        }
        return;
      }

      if (this.goalResetTimer <= 0) {
        this.liveGoalReplayState = null;
        this.goalBanner = null;
        this.resetPositionsForKickoff(this.kickoffTeam);
        soccerAudio.playWhistle('kickoff');
      }
    } else if (this.setPieceState) {
      // Handle remote manual player switch even during set-piece
      for (const [cid, inp] of this.remoteInputs.entries()) {
        if (inp.switchPlayer) {
          this.cycleLanClientActor(cid);
          inp.switchPlayer = false;
        }
      }

      this.updateSetPiece(dt, localInput);

      // If set-piece is still active, allow ALL non-taker players (human & AI) to move freely!
      if (this.setPieceState) {
        const sp = this.setPieceState;
        this.updateTeamTacticalPlans(dt);
        for (const actor of this.actors) {
          if (actor.id === sp.takerId) continue;
          const isLocalHuman = actor.id === this.localControlledActorId;
          const remoteInput =
            actor.controlledByClientId && actor.controlledByClientId !== this.localClientId
              ? this.remoteInputs.get(actor.controlledByClientId)
              : undefined;

          if (isLocalHuman) {
            this.stepSetPiecePlayerMovement(actor, localInput, dt);
          } else if (remoteInput) {
            this.stepSetPiecePlayerMovement(actor, remoteInput, dt);
          } else {
            this.stepAiSetPieceMovement(actor, sp, dt);
          }
        }
        this.resolveActorCollisions();
      }

      this.remoteInputs.forEach((inp) => {
        inp.groundedPass = false;
        inp.throughPass = false;
        inp.loftOrTackle = false;
        inp.shoot = false;
        inp.gkJumpOrDive = false;
        inp.gkQuickAction = undefined;
        inp.standTackle = false;
        inp.slideTackle = false;
        inp.secondDefenderPress = false;
        inp.switchPlayer = false;
      });

      this.animateAllActorRigs(dt);
      this.syncBallVisual(dt);
      this.updateCrowdExcitementAndMesh(dt);
      this.advanceHighlightRecording(dt);
      if (this.lanMode === 'host') {
        this.snapshotEmitAccum += dt;
        if (this.snapshotEmitAccum >= 0.05) {
          this.snapshotEmitAccum = 0;
          this.emitLanSnapshot();
        }
      }
      this.hudEmitAccum += dt;
      if (this.hudEmitAccum >= 0.08) {
        this.hudEmitAccum = 0;
        this.emitHud();
      }
      return;
    } else {
      this.timeRemainingSeconds = Math.max(0, this.timeRemainingSeconds - dt);

      if (
        this.totalSeconds >= 120 &&
        !this.halftimeWhistlePlayed &&
        this.timeRemainingSeconds <= this.totalSeconds * 0.5 &&
        this.timeRemainingSeconds > 2
      ) {
        this.halftimeWhistlePlayed = true;
        soccerAudio.playWhistle('halftime');
        this.setHint('HALF TIME');
      }

      if (this.timeRemainingSeconds <= 0) {
        if (this.homeScore === this.awayScore && this.callbacks.onDrawAtFullTime) {
          this.paused = true;
          if (this.lanMode === 'host') {
            this.emitLanSnapshot();
          }
          soccerAudio.playWhistle('fulltime');
          this.emitHud();
          this.callbacks.onDrawAtFullTime({
            homeScore: this.homeScore,
            awayScore: this.awayScore,
            extraTimeCount: this.extraTimeCount,
          });
          return;
        }
        this.triggerFullTime();
        return;
      }
    }

    if (this.actionHintTimer > 0) {
      this.actionHintTimer -= dt;
      if (this.actionHintTimer <= 0) this.lastActionHint = '';
    }

    // Handle remote manual player switch requests on host
    for (const [cid, inp] of this.remoteInputs.entries()) {
      if (inp.switchPlayer) {
        this.cycleLanClientActor(cid);
        inp.switchPlayer = false;
      }
    }

    // Pre-compute coordinated team defensive lines, presser roles, counter-attack & marking assignments
    this.updateTeamTacticalPlans(dt);

    // Update all actors (human inputs + AI teammates/opponents)
    for (const actor of this.actors) {
      const isLocalHuman = actor.id === this.localControlledActorId;
      const remoteInput =
        actor.controlledByClientId && actor.controlledByClientId !== this.localClientId
          ? this.remoteInputs.get(actor.controlledByClientId)
          : undefined;

      if (isLocalHuman) {
        this.stepActorWithInput(actor, localInput, dt);
      } else if (remoteInput) {
        this.stepActorWithInput(actor, remoteInput, dt);
      } else {
        this.stepAiActor(actor, dt);
      }
    }

    // Clear consumed remote edge triggers
    this.remoteInputs.forEach((inp) => {
      inp.groundedPass = false;
      inp.throughPass = false;
      inp.loftOrTackle = false;
      inp.shoot = false;
      inp.gkJumpOrDive = false;
      inp.gkQuickAction = undefined;
      inp.standTackle = false;
      inp.slideTackle = false;
      inp.secondDefenderPress = false;
      inp.switchPlayer = false;
    });

    this.resolveActorCollisions();
    this.updateBallPhysics(dt);
    this.animateAllActorRigs(dt);
    this.syncBallVisual(dt);
    this.updateCrowdExcitementAndMesh(dt);
    this.advanceHighlightRecording(dt);

    if (this.lanMode === 'host') {
      this.snapshotEmitAccum += dt;
      if (this.snapshotEmitAccum >= 0.05) {
        this.snapshotEmitAccum = 0;
        this.emitLanSnapshot();
      }
    }

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private stepActorWithInput(actor: MatchActor, input: ClientMatchInput, dt: number) {
    if (actor.role === 'goalkeeper') {
      this.stepGoalkeeperInput(actor, input, dt);
    } else {
      this.stepOutfieldInput(actor, input, dt);
    }
  }

  private stepGoalkeeperInput(gk: MatchActor, input: ClientMatchInput, dt: number) {
    const zSign = gk.team === 'home' ? 1 : -1;
    const halfL = this.fieldLength / 2;

    // Handle active Jump or Dive state
    if (gk.diveTimer > 0) {
      gk.diveTimer -= dt;
      gk.vy -= 18 * dt;
      gk.pos.x += gk.vel.x * dt;
      gk.pos.z += gk.vel.z * dt;
      gk.pos.y = Math.max(0, gk.pos.y + gk.vy * dt);
      if (gk.pos.y === 0 && gk.vy < 0) gk.vy = 0;
      if (gk.diveTimer <= 0) {
        gk.diveState = 'none';
        gk.diveDirX = 0;
        gk.diveDirY = 0;
        gk.pos.y = 0;
      }
    } else {
      // Trigger vertical Jump (Jump button) or 360° Joystick Dive (Space / Dive button)
      if (input.gkQuickAction === 'jump') {
        gk.vy = 6.8;
        gk.diveTimer = 0.5;
        gk.diveState = 'jump';
        gk.diveDirX = 0;
        gk.diveDirY = 1;
        gk.vel.set(0, 0, 0);
        soccerAudio.playDiveWhoosh();
      } else if (input.gkJumpOrDive) {
        const mag = Math.hypot(input.moveX, input.moveZ);
        if (mag > 0.12) {
          const nx = input.moveX / mag;
          const nz = input.moveZ / mag;
          gk.vel.set(nx * 10.0, 0, nz * 7.2);
          gk.vy = 4.6;
          gk.diveTimer = 0.46;
          gk.diveDirX = nx;
          gk.diveDirY = 0.45;
          gk.diveState = Math.abs(nx) >= Math.abs(nz) ? (nx < 0 ? 'left' : 'right') : 'forward';
          soccerAudio.playDiveWhoosh();
        } else {
          // Vertical Jump
          gk.vy = 6.8;
          gk.diveTimer = 0.5;
          gk.diveState = 'jump';
          gk.diveDirX = 0;
          gk.diveDirY = 1;
          gk.vel.set(0, 0, 0);
          soccerAudio.playDiveWhoosh();
        }
      } else {
        // Normal GK movement inside/around penalty box
        const speed = 6.8;
        gk.vel.x = THREE.MathUtils.damp(gk.vel.x, input.moveX * speed, 14, dt);
        gk.vel.z = THREE.MathUtils.damp(gk.vel.z, input.moveZ * speed, 14, dt);
        gk.pos.x += gk.vel.x * dt;
        gk.pos.z += gk.vel.z * dt;

        if (Math.hypot(gk.vel.x, gk.vel.z) > 0.4) {
          gk.rotY = Math.atan2(gk.vel.x, gk.vel.z);
        } else {
          // Face the ball ready to parry
          gk.rotY = Math.atan2(this.ballPos.x - gk.pos.x, this.ballPos.z - gk.pos.z);
        }
      }
    }

    // Keep dedicated GK constrained to penalty area zone
    const maxBoxX = 11.5;
    const minBoxZ = zSign > 0 ? halfL - 15.5 : -halfL + 0.5;
    const maxBoxZ = zSign > 0 ? halfL - 0.5 : -halfL + 15.5;
    gk.pos.x = THREE.MathUtils.clamp(gk.pos.x, -maxBoxX, maxBoxX);
    gk.pos.z = THREE.MathUtils.clamp(gk.pos.z, minBoxZ, maxBoxZ);

    // GK Save / Ball Clearance on contact (balanced reach for larger goal frame)
    const reach = gk.diveState !== 'none' ? 1.52 : 1.05;
    const dist = _tmpVec.copy(this.ballPos).setY(0).distanceTo(_tmpVec2.copy(gk.pos).setY(0));
    if (dist < reach && this.ballPos.y < (gk.diveState === 'jump' ? 2.85 : 2.15)) {
      const clearZ = gk.team === 'home' ? -1 : 1;
      const clearX = (this.ballPos.x >= 0 ? 1 : -1) * 0.42;
      const incomingSpeed = this.ballVel.length();
      this.recordBallTouch(gk);
      this.ballOwnerId = null;
      this.ballVel.set(clearX * 16, 5.8, clearZ * 17);
      this.cameraShake = 0.35;
      this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 10);
      soccerAudio.playKick(0.9);
      this.setHint('GK SAVE!');
      if (gk.team === 'home') this.matchStats.homeSaves += 1;
      else this.matchStats.awaySaves += 1;
      if (incomingSpeed > 11 && this.saveSnapshotCooldown <= 0) {
        this.saveSnapshotCooldown = 3.2;
        this.queueKeyPlaySnapshot(
          'save',
          gk.team,
          gk.jerseyText,
          'SPECTACULAR GK SAVE',
          `#${gk.jerseyNumber} ${gk.jerseyText} • ${gk.diveState === 'none' ? 'Close-Range Stop' : 'Acrobatic Dive'}`,
        );
      }
    }
  }

  private computeTeamHasBall(team: TeamSide): boolean {
    if (this.ballOwnerId) {
      const owner = this.actors.find((a) => a.id === this.ballOwnerId);
      return owner?.team === team;
    }
    if (this.setPieceState) {
      return this.setPieceState.team === team;
    }
    return this.lastTouchActor?.team === team && this.lastKickerGraceTimer > 0;
  }

  private stepOutfieldInput(actor: MatchActor, input: ClientMatchInput, dt: number) {
    if (actor.standTackleTimer > 0) {
      actor.standTackleTimer = Math.max(0, actor.standTackleTimer - dt);
      if (actor.standTackleTimer > 0.08) {
        this.tryWinBallOnTackle(actor, false);
      }
    }

    if (actor.tackleTimer > 0) {
      actor.tackleTimer = Math.max(0, actor.tackleTimer - dt);
      actor.pos.x += actor.vel.x * dt;
      actor.pos.z += actor.vel.z * dt;
      actor.vel.multiplyScalar(Math.max(0, 1 - 4.5 * dt));
      this.clampToPitch(actor.pos);
      this.tryWinBallOnTackle(actor, true);
      return;
    }

    const moving = Math.hypot(input.moveX, input.moveZ) > 0.1;
    const sprinting = input.sprint && moving && actor.stamina > 4;

    if (sprinting) {
      actor.stamina = Math.max(0, actor.stamina - 24 * dt);
    } else {
      actor.stamina = Math.min(100, actor.stamina + 16 * dt);
    }

    const fatigueFactor = actor.stamina < 25 ? 0.78 + 0.22 * (actor.stamina / 25) : 1;
    const topSpeed = (sprinting ? 12.6 : 8.4) * fatigueFactor;
    const targetVx = input.moveX * topSpeed;
    const targetVz = input.moveZ * topSpeed;

    actor.vel.x = THREE.MathUtils.damp(actor.vel.x, targetVx, 12, dt);
    actor.vel.z = THREE.MathUtils.damp(actor.vel.z, targetVz, 12, dt);

    actor.pos.x += actor.vel.x * dt;
    actor.pos.z += actor.vel.z * dt;
    this.clampToPitch(actor.pos);

    if (Math.hypot(actor.vel.x, actor.vel.z) > 0.45) {
      const targetRot = Math.atan2(actor.vel.x, actor.vel.z);
      actor.rotY = this.dampAngle(actor.rotY, targetRot, 14, dt);
    }

    const teamHasBall = this.computeTeamHasBall(actor.team);
    const distToBall = Math.hypot(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);
    const canKick =
      (this.ballOwnerId === actor.id ||
        (teamHasBall && distToBall < 1.55) ||
        (!this.ballOwnerId && distToBall < 1.35)) &&
      this.ballPos.y < 1.8;

    // FC Mobile Context-Sensitive Outfield Actions:
    // Attacking: Shoot / Grounded Pass / Through Pass / Lofted Pass
    // Defending: Stand Tackle (PRESS) / Slide Tackle (SLIDE) / Second Defender Press (2ND DEF)
    if (canKick) {
      if (input.shoot) {
        this.performShoot(actor, input);
      } else if (input.groundedPass) {
        this.performPass(actor, input, 'grounded');
      } else if (input.throughPass) {
        this.performPass(actor, input, 'through');
      } else if (input.loftOrTackle) {
        this.performPass(actor, input, 'lofted');
      }
    } else {
      if (input.standTackle || (!teamHasBall && input.shoot)) {
        this.performStandTackle(actor);
      } else if (
        input.slideTackle ||
        (!teamHasBall && (input.groundedPass || input.loftOrTackle))
      ) {
        this.performSlideTackle(actor);
      } else if (input.secondDefenderPress || (!teamHasBall && input.throughPass)) {
        this.activateSecondDefender(actor.team);
      }
    }
  }

  private performPass(
    actor: MatchActor,
    input: ClientMatchInput,
    kind: 'grounded' | 'through' | 'lofted',
  ) {
    // Determine facing/movement aim direction
    const hasMoveInput = Math.hypot(input.moveX, input.moveZ) > 0.12;
    const rawDirX = hasMoveInput ? input.moveX : Math.sin(actor.rotY);
    const rawDirZ = hasMoveInput ? input.moveZ : Math.cos(actor.rotY);
    const dirLen = Math.max(0.01, Math.hypot(rawDirX, rawDirZ));
    const nx = rawDirX / dirLen;
    const nz = rawDirZ / dirLen;

    // 1. Smart Teammate Target Assist: 45-degree cone scan in front of player's facing/movement direction
    const CONE_HALF_ANGLE_COS = Math.cos(Math.PI / 4); // cos(45 deg) ≈ 0.7071
    const maxScanDist = kind === 'lofted' ? 68 : 56;
    const teammates = this.actors.filter((a) => a.team === actor.team && a.id !== actor.id);

    let bestMate: MatchActor | null = null;
    let bestScore = -Infinity;

    for (const mate of teammates) {
      const dx = mate.pos.x - actor.pos.x;
      const dz = mate.pos.z - actor.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.2 || dist > maxScanDist) continue;

      const align = (dx / dist) * nx + (dz / dist) * nz;
      if (align < CONE_HALF_ANGLE_COS) continue;

      // Score favors tight alignment with aim and reachable pitch positioning
      const score = align * 3.0 - dist * 0.015;
      if (score > bestScore) {
        bestScore = score;
        bestMate = mate;
      }
    }

    // Fallback: if no teammate is in the forward 45° cone, aim along the player's aim vector
    const fallbackDist = kind === 'lofted' ? 24 : kind === 'through' ? 20 : 16;
    let targetX = actor.pos.x + nx * fallbackDist;
    let targetZ = actor.pos.z + nz * fallbackDist;

    if (bestMate) {
      if (kind === 'through') {
        // Through Pass (W): Lead running teammate by 2–3 meters into open space based on velocity
        const mateSpeed = Math.hypot(bestMate.vel.x, bestMate.vel.z);
        const attackZ = actor.team === 'home' ? -1 : 1;
        const leadDist = THREE.MathUtils.clamp(2.2 + mateSpeed * 0.1, 2.0, 3.2);
        const leadDirX = mateSpeed > 0.6 ? bestMate.vel.x / mateSpeed : 0;
        const leadDirZ = mateSpeed > 0.6 ? bestMate.vel.z / mateSpeed : attackZ;
        targetX = bestMate.pos.x + leadDirX * leadDist;
        targetZ = bestMate.pos.z + leadDirZ * leadDist + attackZ * 0.5;
      } else if (kind === 'lofted') {
        // Lofted Pass (A): Slight movement lead so distant teammate meets the drop cleanly
        targetX = bestMate.pos.x + bestMate.vel.x * 0.42;
        targetZ = bestMate.pos.z + bestMate.vel.z * 0.42;
      } else {
        // Grounded Pass (S): Aim directly at the target teammate's feet
        targetX = bestMate.pos.x + bestMate.vel.x * 0.14;
        targetZ = bestMate.pos.z + bestMate.vel.z * 0.14;
      }
    }

    // Clamp target within pitch boundaries
    targetX = THREE.MathUtils.clamp(targetX, -this.fieldWidth / 2 + 1.0, this.fieldWidth / 2 - 1.0);
    targetZ = THREE.MathUtils.clamp(targetZ, -this.fieldLength / 2 + 1.0, this.fieldLength / 2 - 1.0);

    this.executePassToTargetCoords(actor, targetX, targetZ, kind, bestMate, false);
  }

  private executePassToTargetCoords(
    actor: MatchActor,
    targetX: number,
    targetZ: number,
    kind: 'grounded' | 'through' | 'lofted',
    bestMate: MatchActor | null,
    isAi: boolean,
  ) {
    const clampedX = THREE.MathUtils.clamp(
      targetX,
      -this.fieldWidth / 2 + 1.0,
      this.fieldWidth / 2 - 1.0,
    );
    const clampedZ = THREE.MathUtils.clamp(
      targetZ,
      -this.fieldLength / 2 + 1.0,
      this.fieldLength / 2 - 1.0,
    );

    const dx = clampedX - this.ballPos.x;
    const dz = clampedZ - this.ballPos.z;
    const dist = Math.max(0.8, Math.hypot(dx, dz));
    const passDirX = dx / dist;
    const passDirZ = dz / dist;

    // Orient passer smoothly toward the pass trajectory
    actor.rotY = Math.atan2(passDirX, passDirZ);

    // Dynamic Power, Friction Compensation & Sprint Momentum Transfer
    const turfDrag = 0.85; // Matches updateBallPhysics ground linear damping
    const forwardMomentum = Math.max(
      0,
      (actor.vel.x * passDirX + actor.vel.z * passDirZ) * 0.42,
    );
    const baseMovementBoost = Math.hypot(actor.vel.x, actor.vel.z) * 0.18;
    const sprintMomentum = Math.max(forwardMomentum, baseMovementBoost);

    let horizSpeed = 14;
    let verticalVel = 0.25;

    if (kind === 'grounded') {
      // Fast, low-friction ground pass: initial speed = desired arrival speed + turfDrag * dist
      const arrivalSpeed = 5.4;
      const baseKick = THREE.MathUtils.clamp(arrivalSpeed + turfDrag * dist, 11.5, 29.0);
      horizSpeed = Math.min(33.0, baseKick + sprintMomentum);
      verticalVel = 0.22;
    } else if (kind === 'through') {
      // Crisp lead pass into open space ahead of teammate
      const arrivalSpeed = 4.0;
      const baseKick = THREE.MathUtils.clamp(arrivalSpeed + turfDrag * dist * 1.05, 13.0, 31.0);
      horizSpeed = Math.min(35.0, baseKick + sprintMomentum);
      verticalVel = 0.95;
    } else {
      // Lofted Pass (A): True high parabolic arc that clears defenders & crossbar and drops onto teammate
      verticalVel = THREE.MathUtils.clamp(11.4 + dist * 0.15, 11.8, 17.5);
      const flightTime = (2.0 * verticalVel) / 19.6;
      const requiredHoriz = (dist / Math.max(0.9, flightTime)) * 1.06;
      horizSpeed = Math.min(
        26.5,
        THREE.MathUtils.clamp(requiredHoriz, 7.5, 23.5) + sprintMomentum * 0.35,
      );
      this.ballPos.y = Math.max(this.ballPos.y, 0.38);
    }

    this.recordBallTouch(actor);
    if (actor.team === 'home') this.matchStats.homePasses += 1;
    else this.matchStats.awayPasses += 1;

    this.ballOwnerId = null;
    this.lastKickerId = actor.id;
    this.lastKickerGraceTimer = kind === 'lofted' ? 0.48 : 0.34;
    this.ballVel.set(passDirX * horizSpeed, verticalVel, passDirZ * horizSpeed);
    actor.kickAnimTimer = 0.28;
    actor.aiActionCooldown = 0.28;

    this.spawnBurst(this.ballPos.x, 0.12, this.ballPos.z, 5);
    soccerAudio.playPass(kind);

    if (!isAi) {
      this.setHint(
        kind === 'through'
          ? bestMate
            ? `THROUGH → ${bestMate.jerseyText}`
            : 'THROUGH PASS'
          : kind === 'lofted'
            ? bestMate
              ? `LOFTED → ${bestMate.jerseyText}`
              : 'LOFTED PASS'
            : bestMate
              ? `PASS → ${bestMate.jerseyText}`
              : 'GROUNDED PASS',
      );
    }
  }

  private performShoot(actor: MatchActor, input: ClientMatchInput) {
    const aimOffsetX = THREE.MathUtils.clamp(input.moveX * 4.2, -4.2, 4.2);
    this.executeShotKick(actor, aimOffsetX, 26.2, false);
  }

  private executeShotKick(
    actor: MatchActor,
    targetX: number,
    shotSpeed: number,
    isAi: boolean,
  ) {
    const goalZ = actor.team === 'home' ? -this.fieldLength / 2 : this.fieldLength / 2;
    const dx = targetX - this.ballPos.x;
    const dz = goalZ - this.ballPos.z;
    const dist = Math.max(1, Math.hypot(dx, dz));
    const dirX = dx / dist;
    const dirZ = dz / dist;

    actor.rotY = Math.atan2(dirX, dirZ);

    this.recordBallTouch(actor);
    if (actor.team === 'home') this.matchStats.homeShots += 1;
    else this.matchStats.awayShots += 1;

    this.ballOwnerId = null;
    this.lastKickerId = actor.id;
    this.lastKickerGraceTimer = 0.28;
    const loftY = isAi ? 3.4 + Math.random() * 1.9 : 4.4 + Math.random() * 1.8;
    this.ballVel.set(dirX * shotSpeed, loftY, dirZ * shotSpeed);
    actor.kickAnimTimer = 0.28;
    actor.aiActionCooldown = 0.35;
    if (!isAi) {
      this.cameraShake = 0.28;
      this.setHint('POWER SHOT!');
    }
    this.spawnBurst(this.ballPos.x, 0.18, this.ballPos.z, 10);
    soccerAudio.playShot();
    this.crowdBoostTimer = Math.max(this.crowdBoostTimer, 1.4);

    if (Math.abs(goalZ - this.ballPos.z) < 28 && this.shotSnapshotCooldown <= 0) {
      this.shotSnapshotCooldown = 4.5;
      this.queueKeyPlaySnapshot(
        'shot',
        actor.team,
        actor.jerseyText,
        'THUNDERBOLT STRIKE',
        `#${actor.jerseyNumber} ${actor.jerseyText} • ${Math.round(shotSpeed * 3.6)} km/h effort`,
      );
    }
  }

  private activateSecondDefender(team: TeamSide) {
    if (team === 'home') {
      this.homeSecondDefTimer = 2.6;
    } else {
      this.awaySecondDefTimer = 2.6;
    }
  }

  private performStandTackle(actor: MatchActor) {
    const dx = this.ballPos.x - actor.pos.x;
    const dz = this.ballPos.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.08 && dist < 3.4) {
      actor.rotY = Math.atan2(dx, dz);
    }
    const nx = Math.sin(actor.rotY);
    const nz = Math.cos(actor.rotY);
    actor.standTackleTimer = 0.24;
    actor.vel.set(nx * 9.5, 0, nz * 9.5);
    soccerAudio.playKick(0.45);
    this.tryWinBallOnTackle(actor, false);
    if (actor.id === this.localControlledActorId) {
      this.setHint('STAND TACKLE');
    }
  }

  private performSlideTackle(actor: MatchActor, isAi = false) {
    if (!isAi) {
      const dx = this.ballPos.x - actor.pos.x;
      const dz = this.ballPos.z - actor.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.12 && dist < 3.6 && Math.hypot(actor.vel.x, actor.vel.z) < 1.2) {
        actor.rotY = Math.atan2(dx, dz);
      }
    }
    const nx = Math.sin(actor.rotY);
    const nz = Math.cos(actor.rotY);
    actor.tackleTimer = 0.36;
    actor.vel.set(nx * 14.5, 0, nz * 14.5);
    this.spawnBurst(actor.pos.x, 0.08, actor.pos.z, 6);
    soccerAudio.playDiveWhoosh();
    this.tryWinBallOnTackle(actor, true);
    if (!isAi && actor.id === this.localControlledActorId) {
      this.setHint('SLIDE TACKLE!');
    }
  }

  private tryWinBallOnTackle(actor: MatchActor, isSlide = true) {
    const dist = Math.hypot(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);
    const reach = isSlide ? 1.45 : 1.32;
    if (dist < reach && this.ballPos.y < 1.2) {
      this.recordBallTouch(actor);
      if (actor.team === 'home') this.matchStats.homeTackles += 1;
      else this.matchStats.awayTackles += 1;
      this.ballOwnerId = actor.id;
      this.ballVel.set(Math.sin(actor.rotY) * 5.2, 0, Math.cos(actor.rotY) * 5.2);
      if (actor.id === this.localControlledActorId) {
        this.cameraShake = 0.16;
      }
      soccerAudio.playKick(0.65);
      return;
    }

    // Clumsy slide tackle from directly behind the ball carrier triggers a Free Kick
    if (
      isSlide &&
      !this.setPieceState &&
      !this.shootoutState?.active &&
      this.ballOwnerId &&
      this.goalResetTimer <= 0
    ) {
      const carrier = this.actors.find((a) => a.id === this.ballOwnerId);
      if (carrier && carrier.team !== actor.team) {
        const dCarrier = Math.hypot(carrier.pos.x - actor.pos.x, carrier.pos.z - actor.pos.z);
        const rearDot =
          Math.sin(actor.rotY) * Math.sin(carrier.rotY) +
          Math.cos(actor.rotY) * Math.cos(carrier.rotY);
        if (dCarrier < 0.92 && dist > 1.38 && rearDot > 0.45) {
          actor.tackleTimer = 0;
          actor.vel.set(0, 0, 0);
          this.startSetPiece('free_kick', carrier.team, carrier.pos.x, carrier.pos.z, true);
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // TEAM TACTICAL PLAN & GEOMETRY HELPERS (ZERO-GC)
  // ------------------------------------------------------------------
  private updateTeamTacticalPlans(dt: number) {
    this.homeTacticalPlan.counterTimer = Math.max(0, this.homeTacticalPlan.counterTimer - dt);
    this.awayTacticalPlan.counterTimer = Math.max(0, this.awayTacticalPlan.counterTimer - dt);

    const owner = this.ballOwnerId
      ? this.actors.find((a) => a.id === this.ballOwnerId) ?? null
      : null;

    this.buildTeamTacticalPlan('home', owner, this.homeTacticalPlan);
    this.buildTeamTacticalPlan('away', owner, this.awayTacticalPlan);
  }

  private buildTeamTacticalPlan(
    team: TeamSide,
    owner: MatchActor | null,
    plan: TeamTacticalPlan,
  ) {
    const halfL = this.fieldLength / 2;
    const ownZSign = team === 'home' ? 1 : -1;
    const oppTeam: TeamSide = team === 'home' ? 'away' : 'home';

    if (owner) {
      plan.phase = owner.team === team ? 'attack' : 'defend';
    } else if (this.lastTouchActor?.team === team && this.lastKickerGraceTimer > 0) {
      plan.phase = 'attack';
    } else {
      plan.phase = 'loose';
    }

    // Structured team defensive line Z: anchors near formation depth and shifts modestly with ball
    const desiredLineZ = this.ballPos.z * 0.42 + ownZSign * (halfL * 0.28);
    const highestPushZ = ownZSign * 1.5;
    const deepestHoldZ = ownZSign * (halfL - 7.5);
    if (ownZSign > 0) {
      plan.defensiveLineZ = THREE.MathUtils.clamp(desiredLineZ, highestPushZ, deepestHoldZ);
    } else {
      plan.defensiveLineZ = THREE.MathUtils.clamp(desiredLineZ, deepestHoldZ, highestPushZ);
    }

    plan.presserId = null;
    plan.coverId = null;
    plan.markAssignments.clear();

    if (plan.phase === 'attack') {
      return;
    }

    // Pick STRICTLY ONE designated primary presser (nearest / in-zone goal-side defender)
    // All other teammates stay strictly anchored to their tactical zones (no ball-swarming).
    let bestPresser: MatchActor | null = null;
    let bestPresserCost = Infinity;
    for (const a of this.actors) {
      if (a.team !== team || a.role !== 'outfield') continue;
      const d = Math.hypot(a.pos.x - this.ballPos.x, a.pos.z - this.ballPos.z);
      const isGoalSide = ownZSign > 0 ? a.pos.z >= this.ballPos.z - 1.5 : a.pos.z <= this.ballPos.z + 1.5;
      const ballInZone =
        this.ballPos.x >= a.zoneMinX - 1.0 &&
        this.ballPos.x <= a.zoneMaxX + 1.0 &&
        this.ballPos.z >= a.zoneMinZ - 1.5 &&
        this.ballPos.z <= a.zoneMaxZ + 1.5;
      let cost = d - (isGoalSide ? 2.2 : 0) - (ballInZone ? 4.2 : 0);
      if (this.isHumanControlledActor(a) && d > 6.5) {
        cost += 5.5;
      }
      if (cost < bestPresserCost) {
        bestPresserCost = cost;
        bestPresser = a;
      }
    }
    plan.presserId = bestPresser?.id ?? null;

    // Second Defender Press (when actively called by human defending team)
    const secondDefActive =
      (team === 'home' ? this.homeSecondDefTimer : this.awaySecondDefTimer) > 0;
    if (secondDefActive) {
      let bestCover: MatchActor | null = null;
      let bestCoverDist = Infinity;
      for (const a of this.actors) {
        if (
          a.team !== team ||
          a.role !== 'outfield' ||
          this.isHumanControlledActor(a) ||
          a.id === plan.presserId
        ) {
          continue;
        }
        const d = Math.hypot(a.pos.x - this.ballPos.x, a.pos.z - this.ballPos.z);
        if (d < bestCoverDist) {
          bestCoverDist = d;
          bestCover = a;
        }
      }
      plan.coverId = bestCover?.id ?? null;
    }

    // Pair remaining AI defenders/midfielders ONLY to off-ball runners directly inside their own zone
    const ownGoalZ = ownZSign * halfL;
    this._tmpThreats.length = 0;
    for (const opp of this.actors) {
      if (opp.team !== oppTeam || opp.role !== 'outfield') continue;
      if (owner && opp.id === owner.id) continue;
      this._tmpThreats.push(opp);
    }
    this._tmpThreats.sort(
      (a, b) => Math.abs(a.pos.z - ownGoalZ) - Math.abs(b.pos.z - ownGoalZ),
    );

    this._tmpAssignedMarkers.clear();
    for (const threat of this._tmpThreats) {
      let bestMarker: MatchActor | null = null;
      let bestDist = Infinity;
      for (const a of this.actors) {
        if (
          a.team !== team ||
          a.role !== 'outfield' ||
          this.isHumanControlledActor(a) ||
          a.id === plan.presserId ||
          a.id === plan.coverId ||
          this._tmpAssignedMarkers.has(a.id)
        ) {
          continue;
        }
        // Strict quadrant handoff: only track runners directly inside this player's home zone
        const inZone =
          threat.pos.x >= a.zoneMinX - 1.2 &&
          threat.pos.x <= a.zoneMaxX + 1.2 &&
          threat.pos.z >= a.zoneMinZ - 1.8 &&
          threat.pos.z <= a.zoneMaxZ + 1.8;
        if (!inZone) continue;
        // Forwards hold attacking shape unless threat pushes deep
        if (a.tacticalRole === 'forward' && ownZSign * threat.pos.z < 6) continue;
        const d = Math.hypot(a.pos.x - threat.pos.x, a.pos.z - threat.pos.z);
        if (d < bestDist) {
          bestDist = d;
          bestMarker = a;
        }
      }
      if (bestMarker) {
        this._tmpAssignedMarkers.add(bestMarker.id);
        plan.markAssignments.set(bestMarker.id, threat.id);
      }
    }
  }

  /**
   * Minimum perpendicular distance from any opponent outfielder on `oppTeam`
   * to the line segment (x1, z1) -> (x2, z2), excluding endpoints.
   */
  private segmentClearanceToTeam(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    oppTeam: TeamSide,
  ): number {
    const vx = x2 - x1;
    const vz = z2 - z1;
    const lenSq = vx * vx + vz * vz;
    if (lenSq < 0.01) return 99;

    let minClearance = 99;
    for (const opp of this.actors) {
      if (opp.team !== oppTeam || opp.role !== 'outfield') continue;
      const wx = opp.pos.x - x1;
      const wz = opp.pos.z - z1;
      const t = (wx * vx + wz * vz) / lenSq;
      if (t < 0.08 || t > 0.96) continue;
      const projX = x1 + vx * t;
      const projZ = z1 + vz * t;
      const d = Math.hypot(opp.pos.x - projX, opp.pos.z - projZ);
      if (d < minClearance) minClearance = d;
    }
    return minClearance;
  }

  private nearestOpponentDist(px: number, pz: number, oppTeam: TeamSide): number {
    let minD = 99;
    for (const opp of this.actors) {
      if (opp.team !== oppTeam || opp.role !== 'outfield') continue;
      const d = Math.hypot(opp.pos.x - px, opp.pos.z - pz);
      if (d < minD) minD = d;
    }
    return minD;
  }

  // ------------------------------------------------------------------
  // AI LOGIC FOR TEAMMATES & OPPONENTS (TACTICAL & ORGANIC)
  // ------------------------------------------------------------------
  private stepAiActor(actor: MatchActor, dt: number) {
    if (actor.role === 'goalkeeper') {
      const zSign = actor.team === 'home' ? 1 : -1;
      const halfL = this.fieldLength / 2;
      const goalLineZ = zSign * (halfL - 2.2);
      const targetX = THREE.MathUtils.clamp(this.ballPos.x * 0.52, -3.9, 3.9);
      const targetZ = THREE.MathUtils.clamp(
        goalLineZ - zSign * Math.min(3.5, Math.max(0, (halfL - Math.abs(this.ballPos.z)) * 0.12)),
        zSign > 0 ? halfL - 7 : -halfL + 1.5,
        zSign > 0 ? halfL - 1.5 : -halfL + 7,
      );

      if (actor.diveTimer > 0) {
        actor.diveTimer -= dt;
        actor.vy -= 16 * dt;
        actor.pos.x += actor.vel.x * dt;
        actor.pos.y = Math.max(0, actor.pos.y + actor.vy * dt);
        if (actor.diveTimer <= 0) {
          actor.diveState = 'none';
          actor.pos.y = 0;
        }
      } else {
        const dx = targetX - actor.pos.x;
        const dz = targetZ - actor.pos.z;
        actor.vel.x = THREE.MathUtils.clamp(dx * 4.6, -5.6, 5.6);
        actor.vel.z = THREE.MathUtils.clamp(dz * 4.6, -5.6, 5.6);
        actor.pos.x += actor.vel.x * dt;
        actor.pos.z += actor.vel.z * dt;
        actor.rotY = Math.atan2(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);

        // AI GK dive reaction on fast incoming shots (balanced so corner shots can score)
        const ballMovingTowardGoal = zSign > 0 ? this.ballVel.z > 8.5 : this.ballVel.z < -8.5;
        const distToGoal = Math.abs(this.ballPos.z - goalLineZ);
        if (ballMovingTowardGoal && distToGoal < 10.5 && Math.abs(this.ballPos.x - actor.pos.x) > 1.35) {
          const diveDir = Math.sign(this.ballPos.x - actor.pos.x);
          actor.vel.set(diveDir * 8.8, 0, 0);
          actor.vy = 4.0;
          actor.diveTimer = 0.42;
          actor.diveState = diveDir < 0 ? 'left' : 'right';
          soccerAudio.playDiveWhoosh();
        }
      }

      // AI GK save collision (balanced for larger goal frame)
      const reach = actor.diveState !== 'none' ? 1.46 : 1.02;
      const dist = Math.hypot(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);
      if (dist < reach && this.ballPos.y < 2.25) {
        const incomingSpeed = this.ballVel.length();
        this.recordBallTouch(actor);
        if (actor.team === 'home') this.matchStats.homeSaves += 1;
        else this.matchStats.awaySaves += 1;
        this.ballOwnerId = null;
        this.ballVel.set((Math.random() - 0.5) * 14, 5.2, -zSign * 16);
        this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 8);
        soccerAudio.playKick(0.85);
        if (incomingSpeed > 11 && this.saveSnapshotCooldown <= 0) {
          this.saveSnapshotCooldown = 3.2;
          this.queueKeyPlaySnapshot(
            'save',
            actor.team,
            actor.jerseyText,
            'KEEPER DENIAL',
            `#${actor.jerseyNumber} ${actor.jerseyText} • ${actor.diveState === 'none' ? 'Point-Blank Stop' : 'Flying Parry'}`,
          );
        }
      }
      return;
    }

    // Active AI Slide Tackle Lunge
    if (actor.tackleTimer > 0) {
      actor.tackleTimer -= dt;
      actor.pos.x += actor.vel.x * dt;
      actor.pos.z += actor.vel.z * dt;
      actor.vel.multiplyScalar(Math.max(0, 1 - 4.5 * dt));
      this.clampToPitch(actor.pos);
      this.tryWinBallOnTackle(actor);
      return;
    }

    actor.aiThinkTimer = Math.max(0, actor.aiThinkTimer - dt);
    actor.aiTackleCooldown = Math.max(0, actor.aiTackleCooldown - dt);
    actor.aiActionCooldown = Math.max(0, actor.aiActionCooldown - dt);
    actor.aiSprintCooldown = Math.max(0, actor.aiSprintCooldown - dt);
    actor.aiStrafeTimer -= dt;
    if (actor.aiStrafeTimer <= 0) {
      actor.aiStrafeTimer = 2.8 + Math.random() * 1.6;
      actor.aiStrafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    const tuning = AI_DIFFICULTY_TUNINGS[this.aiDifficulty];
    const halfW = this.fieldWidth / 2;
    const halfL = this.fieldLength / 2;
    const oppTeam: TeamSide = actor.team === 'home' ? 'away' : 'home';
    const attackZ = actor.team === 'home' ? -1 : 1;
    const ownZSign = -attackZ;
    const oppGoalZ = attackZ * halfL;
    const plan = actor.team === 'home' ? this.homeTacticalPlan : this.awayTacticalPlan;

    const hasBall = this.ballOwnerId === actor.id;
    actor.aiCarryTimer = hasBall ? actor.aiCarryTimer + dt : 0;

    // Helper: enforce 3-tier sprint budget (~30% max sprint duty cycle, ~70% walk/jog)
    const resolveSprintBudget = (wantsSprint: boolean): boolean => {
      if (!wantsSprint || actor.stamina <= 34) {
        if (actor.aiSprintTimer > 0) {
          actor.aiSprintTimer = 0;
          actor.aiSprintCooldown = Math.max(actor.aiSprintCooldown, 3.2);
        }
        return false;
      }
      if (actor.aiSprintCooldown > 0) {
        return false;
      }
      actor.aiSprintTimer += dt;
      if (actor.aiSprintTimer >= 2.0) {
        // After a ~2s sprint burst, recover at walk/jog pace for ~4.2s (~30% sprint ratio)
        actor.aiSprintTimer = 0;
        actor.aiSprintCooldown = 4.2;
        return false;
      }
      return true;
    };

    // ----------------------------------------------------------------
    // 1. BALL CARRIER: PROGRESSIVE INTENT, FINAL-THIRD URGENCY & 50/30/20 BOX MATRIX
    // ----------------------------------------------------------------
    if (hasBall) {
      let nearestOpp: MatchActor | null = null;
      let nearestOppDist = 99;
      let threatsAheadCount = 0;

      for (const opp of this.actors) {
        if (opp.team !== oppTeam || opp.role !== 'outfield') continue;
        const d = Math.hypot(opp.pos.x - actor.pos.x, opp.pos.z - actor.pos.z);
        if (d < nearestOppDist) {
          nearestOppDist = d;
          nearestOpp = opp;
        }
        const aheadDz = attackZ * (opp.pos.z - actor.pos.z);
        if (aheadDz > -0.4 && aheadDz < 8.0 && Math.abs(opp.pos.x - actor.pos.x) < 4.0) {
          threatsAheadCount += 1;
        }
      }

      const inOppHalf = attackZ * actor.pos.z >= 0;
      const distToGoal = Math.hypot(actor.pos.x * 0.7, oppGoalZ - actor.pos.z);
      const inFinalThird = attackZ * actor.pos.z >= halfL * 0.34 || distToGoal <= 25.0;
      const inScoringBox = distToGoal <= 19.5;
      const isCounterAttack = plan.counterTimer > 0;

      const underPressure = nearestOppDist < 4.8;
      const immediateDanger = nearestOppDist < 2.4;
      const mustReleaseOnClock =
        (actor.aiCarryTimer >= 2.1 && underPressure) ||
        (actor.aiCarryTimer >= 2.85 && (nearestOppDist < 6.5 || threatsAheadCount > 0));
      const inOwnBoxDanger = ownZSign * actor.pos.z > halfL - 16.5 && nearestOppDist < 3.8;

      // Re-evaluate Shoot vs Grounded / Through / Box Cross vs Attacking Dribble
      if (
        actor.aiActionCooldown <= 0 &&
        (actor.aiThinkTimer <= 0 || immediateDanger || mustReleaseOnClock)
      ) {
        actor.aiThinkTimer = tuning.thinkInterval * (0.85 + Math.random() * 0.35);

        // A. Evaluate Shot Score (Prioritized inside 20-25m & inside the box)
        let shootScore = -1;
        let shotAimX = 0;
        let shotClearance = 0;

        if (distToGoal < 26.5) {
          const oppGk = this.actors.find((a) => a.team === oppTeam && a.role === 'goalkeeper');
          const gkX = oppGk ? oppGk.pos.x : 0;
          const preferredCornerX = gkX >= 0 ? -3.45 : 3.45;
          const jitter = (1 - tuning.shotPrecision) * (Math.random() - 0.5) * 2.6;
          shotAimX = THREE.MathUtils.clamp(preferredCornerX + jitter, -4.1, 4.1);

          shotClearance = this.segmentClearanceToTeam(
            this.ballPos.x,
            this.ballPos.z,
            shotAimX,
            oppGoalZ,
            oppTeam,
          );
          const distFactor = THREE.MathUtils.clamp((26.5 - distToGoal) / 14.5, 0, 1.45);
          const laneBonus = shotClearance > 1.05 ? 0.45 : shotClearance < 0.7 ? -0.45 : 0.1;
          const anglePenalty = Math.abs(actor.pos.x) > halfW * 0.65 && distToGoal > 12 ? -0.32 : 0;
          shootScore =
            distFactor * 0.96 +
            laneBonus +
            anglePenalty +
            (inFinalThird ? 0.18 : 0) +
            (underPressure ? 0.14 : 0);
        }

        // B. Evaluate Pass Options (Progressive Play, Anti-Ping-Pong, Box Through/Cross)
        let bestPassScore = -1;
        let bestPassMate: MatchActor | null = null;
        let bestPassKind: 'grounded' | 'through' | 'lofted' = 'grounded';
        let bestPassX = 0;
        let bestPassZ = 0;

        let bestBoxSetupScore = -1;
        let bestBoxSetupMate: MatchActor | null = null;
        let bestBoxSetupKind: 'through' | 'lofted' = 'through';
        let bestBoxSetupX = 0;
        let bestBoxSetupZ = 0;

        const isRecentPassSource = (mateId: string) =>
          Boolean(
            this.prevTouchActor &&
              this.prevTouchActor.id === mateId &&
              this.matchElapsedTime - this.prevTouchActor.time < 2.8,
          );

        for (const mate of this.actors) {
          if (mate.team !== actor.team || mate.id === actor.id || mate.role !== 'outfield') {
            continue;
          }
          const dx = mate.pos.x - actor.pos.x;
          const dz = mate.pos.z - actor.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 3.8 || dist > tuning.passVisionRange) continue;

          const forwardGain = attackZ * dz;
          const mateOpenness = this.nearestOpponentDist(mate.pos.x, mate.pos.z, oppTeam);
          const groundLaneClear = this.segmentClearanceToTeam(
            actor.pos.x,
            actor.pos.z,
            mate.pos.x,
            mate.pos.z,
            oppTeam,
          );
          const pingPongPenalty = !inOwnBoxDanger && isRecentPassSource(mate.id) ? -0.58 : 0;

          // 1) Grounded Pass (S): Progressive build-up; suppress sideways/backwards loops in opp half
          let progressBias = 0;
          if (inFinalThird) {
            if (forwardGain < -1.5) progressBias = -0.95;
            else if (forwardGain < 3.2) progressBias = underPressure ? -0.45 : -0.72;
            else progressBias = 0.25;
          } else if (inOppHalf) {
            if (forwardGain < -1.5) progressBias = -0.68;
            else if (forwardGain < 3.0 && !underPressure) progressBias = -0.42;
            else if (forwardGain > 5.0) progressBias = 0.28;
          } else {
            // Own half: advance forward cleanly; only recycle sideways/back under genuine pressure
            if (forwardGain > 5.0) progressBias = isCounterAttack ? 0.38 : 0.24;
            else if (forwardGain < 2.0 && !underPressure) progressBias = -0.34;
          }

          const safetyOutletBonus =
            !inOppHalf && (underPressure || threatsAheadCount > 0) && groundLaneClear > 1.35
              ? 0.22
              : 0;

          const groundScore =
            (groundLaneClear > 1.4 ? 0.66 : groundLaneClear > 1.0 ? 0.3 : -0.45) +
            THREE.MathUtils.clamp((mateOpenness - 1.5) * 0.12, -0.2, 0.38) +
            THREE.MathUtils.clamp(forwardGain * 0.025, -0.06, 0.36) +
            progressBias +
            safetyOutletBonus +
            pingPongPenalty +
            (underPressure ? 0.24 : 0) +
            (mustReleaseOnClock ? 0.32 : 0) -
            (dist > 26 ? 0.3 : 0);

          if (groundScore > bestPassScore) {
            bestPassScore = groundScore;
            bestPassMate = mate;
            bestPassKind = 'grounded';
            bestPassX = mate.pos.x + mate.vel.x * 0.15;
            bestPassZ = mate.pos.z + mate.vel.z * 0.15;
          }

          // 2) Through Pass (W): Incisive forward ball into space (prioritized on counters & final third)
          if (dist >= 6.5 && dist <= 40 && forwardGain > (inOppHalf ? 2.0 : 4.5)) {
            const mateSpeed = Math.hypot(mate.vel.x, mate.vel.z);
            const leadX = THREE.MathUtils.clamp(
              mate.pos.x + mate.vel.x * 0.38,
              -halfW + 2.5,
              halfW - 2.5,
            );
            const leadZ = THREE.MathUtils.clamp(
              mate.pos.z + mate.vel.z * 0.38 + attackZ * (2.8 + mateSpeed * 0.14),
              -halfL + 3.0,
              halfL - 3.0,
            );
            const leadSpace = this.nearestOpponentDist(leadX, leadZ, oppTeam);
            const throughClear = this.segmentClearanceToTeam(
              actor.pos.x,
              actor.pos.z,
              leadX,
              leadZ,
              oppTeam,
            );
            const roleBonus =
              mate.tacticalRole === 'forward' ||
              mate.formationRole === 'lw' ||
              mate.formationRole === 'rw'
                ? 0.28
                : mate.tacticalRole === 'midfielder'
                  ? 0.1
                  : -0.25;
            const throughScore =
              (throughClear > 1.25 ? 0.64 : throughClear > 0.9 ? 0.24 : -0.45) +
              THREE.MathUtils.clamp((leadSpace - 1.9) * 0.14, -0.2, 0.44) +
              THREE.MathUtils.clamp(forwardGain * 0.034, 0, 0.42) +
              roleBonus +
              pingPongPenalty +
              (isCounterAttack ? 0.28 : 0) +
              (inFinalThird ? 0.24 : 0) +
              (mateSpeed > 3.5 ? 0.16 : 0) +
              (mustReleaseOnClock ? 0.25 : 0);

            if (throughScore > bestPassScore) {
              bestPassScore = throughScore;
              bestPassMate = mate;
              bestPassKind = 'through';
              bestPassX = leadX;
              bestPassZ = leadZ;
            }
            if (throughScore > bestBoxSetupScore && attackZ * leadZ > halfL * 0.28) {
              bestBoxSetupScore = throughScore;
              bestBoxSetupMate = mate;
              bestBoxSetupKind = 'through';
              bestBoxSetupX = leadX;
              bestBoxSetupZ = leadZ;
            }
          }

          // 3) Lofted Pass / Box Cross (A):
          //    Strictly restricted to: (a) Long flank switch > 25m, (b) Own-box clearance,
          //    OR (c) Wide final-third cross into a striker/winger attacking the central penalty box
          const isLongFlankSwitch =
            dist > 25.0 &&
            Math.abs(dx) > halfW * 0.55 &&
            mateOpenness > 4.2 &&
            groundLaneClear < 1.35;
          const isDefensiveClearance =
            inOwnBoxDanger &&
            forwardGain > 16.0 &&
            dist > 16.0 &&
            groundLaneClear < 1.35;
          const isWingBoxCross =
            inFinalThird &&
            Math.abs(actor.pos.x) > halfW * 0.44 &&
            Math.abs(mate.pos.x) < 7.0 &&
            attackZ * mate.pos.z > halfL * 0.42 &&
            dist >= 8.5;

          if (
            (isLongFlankSwitch || isDefensiveClearance || isWingBoxCross) &&
            dist <= tuning.passVisionRange
          ) {
            const loftX = isWingBoxCross
              ? THREE.MathUtils.clamp(mate.pos.x + mate.vel.x * 0.25, -5.5, 5.5)
              : mate.pos.x + mate.vel.x * 0.38;
            const loftZ = isWingBoxCross
              ? THREE.MathUtils.clamp(oppGoalZ - attackZ * 7.5, -halfL + 4.0, halfL - 4.0)
              : mate.pos.z + mate.vel.z * 0.38 + attackZ * 1.0;
            const loftScore =
              0.44 +
              THREE.MathUtils.clamp((mateOpenness - 2.2) * 0.12, -0.15, 0.36) +
              (isDefensiveClearance ? 0.58 : isWingBoxCross ? 0.34 : 0.24);

            if (loftScore > bestPassScore) {
              bestPassScore = loftScore;
              bestPassMate = mate;
              bestPassKind = 'lofted';
              bestPassX = loftX;
              bestPassZ = loftZ;
            }
            if (isWingBoxCross && loftScore > bestBoxSetupScore) {
              bestBoxSetupScore = loftScore;
              bestBoxSetupMate = mate;
              bestBoxSetupKind = 'lofted';
              bestBoxSetupX = loftX;
              bestBoxSetupZ = loftZ;
            }
          }
        }

        // C. Evaluate Continue Dribble Score (Aggressive forward carry on counters & in opponent half)
        const dribbleSpaceBonus =
          nearestOppDist > 5.8 && threatsAheadCount === 0
            ? 0.52
            : nearestOppDist > 3.6 && threatsAheadCount <= 1
              ? 0.22
              : -0.4;
        const carryDecay = Math.max(0, actor.aiCarryTimer - 1.7) * 0.24;
        const dribbleScore =
          0.56 +
          dribbleSpaceBonus +
          (isCounterAttack ? 0.26 : inOppHalf ? 0.16 : 0) -
          threatsAheadCount * 0.18 -
          carryDecay -
          (mustReleaseOnClock ? 0.65 : 0) +
          (actor.tacticalRole === 'forward' && !mustReleaseOnClock ? 0.08 : 0);

        // D. Opponent Box Decision Matrix (50% Shoot / 30% Through-Pass or Cross / 20% Dribble)
        if (inScoringBox && (shootScore > 0.45 || shotClearance > 0.9)) {
          const canShootCleanly = distToGoal <= 19.5 && (shootScore > 0.42 || shotClearance > 0.85);
          const hasBoxSetup = Boolean(bestBoxSetupMate && bestBoxSetupScore > 0.42);
          const roll = Math.random();

          if (roll < 0.5 && canShootCleanly) {
            const power = THREE.MathUtils.clamp(23.0 + (24 - distToGoal) * 0.22, 22.5, 27.6);
            this.executeShotKick(actor, shotAimX, power, true);
            actor.aiCarryTimer = 0;
            return;
          }

          if (roll < 0.8 && hasBoxSetup && bestBoxSetupMate) {
            this.executePassToTargetCoords(
              actor,
              bestBoxSetupX,
              bestBoxSetupZ,
              bestBoxSetupKind,
              bestBoxSetupMate,
              true,
            );
            actor.aiCarryTimer = 0;
            return;
          }

          if (roll >= 0.8 && !immediateDanger && distToGoal > 7.5) {
            // 20%: Commit to a decisive 0.5s dribble past defender toward goal before shooting
            actor.aiThinkTimer = 0.5;
          } else if (canShootCleanly) {
            const power = THREE.MathUtils.clamp(23.0 + (24 - distToGoal) * 0.22, 22.5, 27.6);
            this.executeShotKick(actor, shotAimX, power, true);
            actor.aiCarryTimer = 0;
            return;
          }
        }

        // Final Third (20-25m) Shooting & Penetrative Priority
        if (shootScore > 0.66 && shootScore >= bestPassScore && shootScore >= dribbleScore) {
          const power = THREE.MathUtils.clamp(22.8 + (24 - distToGoal) * 0.22, 22.2, 27.4);
          this.executeShotKick(actor, shotAimX, power, true);
          actor.aiCarryTimer = 0;
          return;
        }

        if (
          bestPassMate &&
          (mustReleaseOnClock ? bestPassScore > 0.32 : bestPassScore > 0.64 && bestPassScore >= dribbleScore)
        ) {
          this.executePassToTargetCoords(
            actor,
            bestPassX,
            bestPassZ,
            bestPassKind,
            bestPassMate,
            true,
          );
          actor.aiCarryTimer = 0;
          return;
        }
      }

      // Smooth, Purposeful Attacking Dribbling Flow
      const distGoalZ = Math.abs(oppGoalZ - actor.pos.z);
      const nearCornerOrSideline =
        Math.abs(actor.pos.x) > halfW - 4.2 || attackZ * actor.pos.z > halfL - 6.8;
      const blockedAhead =
        (threatsAheadCount > 0 && nearestOppDist < 4.2 && !inScoringBox) ||
        (nearCornerOrSideline && nearestOppDist < 4.8);

      let steerX = 0;
      let steerZ = 0;
      let dribbleTier: 'walk' | 'jog' | 'sprint' = 'jog';

      if (blockedAhead && nearestOpp) {
        // Shield ball & angle inward toward central support / box instead of running into corner flag
        const awayX = actor.pos.x - nearestOpp.pos.x;
        const awayZ = actor.pos.z - nearestOpp.pos.z;
        const awayLen = Math.max(0.1, Math.hypot(awayX, awayZ));
        const inwardX = -Math.sign(actor.pos.x || 1) * 0.72;
        const safetyZ = inOppHalf ? -attackZ * 0.35 : -attackZ * 0.72;
        steerX = (awayX / awayLen) * 0.55 + inwardX * 0.65;
        steerZ = (awayZ / awayLen) * 0.4 + safetyZ * 0.55;
        dribbleTier = 'walk';
      } else {
        // Vertical attacking drive into goal channel (narrower inside final third for shooting sightlines)
        const goalChannelX =
          distGoalZ < 20
            ? THREE.MathUtils.clamp(actor.pos.x * 0.42, -4.2, 4.2)
            : THREE.MathUtils.clamp(actor.pos.x * 0.84, -halfW * 0.56, halfW * 0.56);
        steerX = goalChannelX - actor.pos.x;
        steerZ = oppGoalZ - actor.pos.z;
        const baseLen = Math.max(0.01, Math.hypot(steerX, steerZ));
        steerX /= baseLen;
        steerZ /= baseLen;

        if (nearestOpp && nearestOppDist < 5.2 && nearestOppDist > 0.1) {
          const weight = (5.2 - nearestOppDist) / 5.2;
          const awayX = (actor.pos.x - nearestOpp.pos.x) / nearestOppDist;
          const awayZ = (actor.pos.z - nearestOpp.pos.z) / nearestOppDist;
          steerX += awayX * weight * 0.72;
          steerZ += awayZ * weight * 0.2;
        }

        if (Math.abs(actor.pos.x) > halfW - 4.0) {
          steerX -= Math.sign(actor.pos.x) * 0.85;
        }

        const isBreakawayDribble =
          (nearestOppDist > 7.5 && threatsAheadCount === 0 && attackZ * actor.pos.z > -6.0) ||
          (isCounterAttack && threatsAheadCount === 0 && nearestOppDist > 4.6);
        const sprinting = resolveSprintBudget(isBreakawayDribble);
        dribbleTier = sprinting ? 'sprint' : nearestOppDist < 3.2 ? 'walk' : 'jog';
      }

      if (dribbleTier === 'sprint') {
        actor.stamina = Math.max(0, actor.stamina - 18 * dt);
      } else {
        actor.stamina = Math.min(100, actor.stamina + (dribbleTier === 'walk' ? 16 : 11) * dt);
      }

      const aiFatigue = actor.stamina < 25 ? 0.82 + 0.18 * (actor.stamina / 25) : 1;
      const dribbleSpeed =
        (dribbleTier === 'sprint'
          ? 10.6 * tuning.sprintScale
          : dribbleTier === 'walk'
            ? 5.0 * tuning.speedScale
            : (isCounterAttack || inOppHalf ? 7.8 : 7.2) * tuning.speedScale) * aiFatigue;

      const sLen = Math.max(0.01, Math.hypot(steerX, steerZ));
      actor.vel.x = THREE.MathUtils.damp(actor.vel.x, (steerX / sLen) * dribbleSpeed, 5.6, dt);
      actor.vel.z = THREE.MathUtils.damp(actor.vel.z, (steerZ / sLen) * dribbleSpeed, 5.6, dt);
      actor.pos.x += actor.vel.x * dt;
      actor.pos.z += actor.vel.z * dt;
      actor.rotY = this.dampAngle(actor.rotY, Math.atan2(actor.vel.x, actor.vel.z), 8.2, dt);
      this.clampToPitch(actor.pos);
      return;
    }

    // ----------------------------------------------------------------
    // 2. OFF-THE-BALL MOVEMENT: PENETRATIVE ATTACK RUNS & ZONAL ANCHORS
    // ----------------------------------------------------------------
    let desiredSpeed = 4.6 * tuning.speedScale; // Default tier: Walk
    let shouldSprint = false;

    if (plan.phase === 'attack') {
      const isCounterAttack = plan.counterTimer > 0;
      const ballInOppHalf = attackZ * this.ballPos.z >= 0;

      if (actor.aiThinkTimer <= 0) {
        actor.aiThinkTimer = tuning.thinkInterval * (isCounterAttack ? 0.9 : 1.2);
        const carrier = this.ballOwnerId
          ? this.actors.find((a) => a.id === this.ballOwnerId)
          : null;
        const anchorX = carrier ? carrier.pos.x : this.ballPos.x;
        const anchorZ = carrier ? carrier.pos.z : this.ballPos.z;

        let tx = actor.homePos.x;
        let tz = actor.homePos.z;

        if (actor.formationRole === 'lw' || actor.formationRole === 'lb') {
          const isWinger = actor.formationRole === 'lw';
          // Wingers drive aggressively behind defensive line & tuck toward box when ball enters final third
          const wingTargetX =
            isWinger && ballInOppHalf
              ? -halfW * 0.46
              : actor.homePos.x * 0.72 - halfW * (isWinger ? 0.2 : 0.14);
          tx = THREE.MathUtils.clamp(wingTargetX, actor.zoneMinX, actor.zoneMaxX);
          const forwardPush = isWinger ? (isCounterAttack ? 16.5 : 13.0) : -4.0;
          tz = THREE.MathUtils.clamp(
            isWinger
              ? anchorZ + attackZ * forwardPush
              : actor.homePos.z * 0.45 + anchorZ * 0.55 + attackZ * forwardPush,
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
        } else if (actor.formationRole === 'rw' || actor.formationRole === 'rb') {
          const isWinger = actor.formationRole === 'rw';
          const wingTargetX =
            isWinger && ballInOppHalf
              ? halfW * 0.46
              : actor.homePos.x * 0.72 + halfW * (isWinger ? 0.2 : 0.14);
          tx = THREE.MathUtils.clamp(wingTargetX, actor.zoneMinX, actor.zoneMaxX);
          const forwardPush = isWinger ? (isCounterAttack ? 16.5 : 13.0) : -4.0;
          tz = THREE.MathUtils.clamp(
            isWinger
              ? anchorZ + attackZ * forwardPush
              : actor.homePos.z * 0.45 + anchorZ * 0.55 + attackZ * forwardPush,
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
        } else if (actor.formationRole === 'st') {
          // Striker makes direct penetrative runs behind the defensive line into scoring channels
          const balanceX =
            anchorX > 4.0 ? -halfW * 0.24 : anchorX < -4.0 ? halfW * 0.24 : actor.homePos.x;
          tx = THREE.MathUtils.clamp(balanceX, actor.zoneMinX, actor.zoneMaxX);
          const strikerPush = isCounterAttack ? 18.0 : 14.5;
          tz = THREE.MathUtils.clamp(
            anchorZ + attackZ * strikerPush,
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
        } else if (actor.formationRole === 'cm') {
          // CM supports forward progression cleanly behind strikers/wingers
          const sideSign = actor.pos.x >= anchorX ? 1 : -1;
          tx = THREE.MathUtils.clamp(
            actor.homePos.x * 0.55 + sideSign * 4.5,
            actor.zoneMinX,
            actor.zoneMaxX,
          );
          tz = THREE.MathUtils.clamp(
            actor.homePos.z * 0.42 + anchorZ * 0.58 + attackZ * (isCounterAttack ? 7.5 : 4.5),
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
        } else {
          // CB stays anchored in defensive half behind the play
          tx = THREE.MathUtils.clamp(
            actor.homePos.x * 0.78 + anchorX * 0.22,
            actor.zoneMinX,
            actor.zoneMaxX,
          );
          tz = THREE.MathUtils.clamp(
            actor.homePos.z * 0.6 + (anchorZ - attackZ * 11.0) * 0.4,
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
        }

        // Enforce >= 8.5m spread away from carrier and >= 7.5m away from teammates
        if (carrier && carrier.id !== actor.id) {
          const cdx = tx - anchorX;
          const cdz = tz - anchorZ;
          const cd = Math.hypot(cdx, cdz);
          if (cd < 8.5) {
            const awayX = cd > 0.1 ? cdx / cd : actor.homePos.x >= 0 ? 1 : -1;
            const awayZ = cd > 0.1 ? cdz / cd : attackZ * 0.55;
            tx = THREE.MathUtils.clamp(anchorX + awayX * 8.8, actor.zoneMinX, actor.zoneMaxX);
            tz = THREE.MathUtils.clamp(anchorZ + awayZ * 8.8, actor.zoneMinZ, actor.zoneMaxZ);
          }
        }

        for (const mate of this.actors) {
          if (mate.team !== actor.team || mate.id === actor.id || mate.role !== 'outfield') {
            continue;
          }
          const mdx = tx - mate.pos.x;
          const mdz = tz - mate.pos.z;
          const md = Math.hypot(mdx, mdz);
          if (md < 7.5 && md > 0.05) {
            const push = (7.5 - md) * 0.85;
            tx += (mdx / md) * push;
            tz += (mdz / md) * push;
          }
        }

        actor.aiTargetPos.set(
          THREE.MathUtils.clamp(tx, actor.zoneMinX, actor.zoneMaxX),
          0,
          THREE.MathUtils.clamp(tz, actor.zoneMinZ, actor.zoneMaxZ),
        );
      }

      const dTarget = Math.hypot(
        actor.aiTargetPos.x - actor.pos.x,
        actor.aiTargetPos.z - actor.pos.z,
      );
      const isAttacker =
        actor.tacticalRole === 'forward' ||
        actor.formationRole === 'lw' ||
        actor.formationRole === 'rw';
      const breakawaySpace =
        isAttacker &&
        dTarget > (isCounterAttack ? 6.5 : 8.5) &&
        (isCounterAttack ||
          (this.nearestOpponentDist(actor.aiTargetPos.x, actor.aiTargetPos.z, oppTeam) > 3.6 &&
            attackZ * actor.aiTargetPos.z > -3.0));

      shouldSprint = resolveSprintBudget(breakawaySpace);
      desiredSpeed = shouldSprint
        ? 10.7 * tuning.sprintScale
        : dTarget > 5.0
          ? (isCounterAttack && isAttacker ? 7.8 : 7.0) * tuning.speedScale // Jog / fast vertical break
          : 4.6 * tuning.speedScale; // Walk
    } else {
      // DEFENDING / LOOSE BALL PHASE (Only SINGLE Presser Leaves Anchor; Everyone Else Holds Zone)
      const ballSpeed = Math.hypot(this.ballVel.x, this.ballVel.z);
      let intercepting = false;

      // 2A. Pass Interception: ONLY single presser OR if moving ball passes within 2.6m inside own zone
      if (!this.ballOwnerId && ballSpeed > 3.2 && this.ballPos.y < 1.65) {
        const relX = actor.pos.x - this.ballPos.x;
        const relZ = actor.pos.z - this.ballPos.z;
        const tInt = THREE.MathUtils.clamp(
          (relX * this.ballVel.x + relZ * this.ballVel.z) / (ballSpeed * ballSpeed),
          0.04,
          0.68,
        );
        const ix = THREE.MathUtils.clamp(
          this.ballPos.x + this.ballVel.x * tInt,
          -halfW + 1.5,
          halfW - 1.5,
        );
        const iz = THREE.MathUtils.clamp(
          this.ballPos.z + this.ballVel.z * tInt,
          -halfL + 1.5,
          halfL - 1.5,
        );
        const dInt = Math.hypot(ix - actor.pos.x, iz - actor.pos.z);
        const interceptInsideZone =
          ix >= actor.zoneMinX - 1.0 &&
          ix <= actor.zoneMaxX + 1.0 &&
          iz >= actor.zoneMinZ - 1.5 &&
          iz <= actor.zoneMaxZ + 1.5;

        const isSecondPress = actor.id === plan.coverId;
        if (
          actor.id === plan.presserId ||
          isSecondPress ||
          (interceptInsideZone && dInt < Math.min(tuning.interceptionRange, 2.8))
        ) {
          actor.aiTargetPos.set(ix, 0, iz);
          intercepting = true;
          shouldSprint = resolveSprintBudget(
            (actor.id === plan.presserId || isSecondPress) && dInt > 2.5 && dInt < 14.0,
          );
          desiredSpeed = shouldSprint
            ? 10.8 * tuning.sprintScale
            : dInt > 4.5
              ? 7.3 * tuning.speedScale
              : 5.0 * tuning.speedScale;
        }
      }

      if (!intercepting) {
        const markTargetId = plan.markAssignments.get(actor.id);

        if (actor.id === plan.presserId || actor.id === plan.coverId) {
          // 2B. Primary Presser or Called 2nd Defender closes down the ball
          const isSecond = actor.id === plan.coverId;
          const coverSideX = isSecond
            ? (actor.pos.x >= this.ballPos.x ? 1 : -1) * 0.85
            : 0;
          const goalSideZ = THREE.MathUtils.clamp(
            this.ballPos.z + ownZSign * (isSecond ? 1.15 : 0.65),
            -halfL + 1.5,
            halfL - 1.5,
          );
          actor.aiTargetPos.set(
            THREE.MathUtils.clamp(this.ballPos.x + coverSideX, -halfW + 1.5, halfW - 1.5),
            0,
            goalSideZ,
          );

          const dBall = Math.hypot(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);
          const owner = this.ballOwnerId
            ? this.actors.find((a) => a.id === this.ballOwnerId)
            : null;
          const ownerSpeed = owner ? Math.hypot(owner.vel.x, owner.vel.z) : 0;
          const wantsUrgentPress =
            isSecond ||
            (!this.ballOwnerId && dBall > 2.5 && dBall < 15.0) ||
            (ownerSpeed > 8.6 && dBall > 4.2 && dBall < 14.0);

          shouldSprint = resolveSprintBudget(wantsUrgentPress);
          desiredSpeed = shouldSprint
            ? 10.9 * tuning.sprintScale * Math.min(1.04, tuning.pressAggression + 0.05)
            : dBall > 4.2
              ? 7.4 * tuning.speedScale // Steady jog closure
              : 5.2 * tuning.speedScale; // Controlled jockey when close

          // Timed tackle only from clean front/side angle
          if (
            this.ballOwnerId &&
            dBall < 1.9 &&
            this.ballPos.y < 1.1 &&
            actor.aiTackleCooldown <= 0
          ) {
            const toBallX = (this.ballPos.x - actor.pos.x) / Math.max(0.1, dBall);
            const toBallZ = (this.ballPos.z - actor.pos.z) / Math.max(0.1, dBall);
            const frontOrSideApproach =
              !owner ||
              toBallX * Math.sin(owner.rotY) + toBallZ * Math.cos(owner.rotY) < 0.52;

            if (frontOrSideApproach && Math.random() < tuning.tackleChance * dt * (isSecond ? 5.2 : 4.2)) {
              actor.rotY = Math.atan2(toBallX, toBallZ);
              actor.aiTackleCooldown = tuning.tackleCooldown * (0.9 + Math.random() * 0.35);
              this.performSlideTackle(actor, true);
              return;
            }
          }
        } else if (markTargetId) {
          // 2C. Zonal Lane Coverage: shadow runner strictly inside own home zone (no chasing out of zone)
          const threat = this.actors.find((a) => a.id === markTargetId);
          if (threat) {
            const laneDx = this.ballPos.x - threat.pos.x;
            const laneDz = this.ballPos.z - threat.pos.z;
            const laneLen = Math.max(0.5, Math.hypot(laneDx, laneDz));
            const markX = THREE.MathUtils.clamp(
              actor.homePos.x * 0.35 + (threat.pos.x + (laneDx / laneLen) * 1.1) * 0.65,
              actor.zoneMinX,
              actor.zoneMaxX,
            );
            const markZ = THREE.MathUtils.clamp(
              threat.pos.z + ownZSign * 2.2 + (laneDz / laneLen) * 0.7,
              actor.zoneMinZ,
              actor.zoneMaxZ,
            );
            actor.aiTargetPos.set(markX, 0, markZ);

            const threatSpeed = Math.hypot(threat.vel.x, threat.vel.z);
            const dMark = Math.hypot(markX - actor.pos.x, markZ - actor.pos.z);
            const urgentTrack = threatSpeed > 8.8 && dMark > 4.5 && dMark < 13.0;
            shouldSprint = resolveSprintBudget(urgentTrack);
            desiredSpeed = shouldSprint
              ? 10.5 * tuning.sprintScale
              : dMark > 5.0
                ? 7.0 * tuning.speedScale
                : 4.6 * tuning.speedScale;
          }
        } else {
          // 2D. Strict Zonal Home Anchor: hold formation spot with subtle compact shift
          const lineOffset =
            actor.tacticalRole === 'defender'
              ? 0
              : actor.tacticalRole === 'midfielder'
                ? -ownZSign * 8.0
                : -ownZSign * 16.0;
          const zoneX = THREE.MathUtils.clamp(
            actor.homePos.x * 0.85 + this.ballPos.x * 0.15,
            actor.zoneMinX,
            actor.zoneMaxX,
          );
          const zoneZ = THREE.MathUtils.clamp(
            actor.homePos.z * 0.55 + (plan.defensiveLineZ + lineOffset) * 0.45,
            actor.zoneMinZ,
            actor.zoneMaxZ,
          );
          actor.aiTargetPos.set(zoneX, 0, zoneZ);
          resolveSprintBudget(false);
          const dHome = Math.hypot(zoneX - actor.pos.x, zoneZ - actor.pos.z);
          desiredSpeed = dHome > 6.0 ? 6.8 * tuning.speedScale : 4.5 * tuning.speedScale;
        }
      }
    }

    if (shouldSprint) {
      actor.stamina = Math.max(0, actor.stamina - 20 * dt);
    } else {
      actor.stamina = Math.min(100, actor.stamina + (desiredSpeed < 5.5 ? 16 : 11) * dt);
    }

    const aiFatigue = actor.stamina < 25 ? 0.82 + 0.18 * (actor.stamina / 25) : 1;
    const effDesiredSpeed = desiredSpeed * aiFatigue;

    const dx = actor.aiTargetPos.x - actor.pos.x;
    const dz = actor.aiTargetPos.z - actor.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.55) {
      actor.vel.x = THREE.MathUtils.damp(actor.vel.x, (dx / dist) * effDesiredSpeed, 6.2, dt);
      actor.vel.z = THREE.MathUtils.damp(actor.vel.z, (dz / dist) * effDesiredSpeed, 6.2, dt);
      actor.rotY = this.dampAngle(actor.rotY, Math.atan2(actor.vel.x, actor.vel.z), 8.5, dt);
    } else {
      actor.vel.multiplyScalar(Math.max(0, 1 - 9 * dt));
      // When holding position/jockeying, orient calmly toward the ball
      const faceBallAngle = Math.atan2(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z);
      actor.rotY = this.dampAngle(actor.rotY, faceBallAngle, 7.5, dt);
    }

    actor.pos.x += actor.vel.x * dt;
    actor.pos.z += actor.vel.z * dt;
    this.clampToPitch(actor.pos);
  }

  private resolveActorCollisions() {
    for (let i = 0; i < this.actors.length; i++) {
      for (let j = i + 1; j < this.actors.length; j++) {
        const a = this.actors[i];
        const b = this.actors[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const distSq = dx * dx + dz * dz;
        const minDist = 0.85;
        if (distSq > 0.0001 && distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.pos.x -= nx * overlap;
          a.pos.z -= nz * overlap;
          b.pos.x += nx * overlap;
          b.pos.z += nz * overlap;
        }
      }
    }
  }

  private constrainBallInGoalNet(zSign: -1 | 1): boolean {
    const halfL = this.fieldLength / 2;
    const goalHalfW = 4.8;
    const goalH = 3.3;
    const goalDepth = 2.6;
    const ballR = 0.24;

    const pastGoalLine =
      zSign < 0 ? this.ballPos.z < -halfL + 0.08 : this.ballPos.z > halfL - 0.08;
    if (!pastGoalLine) return false;
    if (Math.abs(this.ballPos.x) > goalHalfW + 0.45 || this.ballPos.y > goalH + 0.45) {
      return false;
    }

    const maxInnerX = goalHalfW - ballR;
    const maxInnerY = goalH - ballR;
    const backNetZ = zSign * (halfL + goalDepth - ballR);
    const frontKeepZ = zSign * (halfL + 0.28);
    const impactSpeed = this.ballVel.length();
    const intensity = THREE.MathUtils.clamp(impactSpeed / 18, 0.35, 1.45);
    let hitNet = false;

    if (Math.abs(this.ballPos.x) >= maxInnerX) {
      this.ballPos.x = Math.sign(this.ballPos.x) * maxInnerX;
      this.ballVel.x *= -0.18;
      this.ballVel.z *= 0.38;
      this.ballVel.y *= 0.65;
      hitNet = true;
    }

    if (this.ballPos.y >= maxInnerY) {
      this.ballPos.y = maxInnerY;
      if (this.ballVel.y > 0) this.ballVel.y = -this.ballVel.y * 0.2;
      this.ballVel.x *= 0.45;
      this.ballVel.z *= 0.45;
      hitNet = true;
    }

    if ((zSign < 0 && this.ballPos.z <= backNetZ) || (zSign > 0 && this.ballPos.z >= backNetZ)) {
      this.ballPos.z = backNetZ;
      this.ballVel.z = -zSign * Math.min(2.2, Math.abs(this.ballVel.z) * 0.16);
      this.ballVel.x *= 0.35;
      this.ballVel.y *= 0.5;
      hitNet = true;
    }

    // Keep scored ball from bouncing back out onto the pitch
    if (
      (zSign < 0 && this.ballPos.z > frontKeepZ && this.ballVel.z > 0) ||
      (zSign > 0 && this.ballPos.z < frontKeepZ && this.ballVel.z < 0)
    ) {
      this.ballPos.z = frontKeepZ;
      this.ballVel.z *= -0.15;
    }

    if (hitNet && impactSpeed > 1.2) {
      this.stadiumControls?.triggerGoalNetImpact(zSign, this.ballPos.x, this.ballPos.y, intensity);
    }
    return true;
  }

  private updateBallPhysics(dt: number) {
    if (this.goalResetTimer > 0) {
      // Ball settles cleanly inside the woven goal net mesh
      this.ballVel.y -= 18 * dt;
      this.ballPos.addScaledVector(this.ballVel, dt);
      if (this.ballPos.y < 0.24) {
        this.ballPos.y = 0.24;
        this.ballVel.y = -this.ballVel.y * 0.32;
      }
      const netZSign: -1 | 1 = this.ballPos.z < 0 ? -1 : 1;
      const inNet = this.constrainBallInGoalNet(netZSign);
      const damping = inNet ? 4.4 : 3.2;
      this.ballVel.multiplyScalar(Math.max(0, 1 - damping * dt));
      return;
    }

    // Dribble attachment check
    if (this.ballOwnerId) {
      const owner = this.actors.find((a) => a.id === this.ballOwnerId);
      if (!owner) {
        this.ballOwnerId = null;
      } else {
        const forwardX = Math.sin(owner.rotY);
        const forwardZ = Math.cos(owner.rotY);
        const targetX = owner.pos.x + forwardX * 0.72;
        const targetZ = owner.pos.z + forwardZ * 0.72;
        this.ballPos.x = THREE.MathUtils.damp(this.ballPos.x, targetX, 20, dt);
        this.ballPos.z = THREE.MathUtils.damp(this.ballPos.z, targetZ, 20, dt);
        this.ballPos.y = 0.24;
        this.ballVel.set(owner.vel.x, 0, owner.vel.z);

        // Steal check by opponent (never auto-switches human player)
        for (const other of this.actors) {
          if (other.team === owner.team || other.role === 'goalkeeper') continue;
          const d = Math.hypot(other.pos.x - this.ballPos.x, other.pos.z - this.ballPos.z);
          if (d < 0.78 && other.kickAnimTimer <= 0) {
            this.ballOwnerId = other.id;
            this.recordBallTouch(other);
            if (other.team === 'home') this.matchStats.homeTackles += 1;
            else this.matchStats.awayTackles += 1;
            soccerAudio.playKick(0.4);
            break;
          }
        }
      }
    }

    if (this.lastKickerGraceTimer > 0) {
      this.lastKickerGraceTimer -= dt;
      if (this.lastKickerGraceTimer <= 0) this.lastKickerId = null;
    }

    if (!this.ballOwnerId) {
      // Gravity & ballistic motion
      this.ballVel.y -= 19.6 * dt;
      this.ballPos.addScaledVector(this.ballVel, dt);

      if (this.ballPos.y <= 0.24) {
        this.ballPos.y = 0.24;
        if (Math.abs(this.ballVel.y) > 1.8) {
          this.ballVel.y = -this.ballVel.y * 0.56;
        } else {
          this.ballVel.y = 0;
        }
        // Reduced turf rolling friction so rolling passes carry crisply across the pitch
        const drag = Math.max(0, 1 - 0.85 * dt);
        this.ballVel.x *= drag;
        this.ballVel.z *= drag;
      } else {
        // Light air drag
        const airDrag = Math.max(0, 1 - 0.2 * dt);
        this.ballVel.x *= airDrag;
        this.ballVel.z *= airDrag;
      }

      // Pickup by outfield player (manual switching only: never auto-transfers camera/control)
      if (this.ballPos.y < 1.15) {
        for (const actor of this.actors) {
          if (actor.role === 'goalkeeper' || actor.kickAnimTimer > 0) continue;
          if (actor.id === this.lastKickerId && this.lastKickerGraceTimer > 0) continue;
          const dist = Math.hypot(actor.pos.x - this.ballPos.x, actor.pos.z - this.ballPos.z);
          if (dist < 0.92) {
            this.ballOwnerId = actor.id;
            this.recordBallTouch(actor);
            this.lastKickerId = null;
            this.lastKickerGraceTimer = 0;
            break;
          }
        }
      }
    }

    // Enlarged Goalposts, Crossbar & Goal Scoring Check (matches models.ts 9.6m x 3.3m)
    const halfW = this.fieldWidth / 2;
    const halfL = this.fieldLength / 2;
    const goalHalfW = 4.8;
    const goalH = 3.3;

    // Post & Crossbar collisions at (-goalHalfW..+goalHalfW, y=0..goalH, +-halfL)
    for (const zSign of [-1, 1] as const) {
      const gz = zSign * halfL;
      for (const px of [-goalHalfW, goalHalfW]) {
        const dx = this.ballPos.x - px;
        const dz = this.ballPos.z - gz;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.34 && this.ballPos.y < goalH) {
          const preSpeed = this.ballVel.length();
          const nx = dx / Math.max(0.01, dist);
          const nz = dz / Math.max(0.01, dist);
          this.ballVel.x = nx * Math.max(6, Math.abs(this.ballVel.x) * 0.85);
          this.ballVel.z = nz * Math.max(6, Math.abs(this.ballVel.z) * 0.85);
          this.ballPos.x = px + nx * 0.36;
          this.ballPos.z = gz + nz * 0.36;
          soccerAudio.playPostClang();
          if (preSpeed > 9 && this.postSnapshotCooldown <= 0) {
            this.postSnapshotCooldown = 3.5;
            const attackTeam: TeamSide = zSign < 0 ? 'home' : 'away';
            this.queueKeyPlaySnapshot(
              'post',
              attackTeam,
              this.lastTouchActor?.name || 'STRIKER',
              'OFF THE WOODWORK!',
              `${Math.round(preSpeed * 3.6)} km/h strike rattled the post`,
            );
          }
        }
      }

      // Crossbar collision
      if (Math.abs(this.ballPos.x) <= goalHalfW + 0.15) {
        const dy = this.ballPos.y - goalH;
        const dz = this.ballPos.z - gz;
        const barDist = Math.hypot(dy, dz);
        if (barDist < 0.34) {
          const preSpeed = this.ballVel.length();
          const ny = dy / Math.max(0.01, barDist);
          const nz = dz / Math.max(0.01, barDist);
          const dot = this.ballVel.y * ny + this.ballVel.z * nz;
          if (dot < 0) {
            this.ballVel.y -= 1.8 * dot * ny;
            this.ballVel.z -= 1.8 * dot * nz;
          }
          this.ballPos.y = goalH + ny * 0.36;
          this.ballPos.z = gz + nz * 0.36;
          soccerAudio.playPostClang();
          if (preSpeed > 9 && this.postSnapshotCooldown <= 0) {
            this.postSnapshotCooldown = 3.5;
            const attackTeam: TeamSide = zSign < 0 ? 'home' : 'away';
            this.queueKeyPlaySnapshot(
              'post',
              attackTeam,
              this.lastTouchActor?.name || 'STRIKER',
              'OFF THE CROSSBAR!',
              `${Math.round(preSpeed * 3.6)} km/h strike shook the bar`,
            );
          }
        }
      }
    }

    // Goal detection!
    const insideGoalWidth = Math.abs(this.ballPos.x) < goalHalfW - 0.2;
    if (insideGoalWidth && this.ballPos.y < goalH) {
      if (this.ballPos.z < -halfL - 0.25) {
        // Scored in Away Goal (-Z) -> Home Team scores!
        this.constrainBallInGoalNet(-1);
        this.onGoalScored('home');
        return;
      }
      if (this.ballPos.z > halfL + 0.25) {
        // Scored in Home Goal (+Z) -> Away Team scores!
        this.constrainBallInGoalNet(1);
        this.onGoalScored('away');
        return;
      }
    }

    // Physical Set-Pieces on Sideline & Endline Out-of-Bounds
    if (Math.abs(this.ballPos.x) > halfW + 0.35) {
      const sideSign = Math.sign(this.ballPos.x);
      const awardTeam: TeamSide = this.lastTouchActor?.team === 'home' ? 'away' : 'home';
      const spotX = sideSign * (halfW - 0.15);
      const spotZ = THREE.MathUtils.clamp(this.ballPos.z, -halfL + 1.5, halfL - 1.5);
      this.startSetPiece('throw_in', awardTeam, spotX, spotZ);
      return;
    }

    if (!insideGoalWidth && Math.abs(this.ballPos.z) > halfL + 0.35) {
      const defTeam: TeamSide = this.ballPos.z < 0 ? 'away' : 'home';
      const attTeam: TeamSide = defTeam === 'home' ? 'away' : 'home';
      const endSign = defTeam === 'away' ? -1 : 1;

      if (this.lastTouchActor?.team === defTeam) {
        // Defending team knocked it behind own endline -> Corner Kick!
        const cornerSide = this.ballPos.x >= 0 ? 1 : -1;
        this.startSetPiece(
          'corner',
          attTeam,
          cornerSide * (halfW - 0.65),
          endSign * (halfL - 0.65),
        );
      } else {
        // Attacking team put it out behind goal line -> Goal Kick!
        const gkSide = this.ballPos.x >= 0 ? 2.6 : -2.6;
        this.startSetPiece('goal_kick', defTeam, gkSide, endSign * (halfL - 5.2));
      }
      return;
    }
  }

  private startSetPiece(
    kind: SetPieceKind,
    team: TeamSide,
    spotX: number,
    spotZ: number,
    fromFoul = false,
  ) {
    const halfW = this.fieldWidth / 2;
    const halfL = this.fieldLength / 2;
    const clampedX = THREE.MathUtils.clamp(spotX, -halfW + 0.15, halfW - 0.15);
    const clampedZ = THREE.MathUtils.clamp(spotZ, -halfL + 0.55, halfL - 0.55);

    let taker: MatchActor | null = null;
    if (kind === 'goal_kick') {
      taker = this.actors.find((a) => a.team === team && a.role === 'goalkeeper') ?? null;
    }
    if (!taker) {
      const teamOutfield = this.actors.filter((a) => a.team === team && a.role === 'outfield');
      if (teamOutfield.length > 0) {
        taker = [...teamOutfield].sort(
          (a, b) =>
            Math.hypot(a.pos.x - clampedX, a.pos.z - clampedZ) -
            Math.hypot(b.pos.x - clampedX, b.pos.z - clampedZ),
        )[0];
      }
    }
    if (!taker) taker = this.actors.find((a) => a.team === team) ?? this.actors[0];

    this.setPieceState = {
      kind,
      team,
      spotX: clampedX,
      spotZ: clampedZ,
      takerId: taker.id,
      countdown: 5.2 + Math.random() * 0.8,
    };

    this.ballOwnerId = null;
    this.lastKickerId = null;
    this.lastKickerGraceTimer = 0;
    this.ballPos.set(clampedX, 0.24, clampedZ);
    this.ballVel.set(0, 0, 0);

    // Position taker just behind the ball facing into the pitch / opponent goal
    const attackZ = team === 'home' ? -1 : 1;
    const aimX = kind === 'throw_in' ? -Math.sign(clampedX) * 5.0 : 0;
    const aimZ = kind === 'goal_kick' ? attackZ * 10 : attackZ * halfL;
    const faceRot = Math.atan2(aimX - clampedX, aimZ - clampedZ);
    taker.pos.set(
      THREE.MathUtils.clamp(clampedX - Math.sin(faceRot) * 0.85, -halfW - 0.4, halfW + 0.4),
      0,
      THREE.MathUtils.clamp(clampedZ - Math.cos(faceRot) * 0.85, -halfL - 0.4, halfL + 0.4),
    );
    taker.vel.set(0, 0, 0);
    taker.tackleTimer = 0;
    taker.standTackleTimer = 0;
    taker.rotY = faceRot;

    // Set initial safe spacing while allowing all players to move freely right away
    const minDefDist = kind === 'throw_in' ? 3.2 : 8.2;
    for (const actor of this.actors) {
      if (actor.id === taker.id) continue;
      actor.vel.set(0, 0, 0);
      actor.tackleTimer = 0;
      actor.standTackleTimer = 0;
      if (actor.role === 'goalkeeper') continue;

      if (actor.team !== team) {
        const dx = actor.pos.x - clampedX;
        const dz = actor.pos.z - clampedZ;
        const d = Math.hypot(dx, dz);
        if (d < minDefDist - 0.4) {
          const nx = d > 0.1 ? dx / d : -Math.sin(faceRot);
          const nz = d > 0.1 ? dz / d : attackZ;
          actor.pos.x = THREE.MathUtils.clamp(clampedX + nx * minDefDist, -halfW + 1.5, halfW - 1.5);
          actor.pos.z = THREE.MathUtils.clamp(clampedZ + nz * minDefDist, -halfL + 1.5, halfL - 1.5);
        }
      } else {
        const dx = actor.pos.x - clampedX;
        const dz = actor.pos.z - clampedZ;
        const d = Math.hypot(dx, dz);
        if (d < 4.5) {
          actor.pos.x = THREE.MathUtils.clamp(
            actor.homePos.x * 0.65 + (Math.random() - 0.5) * 6,
            -halfW + 2,
            halfW - 2,
          );
          actor.pos.z = THREE.MathUtils.clamp(
            clampedZ + attackZ * 7.5,
            -halfL + 3,
            halfL - 3,
          );
        }
      }
      actor.rotY = Math.atan2(clampedX - actor.pos.x, clampedZ - actor.pos.z);
    }

    soccerAudio.playWhistle(fromFoul ? 'foul' : 'setpiece');
  }

  private updateSetPiece(dt: number, localInput: ClientMatchInput) {
    const sp = this.setPieceState;
    if (!sp) return;

    const taker = this.actors.find((a) => a.id === sp.takerId);
    if (!taker) {
      this.setPieceState = null;
      return;
    }

    const takerIsHuman = this.isHumanControlledActor(taker);
    // Remove forced countdown for human takers; AI takers wait 5-6 seconds
    if (!takerIsHuman) {
      sp.countdown = Math.max(0, sp.countdown - dt);
    }

    const takerInput = this.getInputForActor(taker, localInput);
    if (takerInput && (Math.abs(takerInput.moveX) > 0.1 || Math.abs(takerInput.moveZ) > 0.1)) {
      taker.rotY = this.dampAngle(taker.rotY, Math.atan2(takerInput.moveX, takerInput.moveZ), 12, dt);
    }

    const humanTriggered =
      takerInput &&
      (takerInput.groundedPass ||
        takerInput.throughPass ||
        takerInput.loftOrTackle ||
        takerInput.shoot);

    if (humanTriggered && takerInput) {
      this.setPieceState = null;
      if (takerInput.shoot && (sp.kind === 'free_kick' || sp.kind === 'corner')) {
        const aimOffsetX = THREE.MathUtils.clamp(takerInput.moveX * 3.8, -3.8, 3.8);
        this.executeShotKick(taker, aimOffsetX, 24.5, false);
      } else if (takerInput.loftOrTackle || sp.kind === 'corner' || sp.kind === 'goal_kick') {
        this.performPass(taker, takerInput, 'lofted');
      } else if (takerInput.throughPass) {
        this.performPass(taker, takerInput, 'through');
      } else {
        this.performPass(taker, takerInput, 'grounded');
      }
      return;
    }

    if (!takerIsHuman && sp.countdown <= 0) {
      this.setPieceState = null;
      const mates = this.actors
        .filter((a) => a.team === sp.team && a.id !== taker.id && a.role === 'outfield')
        .sort((a, b) => {
          const da = Math.hypot(a.pos.x - sp.spotX, a.pos.z - sp.spotZ);
          const db = Math.hypot(b.pos.x - sp.spotX, b.pos.z - sp.spotZ);
          const oa = this.nearestOpponentDist(a.pos.x, a.pos.z, sp.team === 'home' ? 'away' : 'home');
          const ob = this.nearestOpponentDist(b.pos.x, b.pos.z, sp.team === 'home' ? 'away' : 'home');
          return da - oa * 1.6 - (db - ob * 1.6);
        });
      const targetMate = mates[0] ?? null;
      const attackZ = sp.team === 'home' ? -1 : 1;
      const halfL = this.fieldLength / 2;
      const kind: 'grounded' | 'through' | 'lofted' =
        sp.kind === 'corner' || sp.kind === 'goal_kick' ? 'lofted' : 'grounded';
      const tx =
        sp.kind === 'corner'
          ? (Math.random() - 0.5) * 6.5
          : targetMate
            ? targetMate.pos.x
            : 0;
      const tz =
        sp.kind === 'corner'
          ? attackZ * (halfL - 9.0)
          : targetMate
            ? targetMate.pos.z
            : sp.spotZ + attackZ * 12;
      this.executePassToTargetCoords(taker, tx, tz, kind, targetMate, true);
    }
  }

  private stepSetPiecePlayerMovement(actor: MatchActor, input: ClientMatchInput, dt: number) {
    const moving = Math.hypot(input.moveX, input.moveZ) > 0.1;
    const sprinting = input.sprint && moving && actor.stamina > 4;
    if (sprinting) {
      actor.stamina = Math.max(0, actor.stamina - 20 * dt);
    } else {
      actor.stamina = Math.min(100, actor.stamina + 16 * dt);
    }
    const topSpeed = sprinting ? 11.4 : 7.8;
    actor.vel.x = THREE.MathUtils.damp(actor.vel.x, input.moveX * topSpeed, 12, dt);
    actor.vel.z = THREE.MathUtils.damp(actor.vel.z, input.moveZ * topSpeed, 12, dt);
    actor.pos.x += actor.vel.x * dt;
    actor.pos.z += actor.vel.z * dt;
    this.clampToPitch(actor.pos);

    if (Math.hypot(actor.vel.x, actor.vel.z) > 0.45) {
      actor.rotY = this.dampAngle(actor.rotY, Math.atan2(actor.vel.x, actor.vel.z), 14, dt);
    } else {
      actor.rotY = this.dampAngle(
        actor.rotY,
        Math.atan2(this.ballPos.x - actor.pos.x, this.ballPos.z - actor.pos.z),
        8,
        dt,
      );
    }
  }

  private stepAiSetPieceMovement(
    actor: MatchActor,
    sp: NonNullable<TitanicSoccerEngine['setPieceState']>,
    dt: number,
  ) {
    const halfW = this.fieldWidth / 2;
    const halfL = this.fieldLength / 2;
    const attackZ = sp.team === 'home' ? -1 : 1;

    if (actor.role === 'goalkeeper') {
      const zSign = actor.team === 'home' ? 1 : -1;
      const targetX = THREE.MathUtils.clamp(sp.spotX * 0.35, -3.5, 3.5);
      const targetZ = zSign * (halfL - 2.0);
      const dx = targetX - actor.pos.x;
      const dz = targetZ - actor.pos.z;
      actor.vel.set(THREE.MathUtils.clamp(dx * 4, -4.5, 4.5), 0, THREE.MathUtils.clamp(dz * 4, -4.5, 4.5));
      actor.pos.x += actor.vel.x * dt;
      actor.pos.z += actor.vel.z * dt;
      actor.rotY = Math.atan2(sp.spotX - actor.pos.x, sp.spotZ - actor.pos.z);
      return;
    }

    let tx = actor.homePos.x;
    let tz = actor.homePos.z;

    if (actor.team === sp.team) {
      // Attacking / restarting teammates get open for passes & push into dangerous areas
      if (sp.kind === 'corner' || (sp.kind === 'free_kick' && attackZ * sp.spotZ > 0)) {
        const boxZ = attackZ * (halfL - 9.5);
        tx = THREE.MathUtils.clamp(actor.homePos.x * 0.55, -8.5, 8.5);
        tz =
          actor.tacticalRole === 'defender'
            ? THREE.MathUtils.clamp(actor.homePos.z * 0.65, -halfL + 10, halfL - 10)
            : THREE.MathUtils.clamp(boxZ - attackZ * (actor.tacticalRole === 'midfielder' ? 5.5 : 0), -halfL + 4, halfL - 4);
      } else if (sp.kind === 'throw_in') {
        const sideSign = Math.sign(sp.spotX || 1);
        const nearSideline = Math.abs(actor.homePos.x - sp.spotX) < halfW * 0.8;
        tx = nearSideline
          ? THREE.MathUtils.clamp(sp.spotX - sideSign * 7.5, -halfW + 3, halfW - 3)
          : THREE.MathUtils.clamp(actor.homePos.x * 0.75, actor.zoneMinX, actor.zoneMaxX);
        tz = THREE.MathUtils.clamp(
          sp.spotZ + attackZ * (actor.tacticalRole === 'forward' ? 9.5 : 3.5),
          actor.zoneMinZ,
          actor.zoneMaxZ,
        );
      } else {
        // Goal kick or own-half free kick: spread wide & offer clear passing lanes
        tx = THREE.MathUtils.clamp(actor.homePos.x * 1.1, -halfW + 3, halfW - 3);
        tz = THREE.MathUtils.clamp(actor.homePos.z * 0.8 + attackZ * 4.5, -halfL + 6, halfL - 6);
      }
    } else {
      // Defending AI marks space/runners while respecting set-piece buffer distance
      const ownZSign = actor.team === 'home' ? 1 : -1;
      if (sp.kind === 'corner' || (sp.kind === 'free_kick' && attackZ * sp.spotZ > 0)) {
        tx = THREE.MathUtils.clamp(actor.homePos.x * 0.55, -8.5, 8.5);
        tz = THREE.MathUtils.clamp(ownZSign * (halfL - 9.0), -halfL + 2.5, halfL - 2.5);
      } else {
        tx = THREE.MathUtils.clamp(actor.homePos.x * 0.82 + sp.spotX * 0.18, actor.zoneMinX, actor.zoneMaxX);
        tz = THREE.MathUtils.clamp(actor.homePos.z * 0.65 + sp.spotZ * 0.25, actor.zoneMinZ, actor.zoneMaxZ);
      }

      const minBuf = sp.kind === 'throw_in' ? 2.6 : 8.4;
      const bdx = tx - sp.spotX;
      const bdz = tz - sp.spotZ;
      const bd = Math.hypot(bdx, bdz);
      if (bd < minBuf && bd > 0.05) {
        tx = THREE.MathUtils.clamp(sp.spotX + (bdx / bd) * minBuf, -halfW + 1.5, halfW - 1.5);
        tz = THREE.MathUtils.clamp(sp.spotZ + (bdz / bd) * minBuf, -halfL + 1.5, halfL - 1.5);
      }
    }

    const dx = tx - actor.pos.x;
    const dz = tz - actor.pos.z;
    const dist = Math.hypot(dx, dz);
    const speed = dist > 5.0 ? 6.8 : 4.6;
    if (dist > 0.5) {
      actor.vel.x = THREE.MathUtils.damp(actor.vel.x, (dx / dist) * speed, 6, dt);
      actor.vel.z = THREE.MathUtils.damp(actor.vel.z, (dz / dist) * speed, 6, dt);
      actor.rotY = this.dampAngle(actor.rotY, Math.atan2(actor.vel.x, actor.vel.z), 8, dt);
    } else {
      actor.vel.multiplyScalar(Math.max(0, 1 - 9 * dt));
      actor.rotY = this.dampAngle(
        actor.rotY,
        Math.atan2(sp.spotX - actor.pos.x, sp.spotZ - actor.pos.z),
        7.5,
        dt,
      );
    }
    actor.pos.x += actor.vel.x * dt;
    actor.pos.z += actor.vel.z * dt;
    this.clampToPitch(actor.pos);
  }

  private onGoalScored(scoringTeam: TeamSide) {
    if (scoringTeam === 'home') this.homeScore += 1;
    else this.awayScore += 1;

    const scorerClub = scoringTeam === 'home' ? this.homeClub : this.awayClub;
    const scorerInfo =
      this.lastTouchActor && this.lastTouchActor.team === scoringTeam
        ? this.lastTouchActor
        : null;
    const scorerName = scorerInfo?.name || scorerClub.shortName;
    const scorerNumber = scorerInfo?.number ?? 10;
    const assistName =
      this.prevTouchActor &&
      this.prevTouchActor.team === scoringTeam &&
      this.prevTouchActor.id !== scorerInfo?.id &&
      this.matchElapsedTime - this.prevTouchActor.time < 5.5
        ? this.prevTouchActor.name
        : null;
    const shotSpeedKmh = Math.max(38, Math.round(this.ballVel.length() * 3.6));

    this.captureGoalHighlight(scoringTeam, scorerName, scorerNumber, assistName, shotSpeedKmh);

    this.goalBanner = {
      team: scoringTeam,
      scorer: `${scorerClub.name}`,
      scorerName,
      scorerNumber,
      assistName,
      shotSpeedKmh,
      highlightSaved: true,
    };
    this.kickoffTeam = scoringTeam === 'home' ? 'away' : 'home';
    this.setPieceState = null;
    this.homeSecondDefTimer = 0;
    this.awaySecondDefTimer = 0;
    this.goalResetTimer = 4.1;
    this.crowdBoostTimer = 4.2;
    this.ballOwnerId = null;
    this.cameraShake = 0.55;
    this.stadiumControls?.triggerGoalNetImpact(
      scoringTeam === 'home' ? -1 : 1,
      this.ballPos.x,
      this.ballPos.y,
      1.25,
    );
    this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 18);

    this.liveGoalReplayState = {
      active: false,
      celebrationTimer: 1.05,
      elapsed: 0,
      duration: 3.0,
      scoringTeam,
      scoringClubShort: scorerClub.shortName,
      scoringColor: scorerClub.primaryColor,
      scorerLabel: `#${scorerNumber} ${scorerName}`,
      frames: [],
      clipDuration: 2.2,
      burstFired: false,
    };

    soccerAudio.playWhistle('goal');
    soccerAudio.playCrowdGoalRoar();
    this.emitHud();
  }

  private triggerFullTime() {
    this.matchEnded = true;
    if (this.shootoutAimMarker) {
      this.shootoutAimMarker.visible = false;
    }
    this.finalizePendingGoalCapture();
    if (this.pendingSnapshotTasks.length > 0) {
      this.processPendingSnapshots();
    }
    if (this.lanMode === 'host') {
      this.emitLanSnapshot();
    }
    soccerAudio.playWhistle('fulltime');
    this.emitHud();
    this.callbacks.onFullTime(this.getRecapData());
  }

  // ------------------------------------------------------------------
  // EXTRA TIME (+2 MIN) & PENALTY SHOOTOUT ENGINE
  // ------------------------------------------------------------------
  public startExtraTime(extraSeconds = 120) {
    if (this.mode !== 'match') return;
    this.paused = false;
    this.matchEnded = false;
    this.extraTimeCount += 1;
    this.timeRemainingSeconds = extraSeconds;
    this.totalSeconds += extraSeconds;
    this.goalResetTimer = 0;
    this.goalBanner = null;
    this.resetPositionsForKickoff(Math.random() < 0.5 ? 'home' : 'away');
    soccerAudio.playWhistle('kickoff');
    if (this.lanMode === 'host') {
      this.emitLanSnapshot();
    }
    this.emitHud();
  }

  public startPenaltyShootout(preferredRole: PlayerRole = 'outfield') {
    if (this.mode !== 'match') return;
    this.paused = false;
    this.matchEnded = false;
    this.decidedByShootout = true;
    this.goalResetTimer = 0;
    this.goalBanner = null;
    this.ballOwnerId = null;

    this.shootoutState = {
      active: true,
      round: 1,
      turnTeam: 'home',
      phase: 'aiming',
      homeScore: 0,
      awayScore: 0,
      homeKicks: [],
      awayKicks: [],
      isSuddenDeath: false,
      shotClock: 4.0,
      phaseTimer: 0,
      runUpTimer: 0,
      runUpDuration: 0.62,
      runUpStartX: -0.78,
      runUpStartZ: -this.fieldLength / 2 + 14.6,
      pendingTargetX: 0,
      pendingTargetY: 1.25,
      aiDelay: 1.35,
      aiTargetX: 0,
      aiTargetY: 1.35,
      aiGkDived: false,
      aimX: 0,
      aimY: 1.35,
      kickerActorId: null,
      gkActorId: null,
      resultBanner: null,
      homeKickRotation: 0,
      awayKickRotation: 0,
      userPreferredRole: preferredRole,
    };

    this.setupNextShootoutKick();
    if (this.lanMode === 'host') {
      this.emitLanSnapshot();
    }
    this.emitHud();
  }

  private setupNextShootoutKick() {
    const so = this.shootoutState;
    if (!so) return;

    const kickTeam = so.turnTeam;
    const defTeam: TeamSide = kickTeam === 'home' ? 'away' : 'home';

    const teamOutfield = this.actors.filter((a) => a.team === kickTeam && a.role === 'outfield');
    const humanOutfield = teamOutfield.filter((a) => a.controlledByClientId !== null);
    const pool = this.lanMode === 'offline' ? teamOutfield : humanOutfield.length > 0 ? humanOutfield : teamOutfield;
    const rotIdx = kickTeam === 'home' ? so.homeKickRotation : so.awayKickRotation;
    const kicker = pool[rotIdx % Math.max(1, pool.length)] ?? this.actors[0];
    if (kickTeam === 'home') so.homeKickRotation += 1;
    else so.awayKickRotation += 1;

    const gk =
      this.actors.find((a) => a.team === defTeam && a.role === 'goalkeeper') ??
      this.actors.find((a) => a.role === 'goalkeeper') ??
      this.actors[0];

    const halfL = this.fieldLength / 2;
    const penZ = -halfL + 11.0;

    so.kickerActorId = kicker.id;
    so.gkActorId = gk.id;
    so.phase = 'aiming';
    so.shotClock = 4.0;
    so.phaseTimer = 0;
    so.runUpTimer = 0;
    so.runUpDuration = 0.62;
    so.runUpStartX = -0.78;
    so.runUpStartZ = penZ + 3.6;
    so.pendingTargetX = 0;
    so.pendingTargetY = 1.25;
    so.aiDelay = 1.0 + Math.random() * 1.1;
    so.aiTargetX = (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 2.45);
    so.aiTargetY = 0.5 + Math.random() * 2.25;
    so.aiGkDived = false;
    so.aimX = 0;
    so.aimY = 1.25;
    so.resultBanner = null;

    // Position ball on the penalty spot (11m from -Z goal line)
    this.ballPos.set(0, 0.24, penZ);
    this.ballVel.set(0, 0, 0);
    this.ballOwnerId = null;
    this.lastKickerId = null;

    // Place Kicker back at run-up mark & Goalkeeper on goal line; gather other players near midfield
    let specIdx = 0;
    for (const actor of this.actors) {
      actor.vel.set(0, 0, 0);
      actor.vy = 0;
      actor.diveState = 'none';
      actor.diveTimer = 0;
      actor.diveDirX = 0;
      actor.diveDirY = 0;
      actor.tackleTimer = 0;
      actor.kickAnimTimer = 0;

      if (actor.id === kicker.id) {
        actor.pos.set(so.runUpStartX, 0, so.runUpStartZ);
        actor.rotY = Math.atan2(0 - so.runUpStartX, penZ - so.runUpStartZ);
      } else if (actor.id === gk.id) {
        actor.pos.set(0, 0, -halfL + 0.45);
        actor.rotY = 0; // Facing +Z penalty spot
      } else {
        const side = specIdx % 2 === 0 ? -1 : 1;
        const row = Math.floor(specIdx / 2);
        actor.pos.set(side * (2.6 + row * 1.8), 0, 4 + row * 1.4);
        actor.rotY = Math.PI;
        specIdx += 1;
      }
      actor.rig.root.position.copy(actor.pos);
      actor.rig.root.rotation.y = actor.rotY;
    }

    // Assign local actor control cleanly
    if (this.lanMode === 'offline') {
      if (so.userPreferredRole === 'goalkeeper') {
        this.localControlledActorId = gk.team === 'home' ? gk.id : kicker.id;
      } else {
        this.localControlledActorId = kickTeam === 'home' ? kicker.id : gk.id;
      }
    } else if (this.lanMode === 'host') {
      if (kicker.controlledByClientId === this.localClientId) {
        this.localControlledActorId = kicker.id;
      } else if (gk.controlledByClientId === this.localClientId) {
        this.localControlledActorId = gk.id;
      }
    }

    // Blow referee whistle for the penalty kick turn
    soccerAudio.playWhistle('kickoff');
  }

  private getInputForActor(actor: MatchActor, localInput: ClientMatchInput): ClientMatchInput | null {
    if (this.lanMode === 'offline') {
      return actor.id === this.localControlledActorId ? localInput : null;
    }
    if (actor.controlledByClientId === this.localClientId) {
      return localInput;
    }
    if (actor.controlledByClientId) {
      return this.remoteInputs.get(actor.controlledByClientId) ?? null;
    }
    return null;
  }

  private updatePenaltyShootout(dt: number, localInput: ClientMatchInput) {
    const so = this.shootoutState;
    if (!so) return;

    const halfL = this.fieldLength / 2;
    const penZ = -halfL + 11.0;
    const goalHalfW = 4.8;
    const goalH = 3.3;
    const kicker = this.actors.find((a) => a.id === so.kickerActorId) ?? this.actors[0];
    const gk = this.actors.find((a) => a.id === so.gkActorId) ?? this.actors[1] ?? this.actors[0];

    const kickerInput = this.getInputForActor(kicker, localInput);
    const gkInput = this.getInputForActor(gk, localInput);

    if (so.phase === 'aiming') {
      so.shotClock = Math.max(0, so.shotClock - dt);

      // Human GK: allow subtle line shuffling & early 360° dive
      if (gkInput) {
        if (gk.diveTimer > 0 || gkInput.gkJumpOrDive || gkInput.gkQuickAction) {
          this.stepPenaltyGoalkeeper(gk, gkInput, dt, halfL);
        } else {
          gk.pos.x = THREE.MathUtils.clamp(gk.pos.x + gkInput.moveX * 2.2 * dt, -2.0, 2.0);
          gk.rotY = 0;
        }
      } else {
        gk.pos.x = THREE.MathUtils.damp(gk.pos.x, 0, 6, dt);
      }

      if (kickerInput) {
        // Human kicker adjusts aim target inside the 9.6m x 3.3m goal mouth
        so.aimX = THREE.MathUtils.clamp(so.aimX + kickerInput.moveX * 7.2 * dt, -4.45, 4.45);
        so.aimY = THREE.MathUtils.clamp(so.aimY - kickerInput.moveZ * 4.2 * dt, 0.3, 3.05);

        const triggerShot =
          kickerInput.shoot ||
          kickerInput.groundedPass ||
          kickerInput.gkJumpOrDive ||
          so.shotClock <= 0;

        if (triggerShot) {
          this.startPenaltyRunUp(kicker, so.aimX, so.aimY);
        }
      } else {
        // AI kicker takes aim and begins run-up inside the clock
        so.aiDelay -= dt;
        if (so.aiDelay <= 0 || so.shotClock <= 0) {
          this.startPenaltyRunUp(kicker, so.aiTargetX, so.aiTargetY);
        }
      }
    } else if (so.phase === 'run_up') {
      // Realistic accelerating run-up from starting mark to penalty spot
      if (gkInput) {
        this.stepPenaltyGoalkeeper(gk, gkInput, dt, halfL);
      } else {
        gk.pos.x = THREE.MathUtils.damp(gk.pos.x, 0, 4, dt);
      }

      so.runUpTimer += dt;
      const t = THREE.MathUtils.clamp(so.runUpTimer / Math.max(0.15, so.runUpDuration), 0, 1);
      const ease = t * t * (1.35 - 0.35 * t);
      const strikeX = -0.24;
      const strikeZ = penZ + 0.72;
      const prevX = kicker.pos.x;
      const prevZ = kicker.pos.z;

      // Subtle natural curved approach arc
      const arcOffset = Math.sin(t * Math.PI) * -0.18;
      kicker.pos.x = THREE.MathUtils.lerp(so.runUpStartX, strikeX, ease) + arcOffset;
      kicker.pos.z = THREE.MathUtils.lerp(so.runUpStartZ, strikeZ, ease);
      const invDt = 1 / Math.max(0.008, dt);
      kicker.vel.set((kicker.pos.x - prevX) * invDt, 0, (kicker.pos.z - prevZ) * invDt);
      kicker.rotY = this.dampAngle(
        kicker.rotY,
        Math.atan2(0 - kicker.pos.x, penZ - kicker.pos.z),
        16,
        dt,
      );

      if (t >= 1) {
        this.executePenaltyStrike(kicker, so.pendingTargetX, so.pendingTargetY);
      }
    } else if (so.phase === 'ball_in_flight') {
      so.phaseTimer -= dt;

      // Natural post-strike follow-through deceleration for kicker
      kicker.vel.multiplyScalar(Math.max(0, 1 - 6.5 * dt));
      kicker.pos.x += kicker.vel.x * dt;
      kicker.pos.z += kicker.vel.z * dt;

      // GK input or AI GK reaction
      if (gkInput) {
        this.stepPenaltyGoalkeeper(gk, gkInput, dt, halfL);
      } else {
        this.stepAiPenaltyGoalkeeper(gk, dt, halfL);
      }

      // Ball physics during penalty flight
      this.ballVel.y -= 19.6 * dt;
      this.ballPos.addScaledVector(this.ballVel, dt);
      if (this.ballPos.y <= 0.24) {
        this.ballPos.y = 0.24;
        if (Math.abs(this.ballVel.y) > 1.8) {
          this.ballVel.y = -this.ballVel.y * 0.56;
        } else {
          this.ballVel.y = 0;
        }
        const drag = Math.max(0, 1 - 0.85 * dt);
        this.ballVel.x *= drag;
        this.ballVel.z *= drag;
      }

      // Post & Crossbar collision check
      for (const px of [-goalHalfW, goalHalfW]) {
        const dx = this.ballPos.x - px;
        const dz = this.ballPos.z - -halfL;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.34 && this.ballPos.y < goalH) {
          const nx = dx / Math.max(0.01, dist);
          const nz = dz / Math.max(0.01, dist);
          this.ballVel.x = nx * Math.max(6, Math.abs(this.ballVel.x) * 0.8);
          this.ballVel.z = nz * Math.max(6, Math.abs(this.ballVel.z) * 0.8);
          this.ballPos.x = px + nx * 0.38;
          this.ballPos.z = -halfL + nz * 0.38;
          soccerAudio.playPostClang();
        }
      }
      if (Math.abs(this.ballPos.x) <= goalHalfW + 0.15) {
        const dy = this.ballPos.y - goalH;
        const dz = this.ballPos.z - -halfL;
        const barDist = Math.hypot(dy, dz);
        if (barDist < 0.34) {
          const ny = dy / Math.max(0.01, barDist);
          const nz = dz / Math.max(0.01, barDist);
          const dot = this.ballVel.y * ny + this.ballVel.z * nz;
          if (dot < 0) {
            this.ballVel.y -= 1.8 * dot * ny;
            this.ballVel.z -= 1.8 * dot * nz;
          }
          this.ballPos.y = goalH + ny * 0.36;
          this.ballPos.z = -halfL + nz * 0.36;
          soccerAudio.playPostClang();
        }
      }

      // GK Save check (360° directional corner extension)
      const isDiving = gk.diveState !== 'none';
      const reachCenterX = gk.pos.x + gk.diveDirX * (isDiving ? 0.35 : 0);
      const reachCenterY = gk.pos.y + 0.95 + gk.diveDirY * (isDiving ? 0.25 : 0);
      const horizReach = isDiving ? 1.58 : 1.05;
      const vertReach = isDiving ? 1.18 : 1.05;
      const gkDist = Math.hypot(this.ballPos.x - reachCenterX, this.ballPos.z - gk.pos.z);
      if (gkDist < horizReach && Math.abs(this.ballPos.y - reachCenterY) < vertReach) {
        this.ballVel.set(
          (this.ballPos.x >= gk.pos.x ? 1 : -1) * 9.5,
          4.8,
          11.0,
        );
        this.cameraShake = 0.32;
        this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 10);
        soccerAudio.playKick(0.9);
        if (gk.team === 'home') this.matchStats.homeSaves += 1;
        else this.matchStats.awaySaves += 1;
        this.finishShootoutKick('miss', 'SAVED!');
      } else if (
        Math.abs(this.ballPos.x) < goalHalfW - 0.2 &&
        this.ballPos.y < goalH &&
        this.ballPos.z < -halfL - 0.25
      ) {
        this.constrainBallInGoalNet(-1);
        this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 18);
        soccerAudio.playWhistle('goal');
        soccerAudio.playCrowdGoalRoar();
        this.finishShootoutKick('goal', 'PENALTY GOAL!');
      } else if (this.ballPos.z < -halfL - 0.45 || so.phaseTimer <= 0) {
        this.finishShootoutKick('miss', 'MISSED!');
      }
    } else if (so.phase === 'result') {
      so.phaseTimer -= dt;
      kicker.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
      kicker.pos.x += kicker.vel.x * dt;
      kicker.pos.z += kicker.vel.z * dt;

      // Let ball & diving GK settle smoothly inside goal net
      this.ballVel.y -= 19.6 * dt;
      this.ballPos.addScaledVector(this.ballVel, dt);
      if (this.ballPos.y <= 0.24) {
        this.ballPos.y = 0.24;
        this.ballVel.y = Math.abs(this.ballVel.y) > 1.8 ? -this.ballVel.y * 0.45 : 0;
        this.ballVel.x *= Math.max(0, 1 - 2.5 * dt);
        this.ballVel.z *= Math.max(0, 1 - 2.5 * dt);
      }
      this.constrainBallInGoalNet(-1);
      this.stadiumControls?.updateGoalNets(dt);
      if (gk.diveTimer > 0) {
        gk.diveTimer -= dt;
        gk.vy -= 18 * dt;
        gk.pos.x += gk.vel.x * dt;
        gk.pos.y = Math.max(0, gk.pos.y + gk.vy * dt);
        if (gk.diveTimer <= 0) {
          gk.diveState = 'none';
          gk.diveDirX = 0;
          gk.diveDirY = 0;
          gk.pos.y = 0;
        }
      }

      if (so.phaseTimer <= 0) {
        if (this.isShootoutDecided()) {
          this.triggerFullTime();
          return;
        }
        if (so.turnTeam === 'home') {
          so.turnTeam = 'away';
        } else {
          so.turnTeam = 'home';
          so.round += 1;
          if (so.round > 5) so.isSuddenDeath = true;
        }
        this.setupNextShootoutKick();
      }
    }

    // Clear consumed remote edge triggers
    this.remoteInputs.forEach((inp) => {
      inp.groundedPass = false;
      inp.throughPass = false;
      inp.loftOrTackle = false;
      inp.shoot = false;
      inp.gkJumpOrDive = false;
      inp.gkQuickAction = undefined;
      inp.standTackle = false;
      inp.slideTackle = false;
      inp.secondDefenderPress = false;
      inp.switchPlayer = false;
    });

    this.animateAllActorRigs(dt);
    this.syncBallVisual(dt);

    if (this.lanMode === 'host') {
      this.snapshotEmitAccum += dt;
      if (this.snapshotEmitAccum >= 0.05) {
        this.snapshotEmitAccum = 0;
        this.emitLanSnapshot();
      }
    }
    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }
  }

  private startPenaltyRunUp(kicker: MatchActor, targetX: number, targetY: number) {
    const so = this.shootoutState;
    if (!so || so.phase !== 'aiming') return;

    so.phase = 'run_up';
    so.runUpTimer = 0;
    so.runUpDuration = 0.62;
    so.runUpStartX = kicker.pos.x;
    so.runUpStartZ = kicker.pos.z;
    so.pendingTargetX = targetX;
    so.pendingTargetY = targetY;

    if (this.shootoutAimMarker) {
      this.shootoutAimMarker.visible = false;
    }
  }

  private executePenaltyStrike(kicker: MatchActor, targetX: number, targetY: number) {
    const so = this.shootoutState;
    if (!so) return;

    const halfL = this.fieldLength / 2;
    const goalZ = -halfL;
    const dx = targetX - this.ballPos.x;
    const dz = goalZ - this.ballPos.z;
    const horizDist = Math.max(1, Math.hypot(dx, dz));
    const shotSpeed = 27.2;
    const flightTime = horizDist / shotSpeed;
    // Compensate gravity so ball arrives near aimed targetY height
    const vy = (targetY - this.ballPos.y) / flightTime + 0.5 * 19.6 * flightTime;

    this.ballVel.set((dx / horizDist) * shotSpeed, THREE.MathUtils.clamp(vy, 2.2, 13.5), (dz / horizDist) * shotSpeed);
    kicker.rotY = Math.atan2(-dx, -dz);
    kicker.kickAnimTimer = 0.36;
    kicker.vel.set((dx / horizDist) * 2.2, 0, -2.4);

    if (kicker.team === 'home') this.matchStats.homeShots += 1;
    else this.matchStats.awayShots += 1;

    this.spawnBurst(this.ballPos.x, 0.18, this.ballPos.z, 10);
    soccerAudio.playKick(1.1);
    so.phase = 'ball_in_flight';
    so.phaseTimer = 2.4;
  }

  private stepPenaltyGoalkeeper(gk: MatchActor, input: ClientMatchInput, dt: number, halfL: number) {
    if (gk.diveTimer > 0) {
      gk.diveTimer -= dt;
      gk.vy -= 18 * dt;
      gk.pos.x += gk.vel.x * dt;
      gk.pos.z += gk.vel.z * dt;
      gk.pos.y = Math.max(0, gk.pos.y + gk.vy * dt);
      if (gk.pos.y === 0 && gk.vy < 0) gk.vy = 0;
      if (gk.diveTimer <= 0) {
        gk.diveState = 'none';
        gk.diveDirX = 0;
        gk.diveDirY = 0;
        gk.pos.y = 0;
      }
    } else if (input.gkQuickAction === 'jump') {
      gk.vy = 6.8;
      gk.diveTimer = 0.48;
      gk.diveState = 'jump';
      gk.diveDirX = 0;
      gk.diveDirY = 1;
      gk.vel.set(0, 0, 0);
      soccerAudio.playDiveWhoosh();
    } else if (input.gkJumpOrDive) {
      const jx = input.moveX;
      const jy = -input.moveZ; // UP on stick/ArrowUp (moveZ < 0) => positive jy (top corners)
      const mag = Math.hypot(jx, jy);
      if (mag > 0.12) {
        const nx = jx / mag;
        const ny = jy / mag;
        gk.vel.set(nx * 10.6, 0, 0);
        gk.vy = ny >= 0 ? 3.2 + ny * 4.8 : Math.max(1.1, 2.8 + ny * 1.9);
        gk.diveTimer = 0.48;
        gk.diveDirX = nx;
        gk.diveDirY = ny;
        gk.diveState = nx < -0.25 ? 'left' : nx > 0.25 ? 'right' : 'jump';
      } else {
        gk.vy = 6.8;
        gk.diveTimer = 0.48;
        gk.diveState = 'jump';
        gk.diveDirX = 0;
        gk.diveDirY = 1;
        gk.vel.set(0, 0, 0);
      }
      soccerAudio.playDiveWhoosh();
    } else {
      gk.pos.x += input.moveX * 4.5 * dt;
    }

    gk.pos.x = THREE.MathUtils.clamp(gk.pos.x, -4.6, 4.6);
    gk.pos.z = THREE.MathUtils.clamp(gk.pos.z, -halfL + 0.25, -halfL + 2.2);
    gk.rotY = 0;
  }

  private stepAiPenaltyGoalkeeper(gk: MatchActor, dt: number, halfL: number) {
    const so = this.shootoutState;
    if (!so) return;

    if (gk.diveTimer > 0) {
      gk.diveTimer -= dt;
      gk.vy -= 18 * dt;
      gk.pos.x += gk.vel.x * dt;
      gk.pos.y = Math.max(0, gk.pos.y + gk.vy * dt);
      if (gk.diveTimer <= 0) {
        gk.diveState = 'none';
        gk.diveDirX = 0;
        gk.diveDirY = 0;
        gk.pos.y = 0;
      }
    } else if (!so.aiGkDived && this.ballPos.z < -halfL + 8.8) {
      so.aiGkDived = true;
      // Balanced AI keeper: picks a side with slight bias toward ball direction, leaving top corners beatable
      const guessCorrect = Math.random() < 0.54;
      const ballSide = Math.abs(this.ballVel.x) > 1.2 ? Math.sign(this.ballVel.x) : (Math.random() > 0.5 ? 1 : -1);
      const diveDir = guessCorrect ? ballSide : -ballSide;
      const diveY = Math.random() > 0.45 ? 0.55 : -0.35;
      gk.vel.set(diveDir * 8.6, 0, 0);
      gk.vy = diveY > 0 ? 5.2 : 2.4;
      gk.diveTimer = 0.42;
      gk.diveDirX = diveDir;
      gk.diveDirY = diveY;
      gk.diveState = diveDir < 0 ? 'left' : 'right';
      soccerAudio.playDiveWhoosh();
    }
    gk.pos.x = THREE.MathUtils.clamp(gk.pos.x, -4.6, 4.6);
    gk.rotY = 0;
  }

  private finishShootoutKick(result: ShootoutKickResult, banner: string) {
    const so = this.shootoutState;
    if (!so || so.phase === 'result') return;

    so.phase = 'result';
    so.phaseTimer = 1.85;
    so.resultBanner = banner;

    if (so.turnTeam === 'home') {
      so.homeKicks.push(result);
      if (result === 'goal') so.homeScore += 1;
    } else {
      so.awayKicks.push(result);
      if (result === 'goal') so.awayScore += 1;
    }
  }

  private isShootoutDecided(): boolean {
    const so = this.shootoutState;
    if (!so) return false;
    const hTaken = so.homeKicks.length;
    const aTaken = so.awayKicks.length;

    if (hTaken <= 5 && aTaken <= 5) {
      const hRem = 5 - hTaken;
      const aRem = 5 - aTaken;
      if (so.homeScore > so.awayScore + aRem) return true;
      if (so.awayScore > so.homeScore + hRem) return true;
      if (hTaken === 5 && aTaken === 5 && so.homeScore !== so.awayScore) return true;
      return false;
    }

    // Sudden death: decided only after both teams have taken equal kicks in that round
    return hTaken === aTaken && so.homeScore !== so.awayScore;
  }

  private buildShootoutHudState(): ShootoutHudState | null {
    const so = this.shootoutState;
    if (!so || !so.active) return null;
    const kicker = this.actors.find((a) => a.id === so.kickerActorId);
    const gk = this.actors.find((a) => a.id === so.gkActorId);
    const localRole: ShootoutHudState['localRole'] =
      this.localControlledActorId === so.kickerActorId
        ? 'kicker'
        : this.localControlledActorId === so.gkActorId
          ? 'gk'
          : 'spectator';

    return {
      active: true,
      round: so.round,
      turnTeam: so.turnTeam,
      phase: so.phase,
      homeShootoutScore: so.homeScore,
      awayShootoutScore: so.awayScore,
      homeKicks: [...so.homeKicks],
      awayKicks: [...so.awayKicks],
      isSuddenDeath: so.isSuddenDeath,
      localRole,
      kickerName: kicker?.jerseyText || 'KICKER',
      gkName: gk?.jerseyText || 'GK',
      shotClockSeconds: Math.ceil(so.shotClock),
      resultBanner: so.resultBanner,
      aimX: so.aimX,
      aimY: so.aimY,
      activeKickerActorId: so.kickerActorId,
      activeGkActorId: so.gkActorId,
    };
  }

  // ------------------------------------------------------------------
  // MATCH HIGHLIGHTS RECORDING, SNAPSHOTS & 3D REPLAY PLAYBACK
  // ------------------------------------------------------------------
  private formatMatchClockLabel(): string {
    const elapsed = Math.max(0, Math.round(this.totalSeconds - this.timeRemainingSeconds));
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private recordBallTouch(actor: MatchActor) {
    if (!this.lastTouchActor || this.lastTouchActor.team !== actor.team) {
      if (actor.team === 'home') {
        this.homeTacticalPlan.counterTimer = 4.8;
        this.awayTacticalPlan.counterTimer = 0;
      } else {
        this.awayTacticalPlan.counterTimer = 4.8;
        this.homeTacticalPlan.counterTimer = 0;
      }
    }
    if (this.lastTouchActor && this.lastTouchActor.id !== actor.id) {
      this.prevTouchActor = { ...this.lastTouchActor };
    }
    this.lastTouchActor = {
      id: actor.id,
      team: actor.team,
      name: actor.jerseyText,
      number: actor.jerseyNumber,
      time: this.matchElapsedTime,
    };
  }

  private advanceHighlightRecording(dt: number) {
    this.matchElapsedTime += dt;
    this.highlightSampleAccum += dt;

    if (this.highlightSampleAccum >= 0.045) {
      this.highlightSampleAccum = 0;
      const frame: HighlightFrame = {
        t: this.matchElapsedTime,
        ball: {
          x: this.ballPos.x,
          y: this.ballPos.y,
          z: this.ballPos.z,
          vx: this.ballVel.x,
          vy: this.ballVel.y,
          vz: this.ballVel.z,
        },
        actors: this.actors.map((a) => ({
          id: a.id,
          x: a.pos.x,
          y: a.pos.y,
          z: a.pos.z,
          rotY: a.rotY,
          vx: a.vel.x,
          vz: a.vel.z,
          diveState: a.diveState,
          tackleTimer: a.tackleTimer,
          kickAnimTimer: a.kickAnimTimer,
        })),
      };
      this.highlightBuffer.push(frame);

      // Keep ~6.2 seconds of rolling history (~138 frames at 22Hz)
      const maxFrames = this.pendingGoalCapture ? 165 : 138;
      if (this.highlightBuffer.length > maxFrames) {
        this.highlightBuffer.shift();
      }
    }

    if (this.pendingGoalCapture) {
      this.pendingGoalCapture.tailTimer -= dt;
      if (this.pendingGoalCapture.tailTimer <= 0) {
        this.finalizePendingGoalCapture();
      }
    }
  }

  private captureGoalHighlight(
    scoringTeam: TeamSide,
    scorerName: string,
    scorerNumber: number,
    assistName: string | null,
    shotSpeedKmh: number,
  ) {
    // Flush any previous pending goal capture first
    this.finalizePendingGoalCapture();

    const club = scoringTeam === 'home' ? this.homeClub : this.awayClub;
    const goalNumber = this.goalHighlights.length + 1;
    const id = `goal_${goalNumber}_${Date.now()}`;
    const matchTimeLabel = this.formatMatchClockLabel();
    const scoreLabel = `${this.homeScore} – ${this.awayScore}`;

    const highlight: GoalHighlight = {
      id,
      goalNumber,
      scoringTeam,
      scoringClubName: club?.name || (scoringTeam === 'home' ? 'Home' : 'Away'),
      scoringClubShort: club?.shortName || (scoringTeam === 'home' ? 'HOM' : 'AWY'),
      scoringColor: club?.primaryColor || '#3B82F6',
      scorerName,
      scorerNumber,
      assistName,
      matchTimeLabel,
      homeScoreAfter: this.homeScore,
      awayScoreAfter: this.awayScore,
      shotSpeedKmh,
      snapshotDataUrl: '',
      frames: [],
      duration: 4.0,
      goalTimestamp: 3.2,
    };

    const snapshot: KeyPlaySnapshot = {
      id: `snap_${id}`,
      type: 'goal',
      title: `GOAL • ${highlight.scoringClubName}`,
      subtitle: `#${scorerNumber} ${scorerName}${assistName ? ` (Assist: ${assistName})` : ''} • ${shotSpeedKmh} km/h`,
      team: scoringTeam,
      clubShort: highlight.scoringClubShort,
      clubColor: highlight.scoringColor,
      playerName: `#${scorerNumber} ${scorerName}`,
      matchTimeLabel,
      scoreLabel,
      snapshotDataUrl: '',
      highlightId: id,
    };

    this.goalHighlights.push(highlight);
    this.keyPlaySnapshots.unshift(snapshot);

    // Queue broadcast close-up snapshot at the goal mouth
    const goalZ = scoringTeam === 'home' ? -this.fieldLength / 2 : this.fieldLength / 2;
    const zSign = goalZ < 0 ? 1 : -1;
    const sideSign = this.ballPos.x >= 0 ? -1 : 1;
    this.pendingSnapshotTasks.push({
      targetId: id,
      kind: 'goal',
      focusX: THREE.MathUtils.clamp(this.ballPos.x, -4, 4),
      focusY: 1.05,
      focusZ: goalZ + zSign * 1.4,
      camX: THREE.MathUtils.clamp(this.ballPos.x + sideSign * 7.8, -14, 14),
      camY: 3.1,
      camZ: goalZ + zSign * 11.5,
    });

    // Continue recording 0.78s post-goal tail so the ball finishes hitting the net in the replay
    const goalBufferTime = this.matchElapsedTime;
    this.pendingGoalCapture = {
      highlight,
      snapshot,
      startBufferTime: Math.max(0, goalBufferTime - 3.85),
      goalBufferTime,
      tailTimer: 0.78,
    };
  }

  private finalizePendingGoalCapture() {
    const pending = this.pendingGoalCapture;
    if (!pending) return;
    this.pendingGoalCapture = null;

    const sliced = this.highlightBuffer.filter((f) => f.t >= pending.startBufferTime);
    if (sliced.length === 0) return;

    const baseT = sliced[0].t;
    const frames: HighlightFrame[] = sliced.map((f) => ({
      t: Math.max(0, f.t - baseT),
      ball: { ...f.ball },
      actors: f.actors.map((a) => ({ ...a })),
    }));
    const duration = Math.max(1.2, frames[frames.length - 1].t);
    const goalTimestamp = THREE.MathUtils.clamp(
      pending.goalBufferTime - baseT,
      0.4,
      Math.max(0.5, duration - 0.3),
    );

    pending.highlight.frames = frames;
    pending.highlight.duration = duration;
    pending.highlight.goalTimestamp = goalTimestamp;
  }

  private queueKeyPlaySnapshot(
    type: Exclude<KeyPlayType, 'goal'>,
    team: TeamSide,
    playerName: string,
    title: string,
    subtitle: string,
  ) {
    const club = team === 'home' ? this.homeClub : this.awayClub;
    const id = `snap_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const snapshot: KeyPlaySnapshot = {
      id,
      type,
      title,
      subtitle,
      team,
      clubShort: club?.shortName || (team === 'home' ? 'HOM' : 'AWY'),
      clubColor: club?.primaryColor || '#3B82F6',
      playerName,
      matchTimeLabel: this.formatMatchClockLabel(),
      scoreLabel: `${this.homeScore} – ${this.awayScore}`,
      snapshotDataUrl: '',
    };

    // Keep all goals plus up to 8 non-goal key play snapshots
    const nonGoals = this.keyPlaySnapshots.filter((s) => s.type !== 'goal');
    if (nonGoals.length >= 8) {
      const removeCandidate =
        [...nonGoals].reverse().find((s) => s.type === 'shot') ?? nonGoals[nonGoals.length - 1];
      if (removeCandidate) {
        this.keyPlaySnapshots = this.keyPlaySnapshots.filter((s) => s.id !== removeCandidate.id);
      }
    }
    this.keyPlaySnapshots.push(snapshot);

    // Frame the key play dynamically toward the nearest goal/pitch center
    const towardCenterX = this.ballPos.x >= 0 ? -1 : 1;
    const towardCenterZ = this.ballPos.z >= 0 ? -1 : 1;
    this.pendingSnapshotTasks.push({
      targetId: id,
      kind: 'snapshot',
      focusX: this.ballPos.x,
      focusY: Math.max(0.85, this.ballPos.y),
      focusZ: this.ballPos.z,
      camX: THREE.MathUtils.clamp(this.ballPos.x + towardCenterX * 7.2, -this.fieldWidth / 2 + 2, this.fieldWidth / 2 - 2),
      camY: 2.85,
      camZ: THREE.MathUtils.clamp(this.ballPos.z + towardCenterZ * 9.5, -this.fieldLength / 2 - 2, this.fieldLength / 2 + 2),
    });
  }

  private processPendingSnapshots() {
    const tasks = this.pendingSnapshotTasks.splice(0);
    const dom = this.renderer.domElement;
    if (!this.snapshotCtx || dom.width === 0 || dom.height === 0) return;

    const aspect = dom.width / dom.height;
    this.replayCamera.aspect = aspect;
    this.replayCamera.updateProjectionMatrix();

    // Hide active ring briefly during broadcast snapshot capture for clean TV look
    const activeRings: { ring: THREE.Object3D; wasVisible: boolean }[] = [];
    for (const a of this.actors) {
      activeRings.push({ ring: a.rig.activeRing, wasVisible: a.rig.activeRing.visible });
      a.rig.activeRing.visible = false;
    }

    for (const task of tasks) {
      this.replayCamera.position.set(task.camX, task.camY, task.camZ);
      this.replayCamera.lookAt(task.focusX, task.focusY, task.focusZ);
      this.renderer.render(this.scene, this.replayCamera);

      const dataUrl = this.captureDomToThumbnail();
      if (!dataUrl) continue;

      if (task.kind === 'goal') {
        const hl = this.goalHighlights.find((h) => h.id === task.targetId);
        if (hl) hl.snapshotDataUrl = dataUrl;
        const snap = this.keyPlaySnapshots.find((s) => s.highlightId === task.targetId);
        if (snap) snap.snapshotDataUrl = dataUrl;
      } else {
        const snap = this.keyPlaySnapshots.find((s) => s.id === task.targetId);
        if (snap) snap.snapshotDataUrl = dataUrl;
      }
    }

    for (const item of activeRings) {
      item.ring.visible = item.wasVisible;
    }
  }

  private captureDomToThumbnail(): string {
    const ctx = this.snapshotCtx;
    const dom = this.renderer.domElement;
    if (!ctx || dom.width === 0 || dom.height === 0) return '';

    try {
      const targetW = this.snapshotCanvas.width;
      const targetH = this.snapshotCanvas.height;
      const srcRatio = dom.width / dom.height;
      const dstRatio = targetW / targetH;
      let sx = 0;
      let sy = 0;
      let sw = dom.width;
      let sh = dom.height;

      if (srcRatio > dstRatio) {
        sw = dom.height * dstRatio;
        sx = (dom.width - sw) / 2;
      } else {
        sh = dom.width / dstRatio;
        sy = (dom.height - sh) / 2;
      }

      ctx.drawImage(dom, sx, sy, sw, sh, 0, 0, targetW, targetH);
      return this.snapshotCanvas.toDataURL('image/jpeg', 0.84);
    } catch {
      return '';
    }
  }

  private updateReplayMode(dt: number) {
    const clip = this.activeReplay;
    if (!clip || clip.frames.length === 0) return;

    if (this.replayPlaying) {
      if (this.replayPauseTail > 0) {
        this.replayPauseTail -= dt;
        if (this.replayPauseTail <= 0) {
          this.replayTime = 0;
          this.replayGoalBurstFired = false;
        }
      } else {
        this.replayTime += dt * this.replaySpeed;
        if (this.replayTime >= clip.duration) {
          this.replayTime = clip.duration;
          this.replayPauseTail = 0.85;
        }
      }
    }

    const sampleDt = this.replayPlaying ? dt * this.replaySpeed : 0;
    this.sampleAndApplyReplayFrame(this.replayTime, sampleDt);

    if (!this.replayGoalBurstFired && this.replayTime >= clip.goalTimestamp) {
      this.replayGoalBurstFired = true;
      this.spawnBurst(this.ballPos.x, this.ballPos.y, this.ballPos.z, 18);
    }

    this.updateReplayCamera(dt, clip);
    this.crowdExcitement = 0.85;
    this.stadiumControls?.updateCrowdAnimation(this.clock.elapsedTime, this.crowdExcitement);

    this.replayEmitAccum += dt;
    if (this.replayEmitAccum >= 0.06) {
      this.replayEmitAccum = 0;
      this.emitReplayState();
    }
  }

  private sampleAndApplyReplayFrame(timeSec: number, dt: number) {
    const clip = this.activeReplay;
    if (!clip || clip.frames.length === 0) return;
    this.applyHighlightFrameAtTime(clip.frames, timeSec, dt);
  }

  private applyHighlightFrameAtTime(frames: HighlightFrame[], timeSec: number, dt: number) {
    if (frames.length === 0) return;

    let idxA = 0;
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i + 1].t >= timeSec) {
        idxA = i;
        break;
      }
      idxA = i;
    }
    const idxB = Math.min(frames.length - 1, idxA + 1);
    const frameA = frames[idxA];
    const frameB = frames[idxB];
    const span = Math.max(0.0001, frameB.t - frameA.t);
    const alpha = idxA === idxB ? 0 : THREE.MathUtils.clamp((timeSec - frameA.t) / span, 0, 1);

    this.ballPos.set(
      THREE.MathUtils.lerp(frameA.ball.x, frameB.ball.x, alpha),
      THREE.MathUtils.lerp(frameA.ball.y, frameB.ball.y, alpha),
      THREE.MathUtils.lerp(frameA.ball.z, frameB.ball.z, alpha),
    );
    this.ballVel.set(
      THREE.MathUtils.lerp(frameA.ball.vx, frameB.ball.vx, alpha),
      THREE.MathUtils.lerp(frameA.ball.vy, frameB.ball.vy, alpha),
      THREE.MathUtils.lerp(frameA.ball.vz, frameB.ball.vz, alpha),
    );

    for (const poseA of frameA.actors) {
      const actor = this.actors.find((a) => a.id === poseA.id);
      if (!actor) continue;
      const poseB = frameB.actors.find((b) => b.id === poseA.id) ?? poseA;
      actor.pos.set(
        THREE.MathUtils.lerp(poseA.x, poseB.x, alpha),
        THREE.MathUtils.lerp(poseA.y, poseB.y, alpha),
        THREE.MathUtils.lerp(poseA.z, poseB.z, alpha),
      );
      actor.vel.set(
        THREE.MathUtils.lerp(poseA.vx, poseB.vx, alpha),
        0,
        THREE.MathUtils.lerp(poseA.vz, poseB.vz, alpha),
      );
      actor.rotY = this.lerpAngle(poseA.rotY, poseB.rotY, alpha);
      actor.diveState = alpha > 0.5 ? poseB.diveState : poseA.diveState;
      actor.tackleTimer = THREE.MathUtils.lerp(poseA.tackleTimer, poseB.tackleTimer, alpha);
      actor.kickAnimTimer = THREE.MathUtils.lerp(poseA.kickAnimTimer, poseB.kickAnimTimer, alpha);
    }

    this.animateAllActorRigs(dt);
    for (const a of this.actors) {
      a.rig.activeRing.visible = false;
      a.rig.staminaArc.visible = false;
    }
    this.syncBallVisual(dt);
  }

  private snapReplayCameraToClip(clip: GoalHighlight) {
    this.computeReplayCameraPose(clip, _camPos, _camTarget);
    this.camera.position.copy(_camPos);
    this.camera.lookAt(_camTarget);
  }

  private updateReplayCamera(dt: number, clip: GoalHighlight) {
    this.computeReplayCameraPose(clip, _camPos, _camTarget);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 7, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 7, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 7, dt);
    this.camera.lookAt(_camTarget);

    this.keyLight.position.set(this.ballPos.x + 22, 42, this.ballPos.z + 18);
    this.keyLight.target.position.set(this.ballPos.x, 0, this.ballPos.z);
    this.keyLight.target.updateMatrixWorld();
  }

  private computeReplayCameraPose(
    clip: GoalHighlight,
    outPos: THREE.Vector3,
    outTarget: THREE.Vector3,
  ) {
    const goalZ = clip.scoringTeam === 'home' ? -this.fieldLength / 2 : this.fieldLength / 2;

    if (this.replayCameraAngle === 'goalcam') {
      const zOut = goalZ < 0 ? -4.8 : 4.8;
      outPos.set(
        THREE.MathUtils.clamp(this.ballPos.x * 0.35, -3.2, 3.2),
        2.3,
        goalZ + zOut,
      );
      outTarget.set(this.ballPos.x * 0.7, Math.max(0.85, this.ballPos.y), this.ballPos.z);
      return;
    }

    if (this.replayCameraAngle === 'scorercam') {
      const scorer =
        this.actors.find(
          (a) =>
            a.team === clip.scoringTeam &&
            a.jerseyText === clip.scorerName &&
            a.jerseyNumber === clip.scorerNumber,
        ) ?? this.actors.find((a) => a.team === clip.scoringTeam && a.role === 'outfield');

      if (scorer) {
        const fx = Math.sin(scorer.rotY);
        const fz = Math.cos(scorer.rotY);
        outPos.set(scorer.pos.x - fx * 6.8 + 1.4, scorer.pos.y + 3.2, scorer.pos.z - fz * 6.8);
        outTarget.set(
          (scorer.pos.x + this.ballPos.x) * 0.5,
          1.15,
          (scorer.pos.z + this.ballPos.z) * 0.5,
        );
        return;
      }
    }

    // Default: Elevated TV Broadcast sideline camera
    const sidelineX = Math.min(24, this.fieldWidth * 0.44);
    outPos.set(
      this.ballPos.x * 0.35 + sidelineX,
      10.8,
      THREE.MathUtils.clamp(this.ballPos.z * 0.65 + (goalZ < 0 ? 11 : -11), -this.fieldLength / 2, this.fieldLength / 2),
    );
    outTarget.set(this.ballPos.x * 0.75, Math.max(0.9, this.ballPos.y * 0.6), this.ballPos.z * 0.9);
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  private emitReplayState() {
    const clip = this.activeReplay;
    if (!clip) {
      this.callbacks.onReplayUpdate?.(null);
      return;
    }
    this.callbacks.onReplayUpdate?.({
      activeHighlightId: clip.id,
      goalNumber: clip.goalNumber,
      scoringClubShort: clip.scoringClubShort,
      scoringColor: clip.scoringColor,
      scorerName: `#${clip.scorerNumber} ${clip.scorerName}`,
      matchTimeLabel: clip.matchTimeLabel,
      scoreLabel: `${clip.homeScoreAfter} – ${clip.awayScoreAfter}`,
      playing: this.replayPlaying,
      speed: this.replaySpeed,
      currentTime: this.replayTime,
      duration: clip.duration,
      goalTimestamp: clip.goalTimestamp,
      cameraAngle: this.replayCameraAngle,
      goalBannerVisible:
        this.replayTime >= clip.goalTimestamp && this.replayTime <= clip.goalTimestamp + 1.2,
    });
  }

  private updateCrowdExcitementAndMesh(dt: number) {
    let target = 0.2;
    const nearBox = Math.abs(this.ballPos.z) > this.fieldLength / 2 - 17;
    if (this.goalResetTimer > 0 || this.crowdBoostTimer > 0 || this.liveGoalReplayState?.active) {
      target = 1.0;
    } else if (this.shootoutState?.active) {
      target = this.shootoutState.phase === 'result' ? 0.95 : 0.62;
    } else if (nearBox) {
      target = 0.56;
    }
    this.crowdExcitement = THREE.MathUtils.damp(this.crowdExcitement, target, 4.5, dt);
    soccerAudio.setCrowdExcitement(this.crowdExcitement);
    this.stadiumControls?.updateCrowdAnimation(this.clock.elapsedTime, this.crowdExcitement);
  }

  private animateAllActorRigs(dt: number) {
    for (const actor of this.actors) {
      if (actor.kickAnimTimer > 0) actor.kickAnimTimer -= dt;

      const speed = Math.hypot(actor.vel.x, actor.vel.z);
      actor.stridePhase += speed * dt * 1.45;

      actor.rig.root.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
      actor.rig.root.rotation.y = actor.rotY;
      const isLocal = actor.id === this.localControlledActorId;
      actor.rig.activeRing.visible = isLocal;

      const showStamina =
        isLocal &&
        actor.role === 'outfield' &&
        !this.shootoutState?.active &&
        !this.liveGoalReplayState?.active;
      actor.rig.staminaArc.visible = showStamina;
      if (showStamina) {
        const segs = Math.max(2, Math.round((actor.stamina / 100) * 32));
        actor.rig.staminaArc.geometry.setDrawRange(0, segs * 6);
        actor.rig.staminaMat.color.set(
          actor.stamina > 55 ? '#34D399' : actor.stamina > 25 ? '#FACC15' : '#FB7185',
        );
      }

      // Dive / Jump / Tackle / Run procedural kinematics
      if (actor.diveState === 'left' || actor.diveState === 'right') {
        const dirX = actor.diveDirX !== 0 ? actor.diveDirX : (actor.diveState === 'left' ? -1 : 1);
        const dirY = actor.diveDirY;
        const targetRollZ = -dirX * (1.28 - Math.max(0, dirY) * 0.45);
        const targetTiltX = dirY < -0.25 ? 0.22 : 0;
        actor.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(
          actor.rig.bodyGroup.rotation.z,
          targetRollZ,
          14,
          dt,
        );
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(
          actor.rig.bodyGroup.rotation.x,
          targetTiltX,
          14,
          dt,
        );
        actor.rig.leftArm.rotation.z = 2.75;
        actor.rig.rightArm.rotation.z = -2.75;
        actor.rig.leftLeg.rotation.x = 0.15;
        actor.rig.rightLeg.rotation.x = -0.15;
      } else if (actor.diveState === 'jump') {
        actor.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.z, 0, 14, dt);
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.x, 0, 14, dt);
        actor.rig.leftArm.rotation.z = 2.85;
        actor.rig.rightArm.rotation.z = -2.85;
        actor.rig.leftLeg.rotation.x = 0.12;
        actor.rig.rightLeg.rotation.x = 0.12;
      } else if (actor.diveState === 'forward') {
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.x, 1.15, 14, dt);
        actor.rig.leftArm.rotation.x = -2.4;
        actor.rig.rightArm.rotation.x = -2.4;
      } else if (actor.tackleTimer > 0) {
        actor.rig.bodyGroup.position.y = THREE.MathUtils.damp(actor.rig.bodyGroup.position.y, -0.44, 16, dt);
        actor.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.z, 0.14, 14, dt);
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.x, -0.95, 16, dt);
        actor.rig.rightLeg.rotation.x = -1.25;
        actor.rig.leftLeg.rotation.x = 0.55;
        actor.rig.leftArm.rotation.x = 0.6;
        actor.rig.rightArm.rotation.x = -0.45;
      } else if (actor.standTackleTimer > 0) {
        actor.rig.bodyGroup.position.y = THREE.MathUtils.damp(actor.rig.bodyGroup.position.y, 0, 16, dt);
        actor.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.z, 0, 14, dt);
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.x, 0.24, 16, dt);
        actor.rig.rightLeg.rotation.x = -0.95;
        actor.rig.leftLeg.rotation.x = 0.25;
      } else {
        actor.rig.bodyGroup.position.y = THREE.MathUtils.damp(actor.rig.bodyGroup.position.y, 0, 16, dt);
        actor.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.z, 0, 14, dt);
        actor.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(actor.rig.bodyGroup.rotation.x, 0, 14, dt);
        actor.rig.leftArm.rotation.z = 0;
        actor.rig.rightArm.rotation.z = 0;

        if (actor.kickAnimTimer > 0) {
          actor.rig.rightLeg.rotation.x = -1.05;
          actor.rig.leftLeg.rotation.x = 0.35;
          actor.rig.leftArm.rotation.x = -0.6;
          actor.rig.rightArm.rotation.x = 0.5;
        } else if (speed > 0.35) {
          const swing = Math.sin(actor.stridePhase) * Math.min(0.85, speed * 0.08);
          actor.rig.leftLeg.rotation.x = swing;
          actor.rig.rightLeg.rotation.x = -swing;
          actor.rig.leftArm.rotation.x = -swing * 0.7;
          actor.rig.rightArm.rotation.x = swing * 0.7;
        } else {
          actor.rig.leftLeg.rotation.x = THREE.MathUtils.damp(actor.rig.leftLeg.rotation.x, 0, 12, dt);
          actor.rig.rightLeg.rotation.x = THREE.MathUtils.damp(actor.rig.rightLeg.rotation.x, 0, 12, dt);
          actor.rig.leftArm.rotation.x = THREE.MathUtils.damp(actor.rig.leftArm.rotation.x, 0, 12, dt);
          actor.rig.rightArm.rotation.x = THREE.MathUtils.damp(actor.rig.rightArm.rotation.x, 0, 12, dt);
        }
      }

      // Lightweight Hair Physics on High Graphics Quality for longer hairstyles
      if (actor.rig.hairHasPhysics && actor.rig.dynamicHairGroup) {
        if (this.graphicsQuality === 'high') {
          const runTrail = Math.min(0.28, speed * 0.022);
          const strideBounce =
            speed > 0.35 ? Math.abs(Math.sin(actor.stridePhase)) * Math.min(0.14, speed * 0.012) : 0;
          const jumpLag = THREE.MathUtils.clamp(-actor.vy * 0.035, -0.18, 0.22);
          const targetHairX = -runTrail - strideBounce + jumpLag;
          const targetHairZ =
            speed > 0.35 ? Math.cos(actor.stridePhase) * Math.min(0.08, speed * 0.008) : 0;
          actor.rig.dynamicHairGroup.rotation.x = THREE.MathUtils.damp(
            actor.rig.dynamicHairGroup.rotation.x,
            targetHairX,
            12,
            dt,
          );
          actor.rig.dynamicHairGroup.rotation.z = THREE.MathUtils.damp(
            actor.rig.dynamicHairGroup.rotation.z,
            targetHairZ,
            10,
            dt,
          );
        } else {
          actor.rig.dynamicHairGroup.rotation.set(0, 0, 0);
        }
      }

      // Ground contact shadow stays at turf y = 0.015 even when GK jumps
      actor.rig.contactShadow.position.y = 0.015 - actor.pos.y;
    }
  }

  private syncBallVisual(dt: number) {
    if (!this.ballVisual) return;
    this.ballVisual.group.position.copy(this.ballPos);
    this.ballVisual.ballShadow.position.set(this.ballPos.x, 0.015, this.ballPos.z);

    const speed = Math.hypot(this.ballVel.x, this.ballVel.z);
    if (speed > 0.08) {
      _ballAxis.set(this.ballVel.z, 0, -this.ballVel.x).normalize();
      this.ballVisual.ballMesh.rotateOnWorldAxis(_ballAxis, (speed * dt) / 0.24);
    }
  }

  private updateParticles(dt: number) {
    for (const p of this.particlePool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= 15 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.life / p.maxLife);
    }
  }

  private updateMatchCamera(dt: number) {
    // Cinematic 4-Scene Broadcast Pre-Match Camera
    const pmHud = this.buildPreMatchHudState();
    if (pmHud?.active) {
      if (Math.abs(this.camera.fov - 44) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 44, 10, dt);
        this.camera.updateProjectionMatrix();
      }
      const elapsed = this.preMatchState?.elapsed ?? 14.5 - pmHud.countdownSeconds;
      if (pmHud.scene === 1) {
        // Sweeping Stadium Drone descending toward midfield walkout
        const p = THREE.MathUtils.clamp(elapsed / 3.2, 0, 1);
        _camPos.set(
          THREE.MathUtils.lerp(-this.fieldWidth * 0.42, -5.5, p),
          THREE.MathUtils.lerp(20.5, 8.2, p),
          THREE.MathUtils.lerp(24.0, 12.5, p),
        );
        _camTarget.set(-8 * (1 - p), 1.1, 0);
      } else if (pmHud.scene === 2) {
        // Smooth horizontal broadcast pan across players' faces in line-up
        const p = THREE.MathUtils.clamp((elapsed - 3.2) / 3.0, 0, 1);
        const panX = THREE.MathUtils.lerp(-9.5, 9.5, p);
        _camPos.set(panX, 1.85, 6.2);
        _camTarget.set(panX + 1.2, 1.38, 1.4);
      } else if (pmHud.scene === 3) {
        // Rising tactical stadium pan as players jog to formation
        const p = THREE.MathUtils.clamp((elapsed - 6.2) / 2.6, 0, 1);
        _camPos.set(THREE.MathUtils.lerp(10, 0, p), THREE.MathUtils.lerp(6.5, 19.5, p), THREE.MathUtils.lerp(14, 24, p));
        _camTarget.set(0, 0.8, 0);
      } else {
        // Elevated midfield broadcast vista behind tactical lineup overlay
        const sway = Math.sin(elapsed * 0.6) * 4.5;
        _camPos.set(sway, 18.5, 25.0);
        _camTarget.set(0, 0.6, 0);
      }

      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 5.5, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 5.5, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 5.5, dt);
      this.camera.lookAt(_camTarget);
      this.keyLight.position.set(22, 44, 18);
      this.keyLight.target.position.set(0, 0, 0);
      this.keyLight.target.updateMatrixWorld();
      return;
    }

    // Live 3-Second Slow-Motion Broadcast Goal Replay Camera (synced to LAN clients too)
    const lrHud = this.buildLiveGoalReplayHudState();
    if (lrHud?.active) {
      if (Math.abs(this.camera.fov - 46) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 46, 10, dt);
        this.camera.updateProjectionMatrix();
      }
      const scoringTeam: TeamSide =
        this.liveGoalReplayState?.scoringTeam ?? (this.kickoffTeam === 'home' ? 'away' : 'home');
      const goalZ = scoringTeam === 'home' ? -this.fieldLength / 2 : this.fieldLength / 2;
      const sidelineX = Math.min(22, this.fieldWidth * 0.42);
      _camPos.set(
        this.ballPos.x * 0.35 + sidelineX,
        8.6,
        THREE.MathUtils.clamp(
          this.ballPos.z * 0.6 + (goalZ < 0 ? 10 : -10),
          -this.fieldLength / 2,
          this.fieldLength / 2,
        ),
      );
      _camTarget.set(this.ballPos.x * 0.8, Math.max(0.9, this.ballPos.y * 0.65), this.ballPos.z * 0.92);

      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 8, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 8, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 8, dt);
      this.camera.lookAt(_camTarget);
      this.keyLight.position.set(this.ballPos.x + 22, 42, this.ballPos.z + 18);
      this.keyLight.target.position.set(this.ballPos.x, 0, this.ballPos.z);
      this.keyLight.target.updateMatrixWorld();
      return;
    }

    // Unified Expanded Broadcast Penalty Shootout Camera (frames kicker's full body head-to-boots + goal)
    if (this.shootoutState?.active) {
      const so = this.shootoutState;
      const halfL = this.fieldLength / 2;
      const penZ = -halfL + 11.0;
      const isLocalKicker = this.localControlledActorId === so.kickerActorId;

      if (this.shootoutAimMarker) {
        this.shootoutAimMarker.visible = isLocalKicker && so.phase === 'aiming';
        this.shootoutAimMarker.position.set(so.aimX, so.aimY, -halfL + 0.12);
      }

      const targetFov = this.camera.aspect < 1.1 ? 64 : 58;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
        this.camera.updateProjectionMatrix();
      }

      _camPos.set(0, 3.25, penZ + 10.6);
      _camTarget.set(0, 1.15, -halfL + 2.2);

      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 14, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 14, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 14, dt);
      this.camera.lookAt(_camTarget);

      this.keyLight.position.set(16, 38, -halfL + 22);
      this.keyLight.target.position.set(0, 0, -halfL + 6);
      this.keyLight.target.updateMatrixWorld();
      return;
    }

    if (Math.abs(this.camera.fov - 46) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 46, 10, dt);
      this.camera.updateProjectionMatrix();
    }

    if (this.shootoutAimMarker) {
      this.shootoutAimMarker.visible = false;
    }

    // Strictly lock onto the local controlled player instance (no ball-tracking or blending)
    const active =
      this.actors.find((a) => a.id === this.localControlledActorId) ?? this.actors[0];
    if (!active) return;

    if (this.justPressedKeys.has('KeyR')) {
      this.resetCameraOrbit();
    }

    // Apply right-stick or keyboard J/L smooth orbit around the player
    let stickX = this.cameraLookStick.x;
    const stickY = this.cameraLookStick.y;
    if (this.heldKeys.has('KeyJ')) stickX -= 1;
    if (this.heldKeys.has('KeyL')) stickX += 1;

    if (Math.abs(stickX) > 0.05) {
      this.manualOrbitYaw -= stickX * 2.35 * dt;
    }
    if (Math.abs(stickY) > 0.05) {
      this.manualOrbitPitch = THREE.MathUtils.clamp(
        this.manualOrbitPitch + stickY * 1.35 * dt,
        0.22,
        0.86,
      );
    }

    const baseYaw = active.team === 'home' ? 0 : Math.PI;
    const isQuickGlancing =
      this.quickGlanceHeld || this.heldKeys.has('KeyV') || this.heldKeys.has('KeyC');

    // Quick-Glance rotates the camera around the player's own pivot toward the ball's bearing
    // while keeping the camera target 100% locked onto the player's character.
    let targetYaw = baseYaw + this.manualOrbitYaw;
    if (isQuickGlancing) {
      const dx = active.pos.x - this.ballPos.x;
      const dz = active.pos.z - this.ballPos.z;
      if (dx * dx + dz * dz > 0.25) {
        targetYaw = Math.atan2(dx, dz);
      }
    }

    this.smoothCameraYaw = this.dampAngle(this.smoothCameraYaw, targetYaw, 11, dt);
    this.smoothCameraPitch = THREE.MathUtils.damp(
      this.smoothCameraPitch,
      this.manualOrbitPitch,
      11,
      dt,
    );

    const isGk = active.role === 'goalkeeper';
    const followDist = isGk ? 11.5 : 14.2;
    const pivotY = active.pos.y + 1.45;
    const horizDist = followDist * Math.cos(this.smoothCameraPitch);

    _camPos.set(
      active.pos.x + horizDist * Math.sin(this.smoothCameraYaw),
      pivotY + followDist * Math.sin(this.smoothCameraPitch),
      active.pos.z + horizDist * Math.cos(this.smoothCameraYaw),
    );

    if (this.cameraShake > 0.005) {
      _camPos.x += (Math.random() - 0.5) * this.cameraShake;
      _camPos.y += (Math.random() - 0.5) * this.cameraShake * 0.6;
      this.cameraShake = THREE.MathUtils.damp(this.cameraShake, 0, 10, dt);
    }

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 12, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 12, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 12, dt);

    _camTarget.set(active.pos.x, pivotY, active.pos.z);
    this.camera.lookAt(_camTarget);

    // Keep shadow light centered on the controlled player
    this.keyLight.position.set(active.pos.x + 22, 42, active.pos.z + 18);
    this.keyLight.target.position.set(active.pos.x, 0, active.pos.z);
    this.keyLight.target.updateMatrixWorld();
  }

  private clampToPitch(pos: THREE.Vector3) {
    const marginX = this.fieldWidth / 2 + 1.2;
    const marginZ = this.fieldLength / 2 + 1.2;
    pos.x = THREE.MathUtils.clamp(pos.x, -marginX, marginX);
    pos.z = THREE.MathUtils.clamp(pos.z, -marginZ, marginZ);
  }

  private dampAngle(current: number, target: number, lambda: number, dt: number): number {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * (1 - Math.exp(-lambda * dt));
  }

  private setHint(text: string) {
    this.lastActionHint = text;
    this.actionHintTimer = 1.6;
  }

  private emitLanSnapshot() {
    this.snapshotTick += 1;
    const players: SyncedPlayerState[] = this.actors.map((a) => ({
      id: a.id,
      team: a.team,
      role: a.role,
      x: a.pos.x,
      y: a.pos.y,
      z: a.pos.z,
      rotY: a.rotY,
      vx: a.vel.x,
      vz: a.vel.z,
      stamina: a.stamina,
      diveState: a.diveState,
      diveDirX: a.diveDirX,
      diveDirY: a.diveDirY,
      tackleTimer: a.tackleTimer,
      standTackleTimer: a.standTackleTimer,
      jerseyText: a.jerseyText,
      jerseyNumber: a.jerseyNumber,
      skinTone: a.skinTone,
      hairColor: a.hairColor,
      hairStyle: a.hairStyle,
      bootColor: a.bootColor,
      controlledByClientId: a.controlledByClientId,
    }));

    const localControlledMap: Record<string, string> = {};
    if (this.shootoutState?.active) {
      const kicker = this.actors.find((a) => a.id === this.shootoutState?.kickerActorId);
      const gk = this.actors.find((a) => a.id === this.shootoutState?.gkActorId);
      if (kicker?.controlledByClientId) localControlledMap[kicker.controlledByClientId] = kicker.id;
      if (gk?.controlledByClientId) localControlledMap[gk.controlledByClientId] = gk.id;
    } else {
      for (const [cid, aid] of this.lanClientActiveActor.entries()) {
        localControlledMap[cid] = aid;
      }
    }

    this.callbacks.onLanSnapshotEmit?.({
      tick: this.snapshotTick,
      clockSeconds: this.timeRemainingSeconds,
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      kickoffTeam: this.kickoffTeam,
      goalBanner: this.goalBanner,
      setPiece: this.buildSetPieceHudState(),
      shootout: this.buildShootoutHudState(),
      preMatch: this.buildPreMatchHudState(),
      liveGoalReplay: this.buildLiveGoalReplayHudState(),
      secondDefenderHomeActive: this.homeSecondDefTimer > 0,
      secondDefenderAwayActive: this.awaySecondDefTimer > 0,
      localControlledMap:
        Object.keys(localControlledMap).length > 0 ? localControlledMap : undefined,
      stats: { ...this.matchStats },
      ball: {
        x: this.ballPos.x,
        y: this.ballPos.y,
        z: this.ballPos.z,
        vx: this.ballVel.x,
        vy: this.ballVel.y,
        vz: this.ballVel.z,
      },
      players,
    });
  }

  private buildSetPieceHudState(): SetPieceHudState | null {
    if (this.lanMode === 'client') {
      if (!this.setPieceClientMirror) return null;
      const active = this.actors.find((a) => a.id === this.localControlledActorId);
      return {
        ...this.setPieceClientMirror,
        isLocalTaker: Boolean(
          active &&
            this.setPieceClientMirror.isHumanTaker &&
            active.team === this.setPieceClientMirror.team &&
            active.jerseyText === this.setPieceClientMirror.takerName,
        ),
      };
    }
    const sp = this.setPieceState;
    if (!sp) return null;
    const club = sp.team === 'home' ? this.homeClub : this.awayClub;
    const taker = this.actors.find((a) => a.id === sp.takerId);
    const isHumanTaker = Boolean(taker && this.isHumanControlledActor(taker));
    return {
      active: true,
      kind: sp.kind,
      team: sp.team,
      clubShort: club?.shortName || (sp.team === 'home' ? 'HOM' : 'AWY'),
      takerName: taker?.jerseyText || 'PLAYER',
      isLocalTaker: taker?.id === this.localControlledActorId,
      isHumanTaker,
      countdownSeconds: isHumanTaker ? null : Math.max(1, Math.ceil(sp.countdown)),
    };
  }

  private buildLiveGoalReplayHudState(): LiveGoalReplayHudState | null {
    if (this.lanMode === 'client') {
      return this.liveGoalReplayClientMirror;
    }
    const lr = this.liveGoalReplayState;
    if (!lr || !lr.active) return null;
    return {
      active: true,
      scoringClubShort: lr.scoringClubShort,
      scoringColor: lr.scoringColor,
      scorerLabel: lr.scorerLabel,
      remainingSeconds: Math.max(0, lr.duration - lr.elapsed),
    };
  }

  private buildRadarHudState(): RadarHudState | null {
    if (this.mode !== 'match' || this.actors.length === 0) return null;
    const halfW = Math.max(1, this.fieldWidth / 2);
    const halfL = Math.max(1, this.fieldLength / 2);
    return {
      players: this.actors.map((a) => ({
        id: a.id,
        team: a.team,
        role: a.role,
        xNorm: THREE.MathUtils.clamp(a.pos.x / halfW, -1, 1),
        zNorm: THREE.MathUtils.clamp(a.pos.z / halfL, -1, 1),
        isLocal: a.id === this.localControlledActorId,
      })),
      ballXNorm: THREE.MathUtils.clamp(this.ballPos.x / halfW, -1, 1),
      ballZNorm: THREE.MathUtils.clamp(this.ballPos.z / halfL, -1, 1),
    };
  }

  private emitHud() {
    const active =
      this.actors.find((a) => a.id === this.localControlledActorId) ?? this.actors[0];
    const activeTeam: TeamSide = active?.team || 'home';
    const teamHasBall = this.computeTeamHasBall(activeTeam);
    const secondDefenderActive =
      this.lanMode === 'client'
        ? activeTeam === 'home'
          ? this.secondDefenderHomeClientMirror
          : this.secondDefenderAwayClientMirror
        : activeTeam === 'home'
          ? this.homeSecondDefTimer > 0
          : this.awaySecondDefTimer > 0;
    const isQuickGlancing =
      this.quickGlanceHeld || this.heldKeys.has('KeyV') || this.heldKeys.has('KeyC');
    this.callbacks.onHudUpdate({
      homeScore: this.homeScore,
      awayScore: this.awayScore,
      timeRemainingSeconds: this.timeRemainingSeconds,
      totalSeconds: this.totalSeconds,
      homeClubName: this.homeClub?.shortName || 'HOM',
      awayClubName: this.awayClub?.shortName || 'AWY',
      homeColor: this.homeClub?.primaryColor || '#3B82F6',
      awayColor: this.awayClub?.primaryColor || '#EF4444',
      activePlayerName: active?.jerseyText || 'PLAYER',
      activeRole: active?.role || 'outfield',
      localTeam: activeTeam,
      canSwitchPlayer: this.canSwitchTeamPlayers(),
      stamina: active?.stamina ?? 100,
      hasBall: this.ballOwnerId === active?.id,
      teamHasBall,
      secondDefenderActive,
      kickoffTeam: this.kickoffTeam,
      goalBanner: this.goalBanner,
      lastActionHint: this.lastActionHint,
      cameraOrbited: Math.abs(this.manualOrbitYaw) > 0.08,
      quickGlancing: isQuickGlancing,
      highlightsCount: this.goalHighlights.length,
      shootout: this.buildShootoutHudState(),
      setPiece: this.buildSetPieceHudState(),
      liveGoalReplay: this.buildLiveGoalReplayHudState(),
      preMatch: this.buildPreMatchHudState(),
      radar: this.buildRadarHudState(),
      lanNotice: this.lanNotice,
    });
  }

  public dispose() {
    this.disposed = true;
    soccerAudio.stopMenuMusic();
    soccerAudio.stopStadiumAmbience();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    dom.removeEventListener('pointermove', this.handleCanvasPointerMove);
    dom.removeEventListener('pointerup', this.handleCanvasPointerUp);
    dom.removeEventListener('pointercancel', this.handleCanvasPointerUp);

    this.clearShowcase();
    this.clearMatch();
    this.sharedShadowTexture.dispose();

    for (const p of this.particlePool) {
      p.mesh.geometry.dispose();
      if (Array.isArray(p.mesh.material)) p.mesh.material.forEach((m) => m.dispose());
      else p.mesh.material.dispose();
    }

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    void _upVec;
  }
}
