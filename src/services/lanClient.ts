import {
  MATCH_SIZE_COUNTS,
  type ClientMatchInput,
  type DrawDecisionState,
  type DrawVoteOption,
  type LanLobbyPlayer,
  type LanMatchSettings,
  type LanRoomState,
  type LanRoomSummary,
  type MatchSize,
  type PlayerProfile,
  type PlayerRole,
  type SyncedMatchSnapshot,
  type TeamSide,
} from '../types/game';

export interface LanClientCallbacks {
  onWelcome?: (clientId: string) => void;
  onRoomsList?: (rooms: LanRoomSummary[]) => void;
  onRoomState?: (room: LanRoomState | null) => void;
  onRoomError?: (message: string) => void;
  onMatchStart?: (room: LanRoomState, kickoffTeam: TeamSide, rejoin?: boolean) => void;
  onHostMigrated?: (hostClientId: string, room: LanRoomState) => void;
  onPreMatchSkip?: () => void;
  onMatchSnapshot?: (snapshot: SyncedMatchSnapshot) => void;
  onClientInput?: (clientId: string, input: ClientMatchInput) => void;
  onDrawState?: (state: DrawDecisionState) => void;
  onDrawResolution?: (decision: DrawVoteOption) => void;
  onMatchEnd?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface LanSignalingState {
  transportMode: 'ws' | 'local';
  wsConnected: boolean;
  wsConnecting: boolean;
  serverHost: string;
  roomCode: string | null;
  statusMessage: string;
  joinStatus: 'idle' | 'connecting' | 'connected' | 'error';
  joinTargetCode: string | null;
  joinError: string | null;
}

export type P2PSignalingState = LanSignalingState;

interface HostRoomInternal extends LanRoomState {
  countdownTimer?: number | null;
  drawPending: boolean;
  drawVotes: Record<string, DrawVoteOption>;
  drawHomeScore: number;
  drawAwayScore: number;
  drawExtraTimeCount: number;
}

const MAX_LAN_PLAYERS = 12;
const BROADCAST_CHANNEL_NAME = 'pro_titanic_soccer_lan_v2';
const CUSTOM_SERVER_HOST_STORAGE_KEY = 'pts_lan_server_host';
const ROOM_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeShortRoomCode(raw: string | undefined | null): string {
  return String(raw ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6);
}

export function generateShortRoomCode(length = 4): string {
  const clamped = Math.max(4, Math.min(6, length));
  let code = '';
  for (let i = 0; i < clamped; i += 1) {
    code += ROOM_CODE_CHARSET[Math.floor(Math.random() * ROOM_CODE_CHARSET.length)];
  }
  return code;
}

function normalizeServerHostInput(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(https?:\/\/|wss?:\/\/)/i, '')
    .replace(/\/+.*$/, '');
  if (!cleaned) return '';
  // Append default signaling port if user typed bare IP like 192.168.43.1
  if (!cleaned.includes(':')) {
    return `${cleaned}:3000`;
  }
  return cleaned;
}

const activeClientsById = new Map<string, LanWebSocketClient>();
let latestClientInstance: LanWebSocketClient | null = null;

export function getLanClientInstance(clientId?: string): LanWebSocketClient | null {
  if (clientId && activeClientsById.has(clientId)) {
    return activeClientsById.get(clientId) ?? null;
  }
  return latestClientInstance;
}

function getPlayersPerTeam(matchSize: MatchSize | undefined): number {
  return MATCH_SIZE_COUNTS[matchSize || '5v5'] ?? 5;
}

function getRoomMaxPlayers(matchSize: MatchSize | undefined): number {
  return Math.min(MAX_LAN_PLAYERS, getPlayersPerTeam(matchSize) * 2);
}

function toPublicRoomState(room: HostRoomInternal): LanRoomState {
  return {
    roomId: room.roomId,
    hostName: room.hostName,
    settings: { ...room.settings },
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    players: room.players.map((p) => ({ ...p })),
    kickoffTeam: room.kickoffTeam,
    countdownSeconds: room.countdownSeconds,
  };
}

function toRoomSummary(room: HostRoomInternal): LanRoomSummary {
  return {
    roomId: room.roomId,
    hostName: room.hostName,
    settings: { ...room.settings },
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
  };
}

function loadSavedServerHost(): string {
  try {
    return localStorage.getItem(CUSTOM_SERVER_HOST_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export class LanWebSocketClient {
  private callbacks: LanClientCallbacks = {};
  private clientId: string;
  private isInitialized = false;

  // Authoritative session transport & role
  private sessionTransport: 'none' | 'ws' | 'local' = 'none';
  private roleMode: 'none' | 'host' | 'client' = 'none';
  private currentRoomIsHost = false;

  // WebSocket signaling transport (primary when server or LAN IP is reachable)
  private ws: WebSocket | null = null;
  private wsHeartbeatTimer: number | null = null;
  private wsReconnectTimer: number | null = null;
  private wsRooms: LanRoomSummary[] = [];
  private customServerHost: string = loadSavedServerHost();
  private intentionalWsClose = false;

  // Local Host authoritative state (fallback when offline / BroadcastChannel)
  private hostRoom: HostRoomInternal | null = null;
  private localPeers = new Set<string>();
  private joinerBcRoomId: string | null = null;

  // Join timeout & BroadcastChannel discovery
  private joinAttemptTimer: number | null = null;
  private bc: BroadcastChannel | null = null;
  private bcDiscoveredRooms = new Map<string, { summary: LanRoomSummary; expiresAt: number }>();
  private bcAnnounceTimer: number | null = null;

  private signalingListeners = new Set<(state: LanSignalingState) => void>();
  private signalingState: LanSignalingState = {
    transportMode: 'local',
    wsConnected: false,
    wsConnecting: false,
    serverHost: loadSavedServerHost(),
    roomCode: null,
    statusMessage: 'Initializing LAN...',
    joinStatus: 'idle',
    joinTargetCode: null,
    joinError: null,
  };

  constructor(clientId: string) {
    this.clientId = clientId;
    activeClientsById.set(clientId, this);
    latestClientInstance = this;
  }

  public setCallbacks(callbacks: LanClientCallbacks) {
    this.callbacks = callbacks;
  }

  public getSignalingState(): LanSignalingState {
    return { ...this.signalingState };
  }

  public subscribeSignaling(listener: (state: LanSignalingState) => void): () => void {
    this.signalingListeners.add(listener);
    listener({ ...this.signalingState });
    return () => {
      this.signalingListeners.delete(listener);
    };
  }

  private updateSignaling(patch: Partial<LanSignalingState>) {
    this.signalingState = {
      ...this.signalingState,
      ...patch,
    };
    const snapshot = { ...this.signalingState };
    this.signalingListeners.forEach((fn) => fn(snapshot));
  }

  private resolveWsUrl(): string | null {
    if (this.customServerHost) {
      return `ws://${this.customServerHost}/ws`;
    }
    if (typeof window === 'undefined') return null;
    const { protocol, host } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && host) {
      const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${host}/ws`;
    }
    return null;
  }

  public connect() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.intentionalWsClose = false;

    activeClientsById.set(this.clientId, this);
    latestClientInstance = this;

    // Open BroadcastChannel for instant zero-config same-device discovery
    try {
      if (typeof BroadcastChannel !== 'undefined' && !this.bc) {
        this.bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.bc.onmessage = (ev) => this.handleBroadcastMessage(ev.data);
      }
    } catch {
      this.bc = null;
    }

    if (this.bcAnnounceTimer === null) {
      this.bcAnnounceTimer = window.setInterval(() => {
        const now = Date.now();
        let changed = false;
        this.bcDiscoveredRooms.forEach((entry, id) => {
          if (entry.expiresAt <= now) {
            this.bcDiscoveredRooms.delete(id);
            changed = true;
          }
        });
        if (changed) {
          this.emitDiscoveredRooms();
        }
        if (
          this.sessionTransport === 'local' &&
          this.roleMode === 'host' &&
          this.hostRoom &&
          this.hostRoom.status === 'lobby'
        ) {
          this.postBroadcast({
            type: 'bc:announce',
            hostClientId: this.clientId,
            summary: toRoomSummary(this.hostRoom),
          });
        }
      }, 1500);
    }

    this.callbacks.onWelcome?.(this.clientId);
    this.callbacks.onConnectionChange?.(true);
    this.connectWebSocket();
    this.scanRooms();
  }

  public setServerHost(rawHost: string) {
    const normalized = normalizeServerHostInput(rawHost);
    this.customServerHost = normalized;
    try {
      if (normalized) {
        localStorage.setItem(CUSTOM_SERVER_HOST_STORAGE_KEY, normalized);
      } else {
        localStorage.removeItem(CUSTOM_SERVER_HOST_STORAGE_KEY);
      }
    } catch {
      // ignore storage failure
    }
    this.updateSignaling({
      serverHost: normalized,
      joinError: null,
    });
    this.closeWebSocketOnly();
    this.connectWebSocket();
  }

  private connectWebSocket() {
    const url = this.resolveWsUrl();
    if (!url || typeof WebSocket === 'undefined') {
      this.updateSignaling({
        transportMode: 'local',
        wsConnected: false,
        wsConnecting: false,
        statusMessage: 'Local / Offline Hotspot Ready',
      });
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.updateSignaling({
      wsConnecting: true,
      statusMessage: this.customServerHost
        ? `Connecting to ${this.customServerHost}...`
        : 'Connecting to LAN server...',
    });

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.updateSignaling({
          transportMode: 'ws',
          wsConnected: true,
          wsConnecting: false,
          statusMessage: 'Wi-Fi / LAN Ready',
        });

        this.sendWs({ type: 'client:identify', clientId: this.clientId });
        this.sendWs({ type: 'rooms:scan' });

        if (this.wsHeartbeatTimer !== null) clearInterval(this.wsHeartbeatTimer);
        this.wsHeartbeatTimer = window.setInterval(() => {
          this.sendWs({ type: 'client:ping' });
        }, 5000);
      };

      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        this.handleWsInboundMessage(parsed);
      };

      ws.onerror = () => {
        // Handled cleanly in onclose without flooding UI errors
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.wsHeartbeatTimer !== null) {
          clearInterval(this.wsHeartbeatTimer);
          this.wsHeartbeatTimer = null;
        }

        const wasInWsSession = this.sessionTransport === 'ws' && !this.intentionalWsClose;
        if (wasInWsSession) {
          this.sessionTransport = 'none';
          this.roleMode = 'none';
          this.currentRoomIsHost = false;
          this.clearJoinTimer();
          this.callbacks.onRoomError?.('Lost connection to the LAN server.');
          this.callbacks.onRoomState?.(null);
        }

        this.updateSignaling({
          transportMode: 'local',
          wsConnected: false,
          wsConnecting: false,
          roomCode: wasInWsSession ? null : this.signalingState.roomCode,
          statusMessage: this.customServerHost
            ? `Server unreachable (${this.customServerHost}) · Local mode active`
            : 'Local / Offline Hotspot Ready',
        });

        // One gentle retry if not intentionally closed and app is open on HTTP/HTTPS
        if (!this.intentionalWsClose && this.isInitialized && this.wsReconnectTimer === null) {
          this.wsReconnectTimer = window.setTimeout(() => {
            this.wsReconnectTimer = null;
            if (this.isInitialized && !this.ws && (this.customServerHost || window.location.port === '3000')) {
              this.connectWebSocket();
            }
          }, 5000);
        }
      };
    } catch {
      this.ws = null;
      this.updateSignaling({
        transportMode: 'local',
        wsConnected: false,
        wsConnecting: false,
        statusMessage: 'Local / Offline Hotspot Ready',
      });
    }
  }

  private closeWebSocketOnly() {
    this.intentionalWsClose = true;
    if (this.wsReconnectTimer !== null) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsHeartbeatTimer !== null) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.intentionalWsClose = false;
  }

  public disconnect() {
    this.leaveRoom();
    this.isInitialized = false;
    this.intentionalWsClose = true;
    this.clearJoinTimer();

    if (this.wsReconnectTimer !== null) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsHeartbeatTimer !== null) {
      clearInterval(this.wsHeartbeatTimer);
      this.wsHeartbeatTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.bcAnnounceTimer !== null) {
      clearInterval(this.bcAnnounceTimer);
      this.bcAnnounceTimer = null;
    }
    try {
      this.bc?.close();
    } catch {
      // ignore
    }
    this.bc = null;

    this.callbacks.onConnectionChange?.(false);
    if (activeClientsById.get(this.clientId) === this) {
      activeClientsById.delete(this.clientId);
    }
    if (latestClientInstance === this) {
      latestClientInstance = null;
    }
  }

  private sendWs(payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Server WebSocket Inbound Handler
  // ---------------------------------------------------------------------------
  private handleWsInboundMessage(data: Record<string, unknown>) {
    const type = String(data.type ?? '');

    if (type === 'welcome') {
      // Keep clientId consistent via client:identify rather than overwriting mid-session
      return;
    }

    if (type === 'rooms:list') {
      this.wsRooms = Array.isArray(data.rooms) ? (data.rooms as LanRoomSummary[]) : [];
      this.emitDiscoveredRooms();
      return;
    }

    if (type === 'room:state') {
      this.clearJoinTimer();
      const room = (data.room as LanRoomState | null) || null;
      if (room) {
        const me = room.players.find((p) => p.clientId === this.clientId);
        this.sessionTransport = 'ws';
        this.roleMode = me?.isHost ? 'host' : 'client';
        this.currentRoomIsHost = Boolean(me?.isHost);
        this.updateSignaling({
          transportMode: 'ws',
          roomCode: room.roomId,
          joinStatus: 'connected',
          joinTargetCode: null,
          joinError: null,
          statusMessage: me?.isHost ? `Hosting Room: ${room.roomId}` : `Joined Room: ${room.roomId}`,
        });
      } else {
        this.sessionTransport = 'none';
        this.roleMode = 'none';
        this.currentRoomIsHost = false;
        this.updateSignaling({
          roomCode: null,
          joinStatus: 'idle',
          joinTargetCode: null,
          statusMessage: this.signalingState.wsConnected ? 'Wi-Fi / LAN Ready' : 'Local / Offline Hotspot Ready',
        });
      }
      this.callbacks.onRoomState?.(room);
      return;
    }

    if (type === 'room:left' || type === 'room:host_closed') {
      this.clearJoinTimer();
      this.sessionTransport = 'none';
      this.roleMode = 'none';
      this.currentRoomIsHost = false;
      this.updateSignaling({
        roomCode: null,
        joinStatus: 'idle',
        joinTargetCode: null,
        statusMessage: this.signalingState.wsConnected ? 'Wi-Fi / LAN Ready' : 'Local / Offline Hotspot Ready',
      });
      if (type === 'room:host_closed') {
        this.callbacks.onRoomError?.('Host closed the room.');
      }
      this.callbacks.onRoomState?.(null);
      return;
    }

    if (type === 'room:error') {
      this.clearJoinTimer();
      const message = String(data.message || 'Could not join room.');
      this.updateSignaling({
        joinStatus: 'error',
        joinError: message,
        statusMessage: this.signalingState.wsConnected ? 'Wi-Fi / LAN Ready' : 'Local / Offline Hotspot Ready',
      });
      if (this.sessionTransport === 'ws' && this.roleMode === 'client' && !this.signalingState.roomCode) {
        this.sessionTransport = 'none';
        this.roleMode = 'none';
      }
      this.callbacks.onRoomError?.(message);
      return;
    }

    if (type === 'match:start') {
      this.callbacks.onMatchStart?.(
        data.room as LanRoomState,
        (data.kickoffTeam as TeamSide) || 'home',
        Boolean(data.rejoin),
      );
      return;
    }

    if (type === 'match:host_migrated') {
      if (typeof data.hostClientId === 'string' && data.room) {
        this.roleMode = data.hostClientId === this.clientId ? 'host' : 'client';
        this.currentRoomIsHost = data.hostClientId === this.clientId;
        this.callbacks.onHostMigrated?.(data.hostClientId, data.room as LanRoomState);
      }
      return;
    }

    if (type === 'match:skip_prematch') {
      this.callbacks.onPreMatchSkip?.();
      return;
    }

    if (type === 'match:snapshot') {
      this.callbacks.onMatchSnapshot?.(data.snapshot as SyncedMatchSnapshot);
      return;
    }

    if (type === 'match:client_input') {
      if (typeof data.clientId === 'string' && data.input) {
        this.callbacks.onClientInput?.(data.clientId, data.input as ClientMatchInput);
      }
      return;
    }

    if (type === 'match:draw_state') {
      this.callbacks.onDrawState?.(data.state as DrawDecisionState);
      return;
    }

    if (type === 'match:draw_resolution') {
      this.callbacks.onDrawResolution?.(
        data.decision === 'more_time' ? 'more_time' : 'tiebreaker',
      );
      return;
    }

    if (type === 'match:end') {
      this.callbacks.onMatchEnd?.();
    }
  }

  // ---------------------------------------------------------------------------
  // Same-Device BroadcastChannel Discovery & Relay
  // ---------------------------------------------------------------------------
  private postBroadcast(payload: unknown) {
    if (!this.bc) return;
    try {
      this.bc.postMessage(payload);
    } catch {
      // ignore
    }
  }

  private emitDiscoveredRooms() {
    const merged = new Map<string, LanRoomSummary>();
    this.wsRooms.forEach((r) => {
      if (r.status === 'lobby') merged.set(r.roomId, r);
    });
    this.bcDiscoveredRooms.forEach((entry) => {
      if (entry.summary.status === 'lobby' && !merged.has(entry.summary.roomId)) {
        merged.set(entry.summary.roomId, entry.summary);
      }
    });
    this.callbacks.onRoomsList?.(Array.from(merged.values()));
  }

  private handleBroadcastMessage(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    const type = String(msg.type ?? '');

    if (type === 'bc:scan') {
      if (
        this.sessionTransport === 'local' &&
        this.roleMode === 'host' &&
        this.hostRoom &&
        this.hostRoom.status === 'lobby'
      ) {
        this.postBroadcast({
          type: 'bc:announce',
          hostClientId: this.clientId,
          summary: toRoomSummary(this.hostRoom),
        });
      }
      return;
    }

    if (type === 'bc:announce') {
      if (msg.hostClientId === this.clientId) return;
      const summary = msg.summary as LanRoomSummary | undefined;
      if (!summary || !summary.roomId) return;
      if (summary.status === 'lobby') {
        this.bcDiscoveredRooms.set(summary.roomId, {
          summary,
          expiresAt: Date.now() + 3500,
        });
      } else {
        this.bcDiscoveredRooms.delete(summary.roomId);
      }
      this.emitDiscoveredRooms();
      return;
    }

    if (type === 'bc:close_room' && typeof msg.roomId === 'string') {
      this.bcDiscoveredRooms.delete(msg.roomId);
      this.emitDiscoveredRooms();
      if (
        this.sessionTransport === 'local' &&
        this.roleMode === 'client' &&
        this.joinerBcRoomId === msg.roomId
      ) {
        this.joinerBcRoomId = null;
        this.sessionTransport = 'none';
        this.roleMode = 'none';
        this.updateSignaling({
          roomCode: null,
          joinStatus: 'idle',
          joinTargetCode: null,
          statusMessage: 'Local / Offline Hotspot Ready',
        });
        this.callbacks.onRoomError?.('Host closed the lobby.');
        this.callbacks.onRoomState?.(null);
      }
      return;
    }

    if (type === 'bc:to_host') {
      if (this.sessionTransport !== 'local' || this.roleMode !== 'host' || !this.hostRoom) return;
      if (msg.roomId !== this.hostRoom.roomId) return;
      const fromClientId = String(msg.fromClientId ?? '');
      if (!fromClientId || fromClientId === this.clientId) return;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      if (payload.type === 'room:join') {
        this.localPeers.add(fromClientId);
      }
      this.handleLocalHostInboundMessage(fromClientId, payload);
      return;
    }

    if (type === 'bc:to_client') {
      if (this.sessionTransport !== 'local' || this.roleMode !== 'client' || !this.joinerBcRoomId) {
        return;
      }
      if (msg.roomId !== this.joinerBcRoomId) return;
      const target = msg.targetClientId ? String(msg.targetClientId) : null;
      if (target && target !== this.clientId) return;
      const payload = msg.payload as Record<string, unknown> | undefined;
      if (!payload) return;
      this.handleLocalClientInboundMessage(payload);
    }
  }

  private clearJoinTimer() {
    if (this.joinAttemptTimer !== null) {
      clearTimeout(this.joinAttemptTimer);
      this.joinAttemptTimer = null;
    }
  }

  public cancelJoinAttempt() {
    this.clearJoinTimer();
    if (this.roleMode === 'client' && !this.signalingState.roomCode) {
      this.roleMode = 'none';
      this.sessionTransport = 'none';
      this.joinerBcRoomId = null;
    }
    this.updateSignaling({
      joinStatus: 'idle',
      joinTargetCode: null,
      joinError: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Local Host Room Logic (Offline / BroadcastChannel Fallback)
  // ---------------------------------------------------------------------------
  private sendToLocalPeer(peerClientId: string, payload: unknown) {
    if (!this.hostRoom) return;
    this.postBroadcast({
      type: 'bc:to_client',
      roomId: this.hostRoom.roomId,
      targetClientId: peerClientId,
      payload,
    });
  }

  private broadcastToLocalPeers(payload: unknown) {
    if (!this.hostRoom) return;
    this.localPeers.forEach((peerClientId) => {
      this.postBroadcast({
        type: 'bc:to_client',
        roomId: this.hostRoom!.roomId,
        targetClientId: peerClientId,
        payload,
      });
    });
  }

  private sendToLocalHost(payload: unknown) {
    if (!this.joinerBcRoomId) return;
    this.postBroadcast({
      type: 'bc:to_host',
      roomId: this.joinerBcRoomId,
      fromClientId: this.clientId,
      payload,
    });
  }

  private getTeamAvailableAiOutfieldSlots(room: HostRoomInternal, team: TeamSide): number {
    const perTeam = getPlayersPerTeam(room.settings.matchSize);
    const teamHumans = room.players.filter((p) => p.team === team);
    const humanOutfield = teamHumans.filter((p) => p.role === 'outfield').length;
    return Math.max(0, perTeam - 1 - humanOutfield);
  }

  private clampRoomAiControlCounts(room: HostRoomInternal) {
    for (const team of ['home', 'away'] as TeamSide[]) {
      const maxAi = this.getTeamAvailableAiOutfieldSlots(room, team);
      for (const p of room.players) {
        if (p.team !== team) continue;
        if (p.role === 'goalkeeper') {
          p.aiControlCount = 0;
        } else {
          const cur = Number.isFinite(p.aiControlCount) ? Math.floor(p.aiControlCount) : 1;
          p.aiControlCount = Math.max(0, Math.min(maxAi, cur));
        }
      }
    }
  }

  private rebalanceOverflowOnSizeChange(room: HostRoomInternal) {
    const perTeam = getPlayersPerTeam(room.settings.matchSize);
    for (const team of ['home', 'away'] as TeamSide[]) {
      const other: TeamSide = team === 'home' ? 'away' : 'home';
      const onTeam = room.players.filter((p) => p.team === team);
      if (onTeam.length <= perTeam) continue;

      const excess = onTeam.slice(perTeam);
      for (const p of excess) {
        const otherCount = room.players.filter((x) => x.team === other).length;
        if (otherCount < perTeam) {
          p.team = other;
          if (
            p.role === 'goalkeeper' &&
            room.players.some(
              (x) => x.team === other && x.role === 'goalkeeper' && x.clientId !== p.clientId,
            )
          ) {
            p.role = 'outfield';
          }
          p.ready = false;
        }
      }
    }
    this.clampRoomAiControlCounts(room);
  }

  private assignInitialSlot(
    room: HostRoomInternal,
    preferredTeam?: TeamSide,
  ): { team: TeamSide; role: PlayerRole } {
    const perTeam = getPlayersPerTeam(room.settings.matchSize);
    const homePlayers = room.players.filter((p) => p.team === 'home');
    const awayPlayers = room.players.filter((p) => p.team === 'away');

    let team: TeamSide;
    if (preferredTeam === 'home' && homePlayers.length < perTeam) {
      team = 'home';
    } else if (preferredTeam === 'away' && awayPlayers.length < perTeam) {
      team = 'away';
    } else if (homePlayers.length >= perTeam && awayPlayers.length < perTeam) {
      team = 'away';
    } else if (awayPlayers.length >= perTeam && homePlayers.length < perTeam) {
      team = 'home';
    } else {
      team = homePlayers.length <= awayPlayers.length ? 'home' : 'away';
    }

    const teamRoster = team === 'home' ? homePlayers : awayPlayers;
    const hasOutfield = teamRoster.some((p) => p.role === 'outfield');
    const hasGk = teamRoster.some((p) => p.role === 'goalkeeper');
    const role: PlayerRole = perTeam === 2 && hasOutfield && !hasGk ? 'goalkeeper' : 'outfield';
    return { team, role };
  }

  private clearHostCountdown(room: HostRoomInternal) {
    if (room.countdownTimer !== null && room.countdownTimer !== undefined) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.countdownSeconds = 0;
    if (room.status === 'countdown') {
      room.status = 'lobby';
    }
  }

  private broadcastHostRoomState() {
    if (!this.hostRoom) return;
    const publicRoom = toPublicRoomState(this.hostRoom);
    this.callbacks.onRoomState?.(publicRoom);
    this.broadcastToLocalPeers({ type: 'room:state', room: publicRoom });

    if (this.hostRoom.status === 'lobby') {
      this.postBroadcast({
        type: 'bc:announce',
        hostClientId: this.clientId,
        summary: toRoomSummary(this.hostRoom),
      });
    } else {
      this.postBroadcast({
        type: 'bc:close_room',
        roomId: this.hostRoom.roomId,
      });
    }
  }

  private maybeStartCountdown(room: HostRoomInternal) {
    if (room.status !== 'lobby' || room.players.length === 0) return;
    const allReady = room.players.every((p) => p.ready);
    if (!allReady) return;

    this.clampRoomAiControlCounts(room);
    room.status = 'countdown';
    room.countdownSeconds = 3;
    room.kickoffTeam = Math.random() < 0.5 ? 'home' : 'away';

    this.broadcastHostRoomState();

    room.countdownTimer = window.setInterval(() => {
      if (!this.hostRoom || this.hostRoom !== room) {
        if (room.countdownTimer) clearInterval(room.countdownTimer);
        return;
      }
      room.countdownSeconds -= 1;
      if (room.countdownSeconds > 0) {
        this.broadcastHostRoomState();
        return;
      }

      if (room.countdownTimer !== null && room.countdownTimer !== undefined) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
      }
      room.status = 'playing';
      room.countdownSeconds = 0;

      const publicRoom = toPublicRoomState(room);
      const kickoffTeam = room.kickoffTeam || 'home';
      this.broadcastHostRoomState();
      this.broadcastToLocalPeers({
        type: 'match:start',
        room: publicRoom,
        kickoffTeam,
      });
      this.callbacks.onMatchStart?.(publicRoom, kickoffTeam, false);
    }, 1000);
  }

  private broadcastDrawState(room: HostRoomInternal) {
    const state: DrawDecisionState = {
      active: room.drawPending,
      homeScore: room.drawHomeScore,
      awayScore: room.drawAwayScore,
      votes: { ...room.drawVotes },
      totalPlayers: room.players.length,
      extraTimeCount: room.drawExtraTimeCount,
    };
    this.broadcastToLocalPeers({ type: 'match:draw_state', state });
    this.callbacks.onDrawState?.(state);
  }

  private evaluateDrawVotes(room: HostRoomInternal) {
    if (!room.drawPending) return;
    const entries = Object.values(room.drawVotes);
    if (entries.some((v) => v === 'tiebreaker')) {
      room.drawPending = false;
      room.drawVotes = {};
      this.broadcastToLocalPeers({ type: 'match:draw_resolution', decision: 'tiebreaker' });
      this.callbacks.onDrawResolution?.('tiebreaker');
      return;
    }
    const allMoreTime =
      room.players.length > 0 && room.players.every((p) => room.drawVotes[p.clientId] === 'more_time');
    if (allMoreTime) {
      room.drawPending = false;
      room.drawVotes = {};
      this.broadcastToLocalPeers({ type: 'match:draw_resolution', decision: 'more_time' });
      this.callbacks.onDrawResolution?.('more_time');
      return;
    }
    this.broadcastDrawState(room);
  }

  private removePlayerFromHostRoom(departingClientId: string) {
    const room = this.hostRoom;
    if (!room || departingClientId === this.clientId) return;

    const beforeCount = room.players.length;
    room.players = room.players.filter((p) => p.clientId !== departingClientId);
    if (room.players.length === beforeCount) return;

    room.playerCount = room.players.length;
    delete room.drawVotes[departingClientId];

    if (room.status === 'countdown') {
      this.clearHostCountdown(room);
    }
    if (room.status === 'lobby') {
      this.clampRoomAiControlCounts(room);
    }
    if (room.drawPending) {
      this.evaluateDrawVotes(room);
    }
    this.broadcastHostRoomState();
  }

  private applySlotSelectionOnHost(
    targetClientId: string,
    team: TeamSide,
    role: PlayerRole,
    replyClientId?: string,
  ) {
    const room = this.hostRoom;
    if (!room || room.status !== 'lobby') return;
    const player = room.players.find((p) => p.clientId === targetClientId);
    if (!player) return;

    const perTeam = getPlayersPerTeam(room.settings.matchSize);
    const targetTeamCount = room.players.filter(
      (p) => p.team === team && p.clientId !== targetClientId,
    ).length;

    const notifyError = (message: string) => {
      if (replyClientId) {
        this.sendToLocalPeer(replyClientId, { type: 'room:error', message });
      } else {
        this.callbacks.onRoomError?.(message);
      }
    };

    if (targetTeamCount >= perTeam) {
      notifyError(`${team.toUpperCase()} team is full (${perTeam}/${perTeam} for ${room.settings.matchSize}).`);
      return;
    }

    if (role === 'goalkeeper') {
      const existingGk = room.players.find(
        (p) => p.clientId !== targetClientId && p.team === team && p.role === 'goalkeeper',
      );
      if (existingGk) {
        notifyError(
          `${team.toUpperCase()} already has a dedicated Goalkeeper (${existingGk.playerName}).`,
        );
        return;
      }
    }

    player.team = team;
    player.role = role;
    if (role === 'goalkeeper') {
      player.aiControlCount = 0;
    } else if (player.aiControlCount === 0) {
      player.aiControlCount = 1;
    }
    player.ready = false;
    this.clampRoomAiControlCounts(room);
    this.broadcastHostRoomState();
  }

  private handleLocalHostInboundMessage(senderClientId: string, data: Record<string, unknown>) {
    const room = this.hostRoom;
    if (!room) return;
    const type = String(data.type ?? '');

    if (type === 'room:join') {
      if (room.status !== 'lobby') {
        this.sendToLocalPeer(senderClientId, {
          type: 'room:error',
          message: 'Match has already started.',
        });
        return;
      }

      if (room.players.some((p) => p.clientId === senderClientId)) {
        this.broadcastHostRoomState();
        return;
      }

      if (room.players.length >= room.maxPlayers) {
        this.sendToLocalPeer(senderClientId, {
          type: 'room:error',
          message: `Lobby is full (max ${room.maxPlayers} players for ${room.settings.matchSize}).`,
        });
        return;
      }

      const profile = data.profile as
        | {
            playerName: string;
            jerseyText: string;
            jerseyNumber: number;
            avatar: LanLobbyPlayer['avatar'];
          }
        | undefined;
      const preferredTeam: TeamSide | undefined =
        data.preferredTeam === 'home' || data.preferredTeam === 'away'
          ? data.preferredTeam
          : undefined;

      const slot = this.assignInitialSlot(room, preferredTeam);
      const joinedPlayer: LanLobbyPlayer = {
        clientId: senderClientId,
        playerName: profile?.playerName || 'Guest Player',
        jerseyText: profile?.jerseyText || 'PLAYER',
        jerseyNumber: profile?.jerseyNumber || 7,
        avatar: profile?.avatar || room.players[0].avatar,
        isHost: false,
        team: slot.team,
        role: slot.role,
        ready: false,
        aiControlCount: slot.role === 'goalkeeper' ? 0 : 1,
      };

      room.players.push(joinedPlayer);
      room.playerCount = room.players.length;
      this.clampRoomAiControlCounts(room);
      this.broadcastHostRoomState();
      return;
    }

    if (type === 'room:leave') {
      this.localPeers.delete(senderClientId);
      this.removePlayerFromHostRoom(senderClientId);
      return;
    }

    if (type === 'room:select_slot') {
      const team: TeamSide = data.team === 'away' ? 'away' : 'home';
      const role: PlayerRole = data.role === 'goalkeeper' ? 'goalkeeper' : 'outfield';
      this.applySlotSelectionOnHost(senderClientId, team, role, senderClientId);
      return;
    }

    if (type === 'room:toggle_ready') {
      const player = room.players.find((p) => p.clientId === senderClientId);
      if (!player) return;
      player.ready = !player.ready;
      if (!player.ready && room.status === 'countdown') {
        this.clearHostCountdown(room);
      }
      this.broadcastHostRoomState();
      this.maybeStartCountdown(room);
      return;
    }

    if (type === 'match:client_input') {
      if (room.status !== 'playing') return;
      const input = data.input as ClientMatchInput | undefined;
      if (!input) return;
      this.callbacks.onClientInput?.(senderClientId, input);
      return;
    }

    if (type === 'match:draw_vote') {
      if (!room.drawPending) return;
      const vote: DrawVoteOption = data.vote === 'more_time' ? 'more_time' : 'tiebreaker';
      room.drawVotes[senderClientId] = vote;
      this.evaluateDrawVotes(room);
    }
  }

  private handleLocalClientInboundMessage(data: Record<string, unknown>) {
    switch (data.type) {
      case 'room:state':
        this.clearJoinTimer();
        if (data.room) {
          const room = data.room as LanRoomState;
          this.updateSignaling({
            roomCode: room.roomId,
            joinStatus: 'connected',
            joinTargetCode: null,
            joinError: null,
            statusMessage: `Joined Room: ${room.roomId}`,
          });
        }
        this.callbacks.onRoomState?.((data.room as LanRoomState) || null);
        break;
      case 'room:left':
      case 'room:host_closed':
        this.clearJoinTimer();
        this.joinerBcRoomId = null;
        this.sessionTransport = 'none';
        this.roleMode = 'none';
        this.updateSignaling({
          roomCode: null,
          joinStatus: 'idle',
          joinTargetCode: null,
          statusMessage: 'Local / Offline Hotspot Ready',
        });
        if (data.type === 'room:host_closed') {
          this.callbacks.onRoomError?.('Host closed the room.');
        }
        this.callbacks.onRoomState?.(null);
        break;
      case 'room:error':
        this.clearJoinTimer();
        this.updateSignaling({
          joinStatus: 'error',
          joinError: String(data.message || 'Room error'),
        });
        this.callbacks.onRoomError?.(String(data.message || 'Room error'));
        break;
      case 'match:start':
        this.callbacks.onMatchStart?.(
          data.room as LanRoomState,
          (data.kickoffTeam as TeamSide) || 'home',
          Boolean(data.rejoin),
        );
        break;
      case 'match:skip_prematch':
        this.callbacks.onPreMatchSkip?.();
        break;
      case 'match:snapshot':
        this.callbacks.onMatchSnapshot?.(data.snapshot as SyncedMatchSnapshot);
        break;
      case 'match:draw_state':
        this.callbacks.onDrawState?.(data.state as DrawDecisionState);
        break;
      case 'match:draw_resolution':
        this.callbacks.onDrawResolution?.(
          data.decision === 'more_time' ? 'more_time' : 'tiebreaker',
        );
        break;
      case 'match:end':
        this.callbacks.onMatchEnd?.();
        break;
    }
  }

  private leaveActiveSessionSilent() {
    this.clearJoinTimer();
    if (this.sessionTransport === 'ws') {
      this.sendWs({ type: 'room:leave' });
    } else if (this.sessionTransport === 'local') {
      if (this.roleMode === 'host' && this.hostRoom) {
        if (this.hostRoom.countdownTimer) {
          clearInterval(this.hostRoom.countdownTimer);
          this.hostRoom.countdownTimer = null;
        }
        const closedRoomId = this.hostRoom.roomId;
        this.broadcastToLocalPeers({ type: 'room:host_closed' });
        this.postBroadcast({ type: 'bc:close_room', roomId: closedRoomId });
        this.localPeers.clear();
        this.hostRoom = null;
      } else if (this.roleMode === 'client') {
        this.sendToLocalHost({ type: 'room:leave', clientId: this.clientId });
        this.joinerBcRoomId = null;
      }
    }
    this.sessionTransport = 'none';
    this.roleMode = 'none';
    this.currentRoomIsHost = false;
  }

  // ---------------------------------------------------------------------------
  // Preserved Public API (100% compatible with App.tsx & engine.ts)
  // ---------------------------------------------------------------------------
  public scanRooms() {
    this.sendWs({ type: 'rooms:scan' });
    this.postBroadcast({ type: 'bc:scan' });
    this.emitDiscoveredRooms();
  }

  public createRoom(profile: PlayerProfile, settings: LanMatchSettings, customRoomCode?: string) {
    const rawTrimmed = String(customRoomCode ?? '').trim();
    let roomCode = '';
    if (rawTrimmed.length > 0) {
      roomCode = normalizeShortRoomCode(rawTrimmed);
      if (roomCode.length < 4) {
        this.callbacks.onRoomError?.('Room code must be 4–6 letters or numbers (e.g. SR10).');
        return;
      }
    } else {
      roomCode = generateShortRoomCode(4);
    }

    this.leaveActiveSessionSilent();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sessionTransport = 'ws';
      this.roleMode = 'host';
      this.currentRoomIsHost = true;
      this.updateSignaling({
        roomCode,
        joinStatus: 'idle',
        joinTargetCode: null,
        joinError: null,
        statusMessage: `Opening Room ${roomCode}...`,
      });
      this.sendWs({
        type: 'room:create',
        roomCode,
        settings,
        profile: {
          playerName: profile.playerName,
          jerseyText: profile.jerseyText,
          jerseyNumber: profile.jerseyNumber,
          avatar: profile.avatar,
        },
      });
      return;
    }

    // Local / Offline Hotspot Host fallback
    this.sessionTransport = 'local';
    this.roleMode = 'host';
    this.currentRoomIsHost = true;

    const hostPlayer: LanLobbyPlayer = {
      clientId: this.clientId,
      playerName: profile.playerName || 'Host Player',
      jerseyText: profile.jerseyText || 'TITANIC',
      jerseyNumber: profile.jerseyNumber || 10,
      avatar: profile.avatar,
      isHost: true,
      team: 'home',
      role: 'outfield',
      ready: false,
      aiControlCount: 1,
    };

    const room: HostRoomInternal = {
      roomId: roomCode,
      hostName: hostPlayer.playerName,
      settings: { ...settings },
      playerCount: 1,
      maxPlayers: getRoomMaxPlayers(settings.matchSize),
      status: 'lobby',
      players: [hostPlayer],
      kickoffTeam: null,
      countdownSeconds: 0,
      countdownTimer: null,
      drawPending: false,
      drawVotes: {},
      drawHomeScore: 0,
      drawAwayScore: 0,
      drawExtraTimeCount: 0,
    };

    this.clampRoomAiControlCounts(room);
    this.hostRoom = room;
    this.updateSignaling({
      transportMode: 'local',
      roomCode,
      joinStatus: 'connected',
      joinTargetCode: null,
      joinError: null,
      statusMessage: `Hosting Room: ${roomCode}`,
    });
    this.broadcastHostRoomState();
  }

  public joinRoom(roomId: string, profile: PlayerProfile, preferredTeam?: TeamSide) {
    const normalizedCode = normalizeShortRoomCode(roomId);
    if (normalizedCode.length < 4) {
      const msg = 'Enter a 4–6 character Room Code (e.g. SR10).';
      this.updateSignaling({ joinStatus: 'error', joinError: msg });
      this.callbacks.onRoomError?.(msg);
      return;
    }

    this.leaveActiveSessionSilent();

    const joinProfile = {
      playerName: profile.playerName,
      jerseyText: profile.jerseyText,
      jerseyNumber: profile.jerseyNumber,
      avatar: profile.avatar,
    };

    this.updateSignaling({
      joinStatus: 'connecting',
      joinTargetCode: normalizedCode,
      joinError: null,
      statusMessage: `Connecting to ${normalizedCode}...`,
    });

    // Prefer same-device BroadcastChannel room immediately if explicitly present locally
    if (this.bcDiscoveredRooms.has(normalizedCode)) {
      this.joinViaBroadcastChannel(normalizedCode, joinProfile, preferredTeam);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sessionTransport = 'ws';
      this.roleMode = 'client';
      this.currentRoomIsHost = false;
      this.sendWs({
        type: 'room:join',
        roomId: normalizedCode,
        preferredTeam,
        profile: joinProfile,
      });

      this.joinAttemptTimer = window.setTimeout(() => {
        if (this.signalingState.joinStatus === 'connecting') {
          this.sessionTransport = 'none';
          this.roleMode = 'none';
          const msg = `Timed out connecting to room ${normalizedCode}. Confirm Host has lobby open.`;
          this.updateSignaling({
            joinStatus: 'error',
            joinError: msg,
            statusMessage: 'Wi-Fi / LAN Ready',
          });
          this.callbacks.onRoomError?.(msg);
        }
      }, 5000);
      return;
    }

    // No WS server currently connected: probe BroadcastChannel briefly before showing offline guidance
    this.postBroadcast({ type: 'bc:scan' });
    this.joinAttemptTimer = window.setTimeout(() => {
      if (this.bcDiscoveredRooms.has(normalizedCode)) {
        this.joinViaBroadcastChannel(normalizedCode, joinProfile, preferredTeam);
        return;
      }

      const msg = this.customServerHost
        ? `Could not reach ${normalizedCode} on ${this.customServerHost}. Verify Host lobby is open on the same Wi-Fi.`
        : `Room ${normalizedCode} not found. Connect to the same Wi-Fi server (or enter Host IP) and verify Host opened ${normalizedCode}.`;
      this.updateSignaling({
        joinStatus: 'error',
        joinError: msg,
        statusMessage: 'Local / Offline Hotspot Ready',
      });
      this.callbacks.onRoomError?.(msg);
    }, 900);
  }

  private joinViaBroadcastChannel(
    roomCode: string,
    profile: {
      playerName: string;
      jerseyText: string;
      jerseyNumber: number;
      avatar: PlayerProfile['avatar'];
    },
    preferredTeam?: TeamSide,
  ) {
    this.sessionTransport = 'local';
    this.roleMode = 'client';
    this.currentRoomIsHost = false;
    this.joinerBcRoomId = roomCode;

    this.postBroadcast({
      type: 'bc:to_host',
      roomId: roomCode,
      fromClientId: this.clientId,
      payload: {
        type: 'room:join',
        clientId: this.clientId,
        preferredTeam,
        profile,
      },
    });

    this.joinAttemptTimer = window.setTimeout(() => {
      if (this.signalingState.joinStatus === 'connecting') {
        this.sessionTransport = 'none';
        this.roleMode = 'none';
        this.joinerBcRoomId = null;
        const msg = `Room ${roomCode} did not respond.`;
        this.updateSignaling({
          joinStatus: 'error',
          joinError: msg,
          statusMessage: 'Local / Offline Hotspot Ready',
        });
        this.callbacks.onRoomError?.(msg);
      }
    }, 3500);
  }

  public leaveRoom() {
    this.leaveActiveSessionSilent();
    this.updateSignaling({
      roomCode: null,
      joinStatus: 'idle',
      joinTargetCode: null,
      joinError: null,
      statusMessage: this.signalingState.wsConnected ? 'Wi-Fi / LAN Ready' : 'Local / Offline Hotspot Ready',
    });
    this.callbacks.onRoomState?.(null);
  }

  public updateSettings(settings: LanMatchSettings) {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({ type: 'room:update_settings', settings });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom || this.hostRoom.status !== 'lobby') return;
    this.hostRoom.settings = { ...settings };
    this.hostRoom.maxPlayers = getRoomMaxPlayers(settings.matchSize);
    this.rebalanceOverflowOnSizeChange(this.hostRoom);
    this.broadcastHostRoomState();
  }

  public selectSlot(team: TeamSide, role: PlayerRole) {
    if (this.sessionTransport === 'ws') {
      this.sendWs({ type: 'room:select_slot', team, role });
      return;
    }
    if (this.roleMode === 'host' && this.hostRoom) {
      this.applySlotSelectionOnHost(this.clientId, team, role);
      return;
    }
    if (this.roleMode === 'client') {
      this.sendToLocalHost({
        type: 'room:select_slot',
        clientId: this.clientId,
        team,
        role,
      });
    }
  }

  public setAiControl(targetClientId: string, aiControlCount: number) {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({ type: 'room:set_ai_control', targetClientId, aiControlCount });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom || this.hostRoom.status !== 'lobby') return;
    const target = this.hostRoom.players.find((p) => p.clientId === targetClientId);
    if (!target || target.role === 'goalkeeper') return;
    const maxAi = this.getTeamAvailableAiOutfieldSlots(this.hostRoom, target.team);
    target.aiControlCount = Math.max(0, Math.min(maxAi, Math.floor(aiControlCount)));
    this.broadcastHostRoomState();
  }

  public hostAssignPlayer(
    targetClientId: string,
    assignment: { team?: TeamSide; role?: PlayerRole },
  ) {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({
        type: 'room:host_assign_player',
        targetClientId,
        team: assignment.team,
        role: assignment.role,
      });
      return;
    }

    const room = this.hostRoom;
    if (this.roleMode !== 'host' || !room || room.status !== 'lobby') return;

    const target = room.players.find((p) => p.clientId === targetClientId);
    if (!target) return;

    const perTeam = getPlayersPerTeam(room.settings.matchSize);
    const desiredTeam = assignment.team;
    const desiredRole = assignment.role;

    if (desiredTeam && desiredTeam !== target.team) {
      const prevTeam = target.team;
      const destRoster = room.players.filter((p) => p.team === desiredTeam);
      if (destRoster.length >= perTeam) {
        const swapCandidate =
          destRoster.find((p) => !p.isHost && p.role === target.role) ||
          destRoster.find((p) => !p.isHost) ||
          destRoster[destRoster.length - 1];
        if (!swapCandidate) return;

        target.team = desiredTeam;
        swapCandidate.team = prevTeam;

        if (
          target.role === 'goalkeeper' &&
          room.players.some(
            (p) => p.team === desiredTeam && p.role === 'goalkeeper' && p.clientId !== target.clientId,
          )
        ) {
          target.role = 'outfield';
        }
        if (
          swapCandidate.role === 'goalkeeper' &&
          room.players.some(
            (p) =>
              p.team === prevTeam && p.role === 'goalkeeper' && p.clientId !== swapCandidate.clientId,
          )
        ) {
          swapCandidate.role = 'outfield';
        }
        target.ready = false;
        swapCandidate.ready = false;
      } else {
        target.team = desiredTeam;
        if (
          target.role === 'goalkeeper' &&
          room.players.some(
            (p) => p.team === desiredTeam && p.role === 'goalkeeper' && p.clientId !== target.clientId,
          )
        ) {
          target.role = 'outfield';
        }
        target.ready = false;
      }
    }

    if (desiredRole && desiredRole !== target.role) {
      if (desiredRole === 'goalkeeper') {
        const existingGk = room.players.find(
          (p) => p.team === target.team && p.role === 'goalkeeper' && p.clientId !== target.clientId,
        );
        if (existingGk) {
          existingGk.role = 'outfield';
          existingGk.aiControlCount = Math.max(1, existingGk.aiControlCount);
          existingGk.ready = false;
        }
        target.role = 'goalkeeper';
        target.aiControlCount = 0;
      } else {
        target.role = 'outfield';
        if (target.aiControlCount === 0) target.aiControlCount = 1;
      }
      target.ready = false;
    }

    this.clampRoomAiControlCounts(room);
    this.broadcastHostRoomState();
  }

  public toggleReady() {
    if (this.sessionTransport === 'ws') {
      this.sendWs({ type: 'room:toggle_ready' });
      return;
    }
    if (this.roleMode === 'host' && this.hostRoom) {
      const me = this.hostRoom.players.find((p) => p.clientId === this.clientId);
      if (!me) return;
      me.ready = !me.ready;
      if (!me.ready && this.hostRoom.status === 'countdown') {
        this.clearHostCountdown(this.hostRoom);
      }
      this.broadcastHostRoomState();
      this.maybeStartCountdown(this.hostRoom);
      return;
    }
    if (this.roleMode === 'client') {
      this.sendToLocalHost({ type: 'room:toggle_ready', clientId: this.clientId });
    }
  }

  public sendClientInput(input: ClientMatchInput) {
    if (this.roleMode !== 'client') return;
    if (this.sessionTransport === 'ws') {
      this.sendWs({ type: 'match:client_input', input });
      return;
    }
    this.sendToLocalHost({
      type: 'match:client_input',
      clientId: this.clientId,
      input,
    });
  }

  public sendMatchSnapshot(snapshot: SyncedMatchSnapshot) {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({ type: 'match:snapshot', snapshot });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom || this.hostRoom.status !== 'playing') return;
    this.broadcastToLocalPeers({ type: 'match:snapshot', snapshot });
  }

  public sendPreMatchSkip() {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({ type: 'match:skip_prematch' });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom || this.hostRoom.status !== 'playing') return;
    this.callbacks.onPreMatchSkip?.();
  }

  public sendDrawPrompt(homeScore: number, awayScore: number, extraTimeCount: number) {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({
        type: 'match:draw_prompt',
        homeScore,
        awayScore,
        extraTimeCount,
      });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom) return;
    this.hostRoom.drawPending = true;
    this.hostRoom.drawVotes = {};
    this.hostRoom.drawHomeScore = Number(homeScore ?? 0);
    this.hostRoom.drawAwayScore = Number(awayScore ?? 0);
    this.hostRoom.drawExtraTimeCount = Number(extraTimeCount ?? 0);
    this.broadcastDrawState(this.hostRoom);
  }

  public sendDrawVote(vote: DrawVoteOption) {
    if (this.sessionTransport === 'ws') {
      this.sendWs({ type: 'match:draw_vote', vote });
      return;
    }
    if (this.roleMode === 'host' && this.hostRoom) {
      if (!this.hostRoom.drawPending) return;
      this.hostRoom.drawVotes[this.clientId] = vote;
      this.evaluateDrawVotes(this.hostRoom);
      return;
    }
    if (this.roleMode === 'client') {
      this.sendToLocalHost({
        type: 'match:draw_vote',
        clientId: this.clientId,
        vote,
      });
    }
  }

  public sendMatchEnd() {
    if (this.sessionTransport === 'ws') {
      if (!this.currentRoomIsHost) return;
      this.sendWs({ type: 'match:end' });
      return;
    }
    if (this.roleMode !== 'host' || !this.hostRoom) return;
    if (this.hostRoom.status !== 'playing') return;

    this.hostRoom.status = 'lobby';
    this.hostRoom.drawPending = false;
    this.hostRoom.drawVotes = {};
    this.hostRoom.players.forEach((p) => {
      p.ready = false;
    });

    this.broadcastToLocalPeers({ type: 'match:end' });
    this.broadcastHostRoomState();
  }
}
