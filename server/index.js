import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8787)
const MAX_PER_ROOM = 6
const WORLD_W = 1280
const WORLD_H = 820
const TICK_MS = 1000 / 30
const SNAPSHOT_MS = 100

const GATE_LAYOUT = [
  { x: 100, y: 100, dir: 0 },
  { x: WORLD_W - 100, y: 100, dir: Math.PI },
  { x: 100, y: WORLD_H - 100, dir: 0 },
  { x: WORLD_W - 100, y: WORLD_H - 100, dir: Math.PI },
  { x: WORLD_W / 2, y: 90, dir: Math.PI / 2 },
  { x: WORLD_W / 2, y: WORLD_H - 90, dir: -Math.PI / 2 },
]

const TANK_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#22c55e', '#a855f7', '#14b8a6']

let nextPlayerId = 1
let nextBulletId = 1

const rooms = new Map()

function now() {
  return Date.now()
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function getRoom(roomId) {
  let room = rooms.get(roomId)
  if (room) return room
  room = {
    id: roomId,
    width: WORLD_W,
    height: WORLD_H,
    createdAt: now(),
    players: new Map(),
    bullets: [],
    lastSnapshotAt: 0,
  }
  rooms.set(roomId, room)
  return room
}

function sanitizeRoomId(raw) {
  const x = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
  return x.slice(0, 24)
}

function sanitizeName(raw) {
  const cleaned = String(raw || '').trim().replace(/\s+/g, ' ')
  return cleaned.slice(0, 18)
}

function assignGateIndex(room) {
  for (let i = 0; i < MAX_PER_ROOM; i++) {
    const used = [...room.players.values()].some((p) => p.gateIndex === i)
    if (!used) return i
  }
  return -1
}

function buildSnapshot(room) {
  return {
    type: 'room_state',
    roomId: room.id,
    width: room.width,
    height: room.height,
    gates: GATE_LAYOUT,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      angle: p.angle,
      kills: p.kills,
      deaths: p.deaths,
      gateIndex: p.gateIndex,
    })),
    bullets: room.bullets.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      ownerId: b.ownerId,
    })),
    at: now(),
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function broadcast(room, payload) {
  const body = JSON.stringify(payload)
  for (const p of room.players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(body)
  }
}

function removePlayer(room, playerId) {
  room.players.delete(playerId)
  if (room.players.size === 0) rooms.delete(room.id)
}

function simulateRoom(room, dtSec) {
  const tankRadius = 17
  const speed = 220
  const bulletSpeed = 500
  const bulletRadius = 4
  const fireCooldownMs = 300

  for (const p of room.players.values()) {
    p.fireCooldown = Math.max(0, p.fireCooldown - dtSec * 1000)

    let dx = 0
    let dy = 0
    if (p.input.up) dy -= 1
    if (p.input.down) dy += 1
    if (p.input.left) dx -= 1
    if (p.input.right) dx += 1

    const len = Math.hypot(dx, dy) || 1
    const vx = (dx / len) * speed
    const vy = (dy / len) * speed
    p.x = clamp(p.x + vx * dtSec, tankRadius, room.width - tankRadius)
    p.y = clamp(p.y + vy * dtSec, tankRadius, room.height - tankRadius)

    if (Number.isFinite(p.input.aimX) && Number.isFinite(p.input.aimY)) {
      p.angle = Math.atan2(p.input.aimY - p.y, p.input.aimX - p.x)
    }
  }

  for (const b of room.bullets) {
    b.x += Math.cos(b.angle) * bulletSpeed * dtSec
    b.y += Math.sin(b.angle) * bulletSpeed * dtSec
    b.lifeMs -= dtSec * 1000
  }
  room.bullets = room.bullets.filter(
    (b) => b.lifeMs > 0 && b.x >= 0 && b.y >= 0 && b.x <= room.width && b.y <= room.height,
  )

  for (const bullet of room.bullets) {
    for (const victim of room.players.values()) {
      if (victim.id === bullet.ownerId) continue
      if (distSq(bullet.x, bullet.y, victim.x, victim.y) > (bulletRadius + tankRadius) ** 2) continue

      const killer = room.players.get(bullet.ownerId)
      if (killer) killer.kills += 1
      victim.deaths += 1

      const gate = GATE_LAYOUT[victim.gateIndex]
      victim.x = gate.x
      victim.y = gate.y
      victim.angle = gate.dir
      victim.fireCooldown = fireCooldownMs

      bullet.lifeMs = -1
      broadcast(room, {
        type: 'kill_feed',
        killerId: killer?.id ?? null,
        killerName: killer?.name ?? 'Unknown',
        victimId: victim.id,
        victimName: victim.name,
      })
      break
    }
  }
  room.bullets = room.bullets.filter((b) => b.lifeMs > 0)

  const tNow = now()
  if (tNow - room.lastSnapshotAt >= SNAPSHOT_MS) {
    room.lastSnapshotAt = tNow
    broadcast(room, buildSnapshot(room))
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    players: [...rooms.values()].reduce((acc, r) => acc + r.players.size, 0),
  })
})

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (ws) => {
  let room = null
  let playerId = null

  send(ws, { type: 'hello', maxPerRoom: MAX_PER_ROOM })

  ws.on('message', (raw) => {
    let msg = null
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    if (msg.type === 'join') {
      if (room || playerId) return
      const roomId = sanitizeRoomId(msg.roomId)
      const name = sanitizeName(msg.name)
      if (!roomId) return send(ws, { type: 'error', message: 'Room ID không hợp lệ' })
      if (!name) return send(ws, { type: 'error', message: 'Tên không hợp lệ' })

      room = getRoom(roomId)
      if (room.players.size >= MAX_PER_ROOM) {
        send(ws, { type: 'room_full', message: 'Phòng đã đủ 6 người' })
        room = null
        return
      }

      const gateIndex = assignGateIndex(room)
      if (gateIndex < 0) {
        send(ws, { type: 'room_full', message: 'Không còn cổng vào' })
        room = null
        return
      }

      playerId = `p${nextPlayerId++}`
      const gate = GATE_LAYOUT[gateIndex]
      room.players.set(playerId, {
        id: playerId,
        ws,
        name,
        color: TANK_COLORS[gateIndex % TANK_COLORS.length],
        x: gate.x,
        y: gate.y,
        angle: gate.dir,
        gateIndex,
        kills: 0,
        deaths: 0,
        fireCooldown: 0,
        input: { up: false, down: false, left: false, right: false, aimX: gate.x, aimY: gate.y },
      })

      send(ws, { type: 'joined', playerId, roomId: room.id, maxPerRoom: MAX_PER_ROOM })
      broadcast(room, {
        type: 'system',
        message: `${name} đã vào phòng`,
      })
      broadcast(room, buildSnapshot(room))
      return
    }

    if (!room || !playerId) return
    const me = room.players.get(playerId)
    if (!me) return

    if (msg.type === 'input') {
      me.input.up = Boolean(msg.up)
      me.input.down = Boolean(msg.down)
      me.input.left = Boolean(msg.left)
      me.input.right = Boolean(msg.right)
      if (Number.isFinite(msg.aimX) && Number.isFinite(msg.aimY)) {
        me.input.aimX = Number(msg.aimX)
        me.input.aimY = Number(msg.aimY)
      }
      return
    }

    if (msg.type === 'shoot') {
      if (me.fireCooldown > 0) return
      const aimX = Number.isFinite(msg.aimX) ? Number(msg.aimX) : me.input.aimX
      const aimY = Number.isFinite(msg.aimY) ? Number(msg.aimY) : me.input.aimY
      const angle = Math.atan2(aimY - me.y, aimX - me.x)
      me.angle = angle
      me.fireCooldown = 300
      room.bullets.push({
        id: `b${nextBulletId++}`,
        ownerId: me.id,
        x: me.x + Math.cos(angle) * 22,
        y: me.y + Math.sin(angle) * 22,
        angle,
        lifeMs: 1600,
      })
    }
  })

  ws.on('close', () => {
    if (!room || !playerId) return
    const p = room.players.get(playerId)
    removePlayer(room, playerId)
    if (p && room.players.size > 0) {
      broadcast(room, { type: 'system', message: `${p.name} đã rời phòng` })
      broadcast(room, buildSnapshot(room))
    }
  })
})

setInterval(() => {
  for (const room of rooms.values()) simulateRoom(room, TICK_MS / 1000)
}, TICK_MS)

httpServer.listen(PORT, () => {
  console.log(`Tank server listening on :${PORT}`)
})

