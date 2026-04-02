import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8790)
const MAX_PER_ROOM = 6
const WORLD_W = 1280
const WORLD_H = 820
const TICK_MS = 1000 / 60
const SNAPSHOT_MS = 1000 / 20
const RESPAWN_MS = 3000
const GATE_SAFE_RADIUS = 56
const CARO_SIZE = 15

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
let nextCaroClientId = 1

const rooms = new Map()
const caroRooms = new Map()
const caroLobbyClients = new Set()

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
  const obstacles = [
    { id: 'r1', x: 320, y: 220, r: 34, hp: 5, maxHp: 5 },
    { id: 'r2', x: 640, y: 210, r: 34, hp: 5, maxHp: 5 },
    { id: 'r3', x: 960, y: 220, r: 34, hp: 5, maxHp: 5 },
    { id: 'r4', x: 320, y: 600, r: 34, hp: 5, maxHp: 5 },
    { id: 'r5', x: 640, y: 610, r: 34, hp: 5, maxHp: 5 },
    { id: 'r6', x: 960, y: 600, r: 34, hp: 5, maxHp: 5 },
  ]
  room = {
    id: roomId,
    width: WORLD_W,
    height: WORLD_H,
    createdAt: now(),
    players: new Map(),
    bullets: [],
    obstacles,
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

function parseNameTraits(name) {
  let renderType = 'tank'
  let dualBarrel = false
  if (name.startsWith('++')) dualBarrel = true
  if (name.startsWith('@>')) renderType = 'woman'
  else if (name.startsWith('@<')) renderType = 'man'
  else if (name.startsWith('#')) renderType = 'plane'
  return { renderType, dualBarrel }
}

function createCaroBoard() {
  return Array.from({ length: CARO_SIZE }, () => Array.from({ length: CARO_SIZE }, () => null))
}

function countCaroInDirection(board, row, col, dRow, dCol, player) {
  let r = row + dRow
  let c = col + dCol
  let count = 0
  while (r >= 0 && r < board.length && c >= 0 && c < board[0].length) {
    if (board[r][c] !== player) break
    count += 1
    r += dRow
    c += dCol
  }
  return count
}

function isCaroWinFromMove(board, row, col, player, needed = 5) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]

  for (const [dr, dc] of directions) {
    const total =
      1 + countCaroInDirection(board, row, col, dr, dc, player) + countCaroInDirection(board, row, col, -dr, -dc, player)
    if (total >= needed) return true
  }
  return false
}

function buildCaroRoomsPayload() {
  return {
    type: 'rooms',
    rooms: [...caroRooms.values()].map((room) => {
      const host = room.players.get(room.hostId)
      return {
        id: room.id,
        players: room.players.size,
        queue: room.queue.length,
        hostName: host ? host.name : null,
        status: room.started ? 'playing' : room.players.size < 2 ? 'waiting' : 'ready',
      }
    }),
  }
}

function broadcastCaroRooms() {
  const payload = JSON.stringify(buildCaroRoomsPayload())
  for (const ws of caroLobbyClients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

function buildCaroRoomState(room) {
  return {
    type: 'room_state',
    roomId: room.id,
    board: room.board,
    current: room.current,
    winner: room.winner,
    started: room.started,
    hostId: room.hostId,
    lastMove: room.lastMove,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      symbol: p.symbol,
    })),
    queue: room.queue.map((q) => ({ id: q.id, name: q.name })),
  }
}

function sendCaro(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function broadcastCaroRoom(room, payload) {
  const body = JSON.stringify(payload)
  for (const p of room.players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(body)
  }
  for (const q of room.queue) {
    if (q.ws.readyState === q.ws.OPEN) q.ws.send(body)
  }
}

function resetCaroRoom(room) {
  if (room.resetTimer) {
    clearTimeout(room.resetTimer)
    room.resetTimer = null
  }
  room.board = createCaroBoard()
  room.current = 'X'
  room.winner = null
  room.started = false
  room.lastMove = null
  for (const p of room.players.values()) {
    p.ready = false
    p.symbol = null
  }
}

function promoteCaroQueue(room) {
  let promoted = null
  while (room.players.size < 2 && room.queue.length > 0) {
    const next = room.queue.shift()
    if (!next) break
    room.players.set(next.id, { ...next, ready: false, symbol: null })
    if (!room.hostId) room.hostId = next.id
    promoted = next
  }
  if (promoted) {
    sendCaro(promoted.ws, { type: 'role_update', role: 'player', hostId: room.hostId })
  }
}

function scheduleCaroReset(room) {
  if (room.resetTimer) return
  room.resetTimer = setTimeout(() => {
    room.resetTimer = null
    resetCaroRoom(room)
    broadcastCaroRoom(room, { type: 'system', message: 'Ván mới đã sẵn sàng. Ấn sẵn sàng để chơi lại.' })
    broadcastCaroRoom(room, buildCaroRoomState(room))
  }, 4000)
}

function buildSnapshot(room) {
  const activeGateSet = new Set(
    [...room.players.values()]
      .filter((p) => p.isAlive && p.gateVisible)
      .map((p) => p.gateIndex),
  )
  return {
    type: 'room_state',
    roomId: room.id,
    width: room.width,
    height: room.height,
    gates: GATE_LAYOUT
      .map((g, i) => ({ ...g, gateIndex: i }))
      .filter((g) => activeGateSet.has(g.gateIndex)),
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
      renderType: p.renderType,
      dualBarrel: p.dualBarrel,
      isAlive: p.isAlive,
      respawnAt: p.respawnAt,
      isInvulnerable: p.isInvulnerable,
    })),
    bullets: room.bullets.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      ownerId: b.ownerId,
      color: b.color,
    })),
    obstacles: room.obstacles.map((o) => ({
      id: o.id,
      x: o.x,
      y: o.y,
      r: o.r,
      hp: o.hp,
      maxHp: o.maxHp,
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
  const tNow = now()

  for (const p of room.players.values()) {
    if (!p.isAlive) {
      if (tNow >= p.respawnAt) {
        const gate = GATE_LAYOUT[p.gateIndex]
        p.isAlive = true
        p.x = gate.x
        p.y = gate.y
        p.angle = gate.dir
        p.isInvulnerable = true
        p.gateVisible = true
      } else {
        continue
      }
    }

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
    const nx = clamp(p.x + vx * dtSec, tankRadius, room.width - tankRadius)
    const ny = clamp(p.y + vy * dtSec, tankRadius, room.height - tankRadius)
    const blocked = room.obstacles.some((o) => distSq(nx, ny, o.x, o.y) < (tankRadius + o.r) ** 2)
    if (!blocked) {
      p.x = nx
      p.y = ny
    }

    if (Number.isFinite(p.input.aimX) && Number.isFinite(p.input.aimY)) {
      p.angle = Math.atan2(p.input.aimY - p.y, p.input.aimX - p.x)
    }

    if (p.isInvulnerable) {
      const gate = GATE_LAYOUT[p.gateIndex]
      if (distSq(p.x, p.y, gate.x, gate.y) > GATE_SAFE_RADIUS * GATE_SAFE_RADIUS) {
        p.isInvulnerable = false
        p.gateVisible = false
      }
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
    // bullet vs obstacle
    for (const rock of room.obstacles) {
      if (distSq(bullet.x, bullet.y, rock.x, rock.y) > (bulletRadius + rock.r) ** 2) continue
      rock.hp -= 1
      bullet.lifeMs = -1
      break
    }
    if (bullet.lifeMs <= 0) continue

    // bullet vs players
    for (const victim of room.players.values()) {
      if (!victim.isAlive) continue
      if (victim.isInvulnerable) continue
      if (victim.id === bullet.ownerId) continue
      if (distSq(bullet.x, bullet.y, victim.x, victim.y) > (bulletRadius + tankRadius) ** 2) continue

      const killer = room.players.get(bullet.ownerId)
      if (killer) killer.kills += 1
      victim.deaths += 1
      victim.isAlive = false
      victim.respawnAt = tNow + RESPAWN_MS
      victim.isInvulnerable = false
      victim.gateVisible = false
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
  room.obstacles = room.obstacles.filter((o) => o.hp > 0)
  room.bullets = room.bullets.filter((b) => b.lifeMs > 0)

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
const wss = new WebSocketServer({ noServer: true })

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
      const traits = parseNameTraits(name)
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
        isAlive: true,
        respawnAt: 0,
        isInvulnerable: true,
        gateVisible: true,
        renderType: traits.renderType,
        dualBarrel: traits.dualBarrel,
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
      if (!me.isAlive) return
      if (me.fireCooldown > 0) return
      const aimX = Number.isFinite(msg.aimX) ? Number(msg.aimX) : me.input.aimX
      const aimY = Number.isFinite(msg.aimY) ? Number(msg.aimY) : me.input.aimY
      const angle = Math.atan2(aimY - me.y, aimX - me.x)
      me.angle = angle
      me.fireCooldown = 300

      const spawnBullet = (angOffset = 0) => {
        const a = angle + angOffset
        room.bullets.push({
          id: `b${nextBulletId++}`,
          ownerId: me.id,
          color: me.color,
          x: me.x + Math.cos(a) * 22,
          y: me.y + Math.sin(a) * 22,
          angle: a,
          lifeMs: 1600,
        })
      }
      if (me.dualBarrel) {
        spawnBullet(-0.08)
        spawnBullet(0.08)
      } else {
        spawnBullet(0)
      }
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

const caroWss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  const url = req.url || ''
  if (url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req)
    })
    return
  }
  if (url.startsWith('/caro-ws')) {
    caroWss.handleUpgrade(req, socket, head, (client) => {
      caroWss.emit('connection', client, req)
    })
    return
  }
  socket.destroy()
})

caroWss.on('connection', (ws) => {
  const clientId = `c${nextCaroClientId++}`
  let room = null
  let role = 'lobby'
  let name = null

  sendCaro(ws, { type: 'hello', size: CARO_SIZE })

  const joinRoom = (roomId, playerName) => {
    const rid = sanitizeRoomId(roomId)
    const cleanedName = sanitizeName(playerName)
    if (!rid) return sendCaro(ws, { type: 'error', message: 'Room id invalid' })
    if (!cleanedName) return sendCaro(ws, { type: 'error', message: 'Name invalid' })
    if (room) return

    name = cleanedName
    room = caroRooms.get(rid)
    if (!room) {
      room = {
        id: rid,
        createdAt: now(),
        hostId: clientId,
        players: new Map(),
        queue: [],
        board: createCaroBoard(),
        current: 'X',
        winner: null,
        started: false,
        lastMove: null,
      }
      caroRooms.set(rid, room)
    }

    if (!room.hostId) room.hostId = clientId

    if (room.players.size < 2) {
      room.players.set(clientId, { id: clientId, name: cleanedName, ws, ready: false, symbol: null })
      role = 'player'
    } else {
      room.queue.push({ id: clientId, name: cleanedName, ws })
      role = 'queue'
    }

    caroLobbyClients.delete(ws)
    sendCaro(ws, { type: 'joined', roomId: room.id, playerId: clientId, role, hostId: room.hostId })
    broadcastCaroRoom(room, { type: 'system', message: `${cleanedName} joined` })
    broadcastCaroRoom(room, buildCaroRoomState(room))
    broadcastCaroRooms()
  }

  const leaveRoom = (reason = null) => {
    if (!room) return
    const wasPlayer = room.players.has(clientId)
    room.players.delete(clientId)
    room.queue = room.queue.filter((q) => q.id !== clientId)
    if (room.hostId === clientId) {
      const nextHost = room.players.values().next().value
      room.hostId = nextHost ? nextHost.id : null
    }
    if (wasPlayer) resetCaroRoom(room)
    promoteCaroQueue(room)

    if (room.players.size === 0 && room.queue.length === 0) {
      caroRooms.delete(room.id)
    } else {
      broadcastCaroRoom(room, { type: 'system', message: `${name ?? 'Player'} left` })
      broadcastCaroRoom(room, buildCaroRoomState(room))
    }
    broadcastCaroRooms()
    room = null
    role = 'lobby'
    name = null
    if (ws.readyState === ws.OPEN) {
      caroLobbyClients.add(ws)
      sendCaro(ws, buildCaroRoomsPayload())
    }
    if (reason) sendCaro(ws, { type: 'system', message: reason })
  }

  ws.on('message', (raw) => {
    let msg = null
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      sendCaro(ws, { type: 'error', message: 'Invalid JSON' })
      return
    }

    if (msg.type === 'subscribe_rooms') {
      caroLobbyClients.add(ws)
      sendCaro(ws, buildCaroRoomsPayload())
      return
    }

    if (msg.type === 'join') {
      joinRoom(msg.roomId, msg.name)
      return
    }

    if (msg.type === 'leave') {
      leaveRoom()
      return
    }

    if (!room) return

    if (msg.type === 'ready') {
      const me = room.players.get(clientId)
      if (!me) return
      me.ready = !me.ready
      if (room.players.size === 2) {
        const players = [...room.players.values()]
        if (players.every((p) => p.ready)) {
          resetCaroRoom(room)
          const host = room.players.get(room.hostId)
          const other = players.find((p) => p.id !== room.hostId)
          if (host) host.symbol = 'X'
          if (other) other.symbol = 'O'
          room.started = true
          broadcastCaroRoom(room, { type: 'system', message: 'Game started' })
        }
      }
      broadcastCaroRoom(room, buildCaroRoomState(room))
      return
    }

    if (msg.type === 'move') {
      const me = room.players.get(clientId)
      if (!me || !room.started || room.winner) return
      if (me.symbol !== room.current) return
      const row = Number(msg.row)
      const col = Number(msg.col)
      if (!Number.isInteger(row) || !Number.isInteger(col)) return
      if (row < 0 || row >= CARO_SIZE || col < 0 || col >= CARO_SIZE) return
      if (room.board[row][col] !== null) return
      room.board[row][col] = me.symbol
      room.lastMove = { row, col, by: me.id }
      if (isCaroWinFromMove(room.board, row, col, me.symbol)) {
        room.winner = me.symbol
        room.started = false
        broadcastCaroRoom(room, { type: 'system', message: `${me.name} won` })
        scheduleCaroReset(room)
      } else {
        room.current = room.current === 'X' ? 'O' : 'X'
      }
      broadcastCaroRoom(room, buildCaroRoomState(room))
      return
    }

    if (msg.type === 'chat') {
      const cleaned = String(msg.message || '').trim().slice(0, 200)
      if (!cleaned) return
      const sender =
        room.players.get(clientId)?.name ??
        room.queue.find((q) => q.id === clientId)?.name ??
        'Guest'
      broadcastCaroRoom(room, {
        type: 'chat',
        id: `${clientId}-${Date.now()}`,
        name: sender,
        message: cleaned,
        at: now(),
      })
      return
    }

    if (msg.type === 'kick') {
      if (room.hostId !== clientId) return
      const targetId = String(msg.targetId || '')
      if (!targetId || targetId === clientId) return

      if (room.players.has(targetId)) {
        const target = room.players.get(targetId)
        room.players.delete(targetId)
        if (target) {
          sendCaro(target.ws, { type: 'kicked', message: 'You were removed by host' })
          target.ws.close()
        }
        resetCaroRoom(room)
        promoteCaroQueue(room)
      } else {
        const idx = room.queue.findIndex((q) => q.id === targetId)
        if (idx >= 0) {
          const [target] = room.queue.splice(idx, 1)
          if (target) {
            sendCaro(target.ws, { type: 'kicked', message: 'You were removed by host' })
            target.ws.close()
          }
        }
      }

      if (room.players.size === 0 && room.queue.length === 0) {
        caroRooms.delete(room.id)
      } else {
        broadcastCaroRoom(room, buildCaroRoomState(room))
      }
      broadcastCaroRooms()
    }
  })

  ws.on('close', () => {
    caroLobbyClients.delete(ws)
    leaveRoom()
  })
})

setInterval(() => {
  for (const room of rooms.values()) simulateRoom(room, TICK_MS / 1000)
}, TICK_MS)

httpServer.listen(PORT, () => {
  console.log(`Tank server listening on :${PORT}`)
})
