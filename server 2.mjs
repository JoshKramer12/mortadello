import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import next from 'next';
import { Server } from 'socket.io';
import { createGame, pickupPile, projectForPlayer, resolveFaceDownAttempt, resolvePlay } from './lib/game-server.mjs';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handler = app.getRequestHandler();
const rooms = new Map();
const code = () => `MORT-${randomBytes(3).toString('base64url').toUpperCase().slice(0, 4)}`;
const token = () => randomBytes(32).toString('base64url');
const roomFor = (roomCode) => rooms.get(roomCode.toUpperCase());

function emitState(io, room) {
  for (const player of room.players) for (const socketId of player.sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && room.game) socket.emit('game:state', { game: projectForPlayer(room.game, player.id), roomCode: room.code, connected: room.players.map((p) => ({ id: p.id, connected: p.sockets.size > 0 })) });
    if (socket && !room.game) socket.emit('room:waiting', { roomCode: room.code, inviteUrl: `${room.origin}/?room=${room.code}` });
  }
}
function attach(socket, room, player) { player.sockets.add(socket.id); socket.data.roomCode = room.code; socket.data.playerId = player.id; socket.join(room.code); }
function fail(callback, error) { if (typeof callback === 'function') callback({ ok: false, error }); }

await app.prepare();
const httpServer = createServer((req, res) => handler(req, res));
const io = new Server(httpServer, { transports: ['websocket', 'polling'], cors: { origin: true, credentials: false } });

io.on('connection', (socket) => {
  socket.on('room:create', (payload = {}, callback) => {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const player = { id: randomUUID(), token: token(), sockets: new Set() }; const origin = payload.origin || `http://localhost:${process.env.PORT || 3000}`;
    const room = { code: roomCode, players: [player], game: null, origin, createdAt: Date.now(), updatedAt: Date.now(), rematchVotes: new Set() }; rooms.set(roomCode, room); attach(socket, room, player);
    callback?.({ ok: true, roomCode, playerToken: player.token, inviteUrl: `${origin}/?room=${roomCode}` }); emitState(io, room);
  });
  socket.on('room:join', (payload = {}, callback) => {
    const room = roomFor(payload.roomCode || ''); if (!room) return fail(callback, 'ROOM_NOT_FOUND'); let player = room.players.find((p) => p.token === payload.playerToken);
    if (!player) { if (room.players.length >= 2) return fail(callback, 'ROOM_FULL'); player = { id: randomUUID(), token: token(), sockets: new Set() }; room.players.push(player); }
    attach(socket, room, player); room.updatedAt = Date.now(); if (room.players.length === 2 && !room.game) room.game = createGame(room.code, [room.players[0].id, room.players[1].id]); callback?.({ ok: true, roomCode: room.code, playerToken: player.token, inviteUrl: `${room.origin}/?room=${room.code}` }); emitState(io, room);
  });
  const act = (event, resolver) => socket.on(event, (payload = {}, callback) => { const room = roomFor(socket.data.roomCode || ''); const player = room?.players.find((p) => p.id === socket.data.playerId); if (!room || !player || !room.game) return fail(callback, 'NOT_IN_GAME'); try { room.game = resolver(room.game, player.id, payload); room.updatedAt = Date.now(); callback?.({ ok: true }); emitState(io, room); } catch (error) { fail(callback, error instanceof Error ? error.message : 'INVALID_ACTION'); } });
  act('game:play', (game, playerId, payload) => resolvePlay(game, playerId, payload.cardIds || [], payload.version));
  act('game:faceDown', (game, playerId, payload) => resolveFaceDownAttempt(game, playerId, payload.cardId, payload.version));
  act('game:pickup', (game, playerId, payload) => pickupPile(game, playerId, payload.version));
  socket.on('game:rematch', (_, callback) => { const room = roomFor(socket.data.roomCode || ''); if (!room || !room.game) return fail(callback, 'NOT_IN_GAME'); room.rematchVotes.add(socket.data.playerId); if (room.rematchVotes.size === 2) { room.game = createGame(room.code, [room.players[0].id, room.players[1].id]); room.rematchVotes.clear(); emitState(io, room); } callback?.({ ok: true, waiting: room.rematchVotes.size < 2 }); });
  socket.on('disconnect', () => { const room = roomFor(socket.data.roomCode || ''); const player = room?.players.find((p) => p.id === socket.data.playerId); if (room && player) { player.sockets.delete(socket.id); room.updatedAt = Date.now(); emitState(io, room); } });
});
setInterval(() => { const now = Date.now(); for (const [key, room] of rooms) if (!room.players.some((p) => p.sockets.size) && now - room.updatedAt > 3 * 60 * 60 * 1000) rooms.delete(key); }, 10 * 60 * 1000).unref();
httpServer.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Mortadello listening on ${process.env.PORT || 3000}`));
