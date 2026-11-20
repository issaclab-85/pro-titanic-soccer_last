import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import {
  MATCH_SIZE_COUNTS,
  type DrawDecisionState,
  type DrawVoteOption,
  type LanLobbyPlayer,
  type LanMatchSettings,
  type LanRoomState,
  type LanRoomSummary,
  type MatchSize,
  type PlayerRole,
  type TeamSide,
} from './src/types/game.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MAX_LAN_PLAYERS = 12; // Up to full 6v6 human players

function getPlayersPerTeam(matchSize: MatchSize | undefined): number {
  return MATCH_SIZE_COUNTS[matchSize || '5v5'] ?? 5;
}

function getRoomMaxPlayers(matchSize: MatchSize | undefined): number {
  return Math.min(MAX_LAN_PLAYERS, getPlayersPerTeam(matchSize) * 2);
}

interface ServerRoom extends LanRoomState {
  countdownTimer?: NodeJS.Timeout | null;
  drawPending?: boolean;
  drawVotes?: Record<string, DrawVoteOption>;
  drawHomeScore?: number;
  drawAwayScore?: number;
  drawExtraTimeCount?: number;
}

interface RecentDisconnect {
  roomId: string;
  player: LanLobbyPlayer;
  expiresAt: number;
}

type HeartbeatSocket = WebSocket & { isAlive?: boolean };

const rooms = new Map<string, ServerRoom>();
const clientRoomMap = new Map<string, string>();
const socketsByClientId = new Map<string, HeartbeatSocket>();
const recentDisconnects = new Map<string, RecentDisconnect>();

function toRoomSummary(room: ServerRoom): LanRoomSummary {
  return {
    roomId: room.roomId,
    hostName: room.hostName,
    settings: room.settings,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
  };
}

function toPublicRoomState(room: ServerRoom): LanRoomState {
  return {
    roomId: room.roomId,
    hostName: room.hostName,
    settings: room.settings,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    players: room.players,
    kickoffTeam: room.kickoffTeam,
    countdownSeconds: room.countdownSeconds,
  };
}

function sendJson(ws: WebSocket | undefined, payload: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore transient closed-socket write errors on Wi-Fi hotspot drops
  }
}

function getTeamAvailableAiOutfieldSlots(room: ServerRoom, team: TeamSide): number {
  const perTeam = getPlayersPerTeam(room.settings.matchSize);
  const teamHumans = room.players.filter((p) => p.team === team);
  const humanOutfield = teamHumans.filter((p) => p.role === 'outfield').length;
  // Total outfield slots on a team is (perTeam - 1); remaining are AI outfield teammates
  return Math.max(0, perTeam - 1 - humanOutfield);
}

function clampRoomAiControlCounts(room: ServerRoom) {
  for (const team of ['home', 'away'] as TeamSide[]) {
    const maxAi = getTeamAvailableAiOutfieldSlots(room, team);
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

function rebalanceOverflowOnSizeChange(room: ServerRoom) {
  const perTeam = getPlayersPerTeam(room.settings.matchSize);
  for (const team of ['home', 'away'] as TeamSide[]) {
    const other: TeamSide = team === 'home' ? 'away' : 'home';
    const onTeam = room.players.filter((p) => p.team === team);
    if (onTeam.length <= perTeam) continue;

    // Move excess non-host players to the other team if capacity exists
    const excess = onTeam.slice(perTeam);
    for (const p of excess) {
      const otherCount = room.players.filter((x) => x.team === other).length;
      if (otherCount < perTeam) {
        p.team = other;
        if (
          p.role === 'goalkeeper' &&
          room.players.some((x) => x.team === other && x.role === 'goalkeeper' && x.clientId !== p.clientId)
        ) {
          p.role = 'outfield';
        }
        p.ready = false;
      }
    }
  }
  clampRoomAiControlCounts(room);
}

function broadcastRoomList() {
  const list: LanRoomSummary[] = [];
  rooms.forEach((room) => {
    if (room.status === 'lobby') {
      list.push(toRoomSummary(room));
    }
  });
  const msg = JSON.stringify({ type: 'rooms:list', rooms: list });
  socketsByClientId.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(msg);
      } catch {
        // Ignore stale socket
      }
    }
  });
}

function broadcastRoomState(room: ServerRoom) {
  const payload = { type: 'room:state', room: toPublicRoomState(room) };
  for (const player of room.players) {
    sendJson(socketsByClientId.get(player.clientId), payload);
  }
}

function broadcastToRoom(room: ServerRoom, payload: unknown, exceptClientId?: string) {
  for (const player of room.players) {
    if (exceptClientId && player.clientId === exceptClientId) continue;
    sendJson(socketsByClientId.get(player.clientId), payload);
  }
}

function assignInitialSlot(
  room: ServerRoom,
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

function clearRoomCountdown(room: ServerRoom) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.countdownSeconds = 0;
  if (room.status === 'countdown') {
    room.status = 'lobby';
  }
}

function maybeStartCountdown(room: ServerRoom) {
  if (room.status !== 'lobby') return;
  if (room.players.length === 0) return;
  const allReady = room.players.every((p) => p.ready);
  if (!allReady) return;

  clampRoomAiControlCounts(room);
  room.status = 'countdown';
  room.countdownSeconds = 3;
  // Automated Coin Toss decides initial kick-off team
  room.kickoffTeam = Math.random() < 0.5 ? 'home' : 'away';

  broadcastRoomState(room);
  broadcastRoomList();

  room.countdownTimer = setInterval(() => {
    room.countdownSeconds -= 1;
    if (room.countdownSeconds > 0) {
      broadcastRoomState(room);
      return;
    }

    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.status = 'playing';
    room.countdownSeconds = 0;
    broadcastRoomState(room);
    broadcastToRoom(room, {
      type: 'match:start',
      room: toPublicRoomState(room),
      kickoffTeam: room.kickoffTeam,
    });
  }, 1000);
}

function broadcastDrawState(room: ServerRoom) {
  const state: DrawDecisionState = {
    active: Boolean(room.drawPending),
    homeScore: room.drawHomeScore ?? 0,
    awayScore: room.drawAwayScore ?? 0,
    votes: { ...(room.drawVotes ?? {}) },
    totalPlayers: room.players.length,
    extraTimeCount: room.drawExtraTimeCount ?? 0,
  };
  broadcastToRoom(room, { type: 'match:draw_state', state });
}

function evaluateDrawVotes(room: ServerRoom) {
  if (!room.drawPending) return;
  const votes = room.drawVotes ?? {};
  const entries = Object.values(votes);
  if (entries.some((v) => v === 'tiebreaker')) {
    room.drawPending = false;
    room.drawVotes = {};
    broadcastToRoom(room, { type: 'match:draw_resolution', decision: 'tiebreaker' });
    return;
  }
  const allMoreTime =
    room.players.length > 0 && room.players.every((p) => votes[p.clientId] === 'more_time');
  if (allMoreTime) {
    room.drawPending = false;
    room.drawVotes = {};
    broadcastToRoom(room, { type: 'match:draw_resolution', decision: 'more_time' });
    return;
  }
  broadcastDrawState(room);
}

function removeClientFromCurrentRoom(clientId: string, preserveReconnectWindow = false) {
  const roomId = clientRoomMap.get(clientId);
  if (!roomId) return;
  clientRoomMap.delete(clientId);
  const room = rooms.get(roomId);
  if (!room) return;

  const departing = room.players.find((p) => p.clientId === clientId);
  const wasHost = Boolean(departing?.isHost);

  if (preserveReconnectWindow && departing && room.status === 'playing') {
    recentDisconnects.set(clientId, {
      roomId,
      player: { ...departing, isHost: false },
      expiresAt: Date.now() + 18000,
    });
  } else {
    recentDisconnects.delete(clientId);
  }

  room.players = room.players.filter((p) => p.clientId !== clientId);
  room.playerCount = room.players.length;
  if (room.drawVotes) {
    delete room.drawVotes[clientId];
  }

  if (room.players.length === 0) {
    clearRoomCountdown(room);
    rooms.delete(roomId);
    broadcastRoomList();
    return;
  }

  if (wasHost) {
    room.players[0].isHost = true;
    room.hostName = room.players[0].playerName;
  }

  if (room.status === 'countdown') {
    clearRoomCountdown(room);
  }

  if (room.status === 'lobby') {
    clampRoomAiControlCounts(room);
  }

  if (room.drawPending) {
    evaluateDrawVotes(room);
  }

  broadcastRoomState(room);
  if (wasHost && room.status === 'playing') {
    broadcastToRoom(room, {
      type: 'match:host_migrated',
      hostClientId: room.players[0].clientId,
      room: toPublicRoomState(room),
    });
  }
  broadcastRoomList();
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 256 * 1024,
  });

  // Hotspot Wi-Fi heartbeat sweep: detect silent dropped mobile connections every 5s
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    recentDisconnects.forEach((entry, id) => {
      if (entry.expiresAt <= now) {
        recentDisconnects.delete(id);
      }
    });

    wss.clients.forEach((rawWs) => {
      const ws = rawWs as HeartbeatSocket;
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, 5000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (rawWs) => {
    const ws = rawWs as HeartbeatSocket;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    let clientId = `cli_${Math.random().toString(36).slice(2, 10)}`;
    socketsByClientId.set(clientId, ws);

    sendJson(ws, { type: 'ws:welcome', clientId });
    broadcastRoomList();

    ws.on('message', (raw) => {
      ws.isAlive = true;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }

      const type = String(data.type ?? '');

      if (type === 'client:ping') {
        sendJson(ws, { type: 'client:pong', ts: Date.now() });
        return;
      }

      if (type === 'client:identify' && typeof data.clientId === 'string' && data.clientId.length > 2) {
        const nextId = data.clientId.slice(0, 64);
        if (nextId !== clientId) {
          socketsByClientId.delete(clientId);
          clientId = nextId;
          // If an older stale socket exists with same clientId, close it cleanly
          const existingWs = socketsByClientId.get(clientId);
          if (existingWs && existingWs !== ws) {
            try {
              existingWs.terminate();
            } catch {
              // ignore
            }
          }
          socketsByClientId.set(clientId, ws);
        }
        sendJson(ws, { type: 'ws:welcome', clientId });

        // Seamless mid-match rejoin recovery if hotspot briefly dropped
        const cached = recentDisconnects.get(clientId);
        if (cached && cached.expiresAt > Date.now()) {
          recentDisconnects.delete(clientId);
          const room = rooms.get(cached.roomId);
          if (room && room.status === 'playing' && room.players.length < room.maxPlayers) {
            const alreadyIn = room.players.some((p) => p.clientId === clientId);
            if (!alreadyIn) {
              const rejoined: LanLobbyPlayer = {
                ...cached.player,
                isHost: room.players.length === 0,
              };
              room.players.push(rejoined);
              room.playerCount = room.players.length;
              clientRoomMap.set(clientId, room.roomId);
              broadcastRoomState(room);
              sendJson(ws, {
                type: 'match:start',
                room: toPublicRoomState(room),
                kickoffTeam: room.kickoffTeam || 'home',
                rejoin: true,
              });
              const host = room.players.find((p) => p.isHost);
              if (host && host.clientId !== clientId) {
                sendJson(socketsByClientId.get(host.clientId), {
                  type: 'match:host_migrated',
                  hostClientId: host.clientId,
                  room: toPublicRoomState(room),
                });
              }
            }
          }
        }
        return;
      }

      if (type === 'rooms:scan') {
        const list: LanRoomSummary[] = [];
        rooms.forEach((r) => {
          if (r.status === 'lobby') list.push(toRoomSummary(r));
        });
        sendJson(ws, { type: 'rooms:list', rooms: list });
        return;
      }

      if (type === 'room:create') {
        removeClientFromCurrentRoom(clientId);
        const profile = data.profile as {
          playerName: string;
          jerseyText: string;
          jerseyNumber: number;
          avatar: LanLobbyPlayer['avatar'];
        };
        const settings = data.settings as LanMatchSettings;
        const requestedCode = String(data.roomCode ?? '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase()
          .slice(0, 6);

        let roomId = '';
        if (requestedCode.length > 0) {
          if (requestedCode.length < 4) {
            sendJson(ws, {
              type: 'room:error',
              message: 'Room code must be 4–6 letters or numbers (e.g. SR10).',
            });
            return;
          }
          if (rooms.has(requestedCode)) {
            sendJson(ws, {
              type: 'room:error',
              message: `Room code ${requestedCode} is already active. Pick another code.`,
            });
            return;
          }
          roomId = requestedCode;
        } else {
          const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          for (let attempt = 0; attempt < 24; attempt += 1) {
            let candidate = '';
            for (let i = 0; i < 4; i += 1) {
              candidate += charset[Math.floor(Math.random() * charset.length)];
            }
            if (!rooms.has(candidate)) {
              roomId = candidate;
              break;
            }
          }
          if (!roomId) {
            roomId = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase().padEnd(4, 'X');
          }
        }

        const hostPlayer: LanLobbyPlayer = {
          clientId,
          playerName: profile?.playerName || 'Host Player',
          jerseyText: profile?.jerseyText || 'TITANIC',
          jerseyNumber: profile?.jerseyNumber || 10,
          avatar: profile?.avatar,
          isHost: true,
          team: 'home',
          role: 'outfield',
          ready: false,
          aiControlCount: 1,
        };

        const room: ServerRoom = {
          roomId,
          hostName: hostPlayer.playerName,
          settings,
          playerCount: 1,
          maxPlayers: getRoomMaxPlayers(settings?.matchSize),
          status: 'lobby',
          players: [hostPlayer],
          kickoffTeam: null,
          countdownSeconds: 0,
        };
        clampRoomAiControlCounts(room);

        rooms.set(roomId, room);
        clientRoomMap.set(clientId, roomId);
        broadcastRoomState(room);
        broadcastRoomList();
        return;
      }

      if (type === 'room:join') {
        const roomId = String(data.roomId ?? '')
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase()
          .slice(0, 6);
        const room = rooms.get(roomId);
        if (!room) {
          sendJson(ws, {
            type: 'room:error',
            message: roomId
              ? `Room ${roomId} not found. Check the code or confirm Host has the lobby open.`
              : 'Enter a valid 4–6 character Room Code.',
          });
          return;
        }
        if (room.status !== 'lobby') {
          sendJson(ws, { type: 'room:error', message: 'Match has already started.' });
          return;
        }
        if (room.players.length >= room.maxPlayers) {
          sendJson(ws, {
            type: 'room:error',
            message: `Lobby is full (max ${room.maxPlayers} players for ${room.settings.matchSize}).`,
          });
          return;
        }

        removeClientFromCurrentRoom(clientId);
        const profile = data.profile as {
          playerName: string;
          jerseyText: string;
          jerseyNumber: number;
          avatar: LanLobbyPlayer['avatar'];
        };
        const preferredTeam: TeamSide | undefined =
          data.preferredTeam === 'home' || data.preferredTeam === 'away'
            ? data.preferredTeam
            : undefined;
        const slot = assignInitialSlot(room, preferredTeam);

        const joinedPlayer: LanLobbyPlayer = {
          clientId,
          playerName: profile?.playerName || 'Guest Player',
          jerseyText: profile?.jerseyText || 'PLAYER',
          jerseyNumber: profile?.jerseyNumber || 7,
          avatar: profile?.avatar,
          isHost: false,
          team: slot.team,
          role: slot.role,
          ready: false,
          aiControlCount: slot.role === 'goalkeeper' ? 0 : 1,
        };

        room.players.push(joinedPlayer);
        room.playerCount = room.players.length;
        clientRoomMap.set(clientId, roomId);
        clampRoomAiControlCounts(room);

        broadcastRoomState(room);
        broadcastRoomList();
        return;
      }

      if (type === 'room:leave') {
        removeClientFromCurrentRoom(clientId, false);
        sendJson(ws, { type: 'room:left' });
        return;
      }

      if (type === 'room:update_settings') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'lobby') return;
        const player = room.players.find((p) => p.clientId === clientId);
        if (!player?.isHost) return;

        room.settings = data.settings as LanMatchSettings;
        room.maxPlayers = getRoomMaxPlayers(room.settings.matchSize);
        rebalanceOverflowOnSizeChange(room);
        broadcastRoomState(room);
        broadcastRoomList();
        return;
      }

      if (type === 'room:select_slot') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'lobby') return;

        const player = room.players.find((p) => p.clientId === clientId);
        if (!player) return;

        const team = (data.team === 'away' ? 'away' : 'home') as TeamSide;
        const role = (data.role === 'goalkeeper' ? 'goalkeeper' : 'outfield') as PlayerRole;
        const perTeam = getPlayersPerTeam(room.settings.matchSize);

        const targetTeamCount = room.players.filter(
          (p) => p.team === team && p.clientId !== clientId,
        ).length;
        if (targetTeamCount >= perTeam) {
          sendJson(ws, {
            type: 'room:error',
            message: `${team.toUpperCase()} team is full (${perTeam}/${perTeam} for ${room.settings.matchSize}).`,
          });
          return;
        }

        if (role === 'goalkeeper') {
          const existingGk = room.players.find(
            (p) => p.clientId !== clientId && p.team === team && p.role === 'goalkeeper',
          );
          if (existingGk) {
            sendJson(ws, {
              type: 'room:error',
              message: `${team.toUpperCase()} already has a dedicated Goalkeeper (${existingGk.playerName}).`,
            });
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
        clampRoomAiControlCounts(room);
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:set_ai_control') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'lobby') return;
        const host = room.players.find((p) => p.clientId === clientId);
        if (!host?.isHost) return;

        const targetClientId = String(data.targetClientId ?? '');
        const target = room.players.find((p) => p.clientId === targetClientId);
        if (!target || target.role === 'goalkeeper') return;

        const maxAi = getTeamAvailableAiOutfieldSlots(room, target.team);
        const requested = Math.floor(Number(data.aiControlCount ?? 0));
        target.aiControlCount = Math.max(0, Math.min(maxAi, requested));
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:host_assign_player') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'lobby') return;
        const host = room.players.find((p) => p.clientId === clientId);
        if (!host?.isHost) return;

        const targetClientId = String(data.targetClientId ?? '');
        const target = room.players.find((p) => p.clientId === targetClientId);
        if (!target) return;

        const perTeam = getPlayersPerTeam(room.settings.matchSize);
        const desiredTeam: TeamSide | undefined =
          data.team === 'home' || data.team === 'away' ? data.team : undefined;
        const desiredRole: PlayerRole | undefined =
          data.role === 'outfield' || data.role === 'goalkeeper' ? data.role : undefined;

        if (desiredTeam && desiredTeam !== target.team) {
          const prevTeam = target.team;
          const destRoster = room.players.filter((p) => p.team === desiredTeam);
          if (destRoster.length >= perTeam) {
            // Destination team is full: automatically swap with a non-host player (or last player)
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
                  p.team === prevTeam &&
                  p.role === 'goalkeeper' &&
                  p.clientId !== swapCandidate.clientId,
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
            // Host override: if another player on target's team is GK, demote them to outfield
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

        clampRoomAiControlCounts(room);
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:toggle_ready') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const player = room.players.find((p) => p.clientId === clientId);
        if (!player) return;

        player.ready = !player.ready;
        if (!player.ready && room.status === 'countdown') {
          clearRoomCountdown(room);
        }
        broadcastRoomState(room);
        maybeStartCountdown(room);
        return;
      }

      if (type === 'match:client_input') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;
        const host = room.players.find((p) => p.isHost);
        if (!host) return;
        sendJson(socketsByClientId.get(host.clientId), {
          type: 'match:client_input',
          clientId,
          input: data.input,
        });
        return;
      }

      if (type === 'match:snapshot') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;
        const sender = room.players.find((p) => p.clientId === clientId);
        if (!sender?.isHost) return;
        broadcastToRoom(room, { type: 'match:snapshot', snapshot: data.snapshot }, clientId);
        return;
      }

      if (type === 'match:skip_prematch') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || room.status !== 'playing') return;
        const sender = room.players.find((p) => p.clientId === clientId);
        if (!sender?.isHost) return;
        sendJson(socketsByClientId.get(sender.clientId), { type: 'match:skip_prematch' });
        return;
      }

      if (type === 'match:draw_prompt') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const sender = room.players.find((p) => p.clientId === clientId);
        if (!sender?.isHost) return;

        room.drawPending = true;
        room.drawVotes = {};
        room.drawHomeScore = Number(data.homeScore ?? 0);
        room.drawAwayScore = Number(data.awayScore ?? 0);
        room.drawExtraTimeCount = Number(data.extraTimeCount ?? 0);
        broadcastDrawState(room);
        return;
      }

      if (type === 'match:draw_vote') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room || !room.drawPending) return;
        const vote: DrawVoteOption = data.vote === 'more_time' ? 'more_time' : 'tiebreaker';
        if (!room.drawVotes) room.drawVotes = {};
        room.drawVotes[clientId] = vote;
        evaluateDrawVotes(room);
        return;
      }

      if (type === 'match:end') {
        const roomId = clientRoomMap.get(clientId);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        room.status = 'lobby';
        room.drawPending = false;
        room.drawVotes = {};
        room.players.forEach((p) => {
          p.ready = false;
        });
        broadcastToRoom(room, { type: 'match:end' });
        broadcastRoomState(room);
        broadcastRoomList();
      }
    });

    ws.on('close', () => {
      if (socketsByClientId.get(clientId) === ws) {
        socketsByClientId.delete(clientId);
        removeClientFromCurrentRoom(clientId, true);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Pro Titanic Soccer server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
