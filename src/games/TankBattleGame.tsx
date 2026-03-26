import { useEffect, useMemo, useRef, useState } from 'react'

type JoinState = 'idle' | 'connecting' | 'joined'

type Player = {
  id: string
  name: string
  color: string
  x: number
  y: number
  angle: number
  kills: number
  deaths: number
  gateIndex: number
}

type Bullet = { id: string; x: number; y: number; ownerId: string }
type Gate = { x: number; y: number; dir: number }

type RoomState = {
  width: number
  height: number
  players: Player[]
  bullets: Bullet[]
  gates: Gate[]
}

function getDefaultWsUrl() {
  if (import.meta.env.VITE_TANK_WS_URL) return String(import.meta.env.VITE_TANK_WS_URL)
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'ws://localhost:8787/ws'
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:8787/ws`
}

function toWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  worldW: number,
  worldH: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * worldW
  const y = ((clientY - rect.top) / rect.height) * worldH
  return { x, y }
}

export function TankBattleGame(props: { onBack: () => void }) {
  const [joinState, setJoinState] = useState<JoinState>('idle')
  const [roomId, setRoomId] = useState('room-1')
  const [name, setName] = useState('')
  const [myId, setMyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [roomState, setRoomState] = useState<RoomState>({
    width: 1280,
    height: 820,
    players: [],
    bullets: [],
    gates: [],
  })

  const wsRef = useRef<WebSocket | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const keysRef = useRef({ up: false, down: false, left: false, right: false })
  const aimRef = useRef({ x: roomState.width / 2, y: roomState.height / 2 })
  const lastInputSentAtRef = useRef(0)
  const inputDirtyRef = useRef(false)

  const me = useMemo(() => roomState.players.find((p) => p.id === myId) ?? null, [myId, roomState.players])

  const ranking = useMemo(() => {
    return [...roomState.players].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills
      if (a.deaths !== b.deaths) return a.deaths - b.deaths
      return a.name.localeCompare(b.name)
    })
  }, [roomState.players])

  function addLog(msg: string) {
    setLogs((prev) => [msg, ...prev].slice(0, 10))
  }

  function disconnect() {
    wsRef.current?.close()
    wsRef.current = null
    setJoinState('idle')
    setMyId(null)
  }

  function sendInput(force = false) {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const now = Date.now()
    if (!force && !inputDirtyRef.current && now - lastInputSentAtRef.current < 60) return
    ws.send(
      JSON.stringify({
        type: 'input',
        up: keysRef.current.up,
        down: keysRef.current.down,
        left: keysRef.current.left,
        right: keysRef.current.right,
        aimX: aimRef.current.x,
        aimY: aimRef.current.y,
      }),
    )
    inputDirtyRef.current = false
    lastInputSentAtRef.current = now
  }

  function shoot() {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'shoot', aimX: aimRef.current.x, aimY: aimRef.current.y }))
  }

  function joinRoom() {
    const rid = roomId.trim()
    const playerName = name.trim()
    if (!rid || !playerName) {
      setError('Vui lòng nhập tên và mã phòng')
      return
    }
    setError(null)
    setJoinState('connecting')

    const ws = new WebSocket(getDefaultWsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', roomId: rid, name: playerName }))
    }

    ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }

      if (msg.type === 'error' || msg.type === 'room_full') {
        setError(msg.message ?? 'Không thể vào phòng')
        setJoinState('idle')
        return
      }
      if (msg.type === 'joined') {
        setJoinState('joined')
        setMyId(msg.playerId)
        addLog(`Đã vào phòng ${msg.roomId}`)
        return
      }
      if (msg.type === 'system') {
        addLog(msg.message)
        return
      }
      if (msg.type === 'kill_feed') {
        addLog(`${msg.killerName} hạ ${msg.victimName}`)
        return
      }
      if (msg.type === 'room_state') {
        setRoomState({
          width: msg.width,
          height: msg.height,
          players: msg.players,
          bullets: msg.bullets,
          gates: msg.gates,
        })
      }
    }

    ws.onclose = () => {
      setJoinState('idle')
      setMyId(null)
      addLog('Mất kết nối server')
    }

    ws.onerror = () => {
      setError('Không kết nối được server')
      setJoinState('idle')
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof keysRef.current | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        W: 'up',
        s: 'down',
        S: 'down',
        a: 'left',
        A: 'left',
        d: 'right',
        D: 'right',
      }
      const key = map[e.key]
      if (key) {
        e.preventDefault()
        if (!keysRef.current[key]) inputDirtyRef.current = true
        keysRef.current[key] = true
      }
      if (e.key === ' ') {
        e.preventDefault()
        shoot()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof keysRef.current | undefined> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        W: 'up',
        s: 'down',
        S: 'down',
        a: 'left',
        A: 'left',
        d: 'right',
        D: 'right',
      }
      const key = map[e.key]
      if (key) {
        if (keysRef.current[key]) inputDirtyRef.current = true
        keysRef.current[key] = false
      }
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown as any)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    if (joinState !== 'joined') return
    const t = window.setInterval(() => sendInput(false), 50)
    return () => window.clearInterval(t)
  }, [joinState])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const resize = () => {
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(360, Math.floor(rect.width))
      const h = Math.max(420, Math.floor(Math.min(rect.width * 0.68, 680)))
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const p = toWorld(e.clientX, e.clientY, rect, roomState.width, roomState.height)
      aimRef.current = p
      inputDirtyRef.current = true
    }
    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const p = toWorld(e.clientX, e.clientY, rect, roomState.width, roomState.height)
      aimRef.current = p
      shoot()
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [roomState.height, roomState.width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = () => {
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const cw = canvas.width / dpr
      const ch = canvas.height / dpr
      const sx = cw / roomState.width
      const sy = ch / roomState.height

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cw, ch)

      // paper background
      ctx.fillStyle = '#f4e7cc'
      ctx.fillRect(0, 0, cw, ch)
      ctx.globalAlpha = 0.18
      for (let i = 0; i < 280; i++) {
        const x = ((i * 97) % 1000) / 1000
        const y = ((i * 173) % 1000) / 1000
        ctx.fillStyle = i % 3 === 0 ? '#d8c8a8' : '#e8d9b9'
        ctx.fillRect(x * cw, y * ch, 2, 2)
      }
      ctx.globalAlpha = 1

      ctx.strokeStyle = 'rgba(94, 67, 36, 0.2)'
      ctx.lineWidth = 1
      for (let x = 0; x <= roomState.width; x += 80) {
        ctx.beginPath()
        ctx.moveTo(x * sx, 0)
        ctx.lineTo(x * sx, ch)
        ctx.stroke()
      }
      for (let y = 0; y <= roomState.height; y += 80) {
        ctx.beginPath()
        ctx.moveTo(0, y * sy)
        ctx.lineTo(cw, y * sy)
        ctx.stroke()
      }

      // gates
      for (let i = 0; i < roomState.gates.length; i++) {
        const g = roomState.gates[i]!
        const gx = g.x * sx
        const gy = g.y * sy
        ctx.fillStyle = 'rgba(45, 85, 74, 0.24)'
        ctx.strokeStyle = 'rgba(45, 85, 74, 0.8)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(gx - 22, gy - 22, 44, 44, 10)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = 'rgba(45, 85, 74, 0.9)'
        ctx.font = '600 12px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(String(i + 1), gx, gy + 4)
      }

      // bullets
      for (const b of roomState.bullets) {
        ctx.fillStyle = '#5b4632'
        ctx.beginPath()
        ctx.arc(b.x * sx, b.y * sy, 4, 0, Math.PI * 2)
        ctx.fill()
      }

      // tanks
      for (const p of roomState.players) {
        const x = p.x * sx
        const y = p.y * sy
        const r = 18
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        ctx.strokeStyle = '#2e2318'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(-r, -r, r * 2, r * 2, 6)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = '#2e2318'
        ctx.beginPath()
        ctx.arc(0, 0, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(0, -3, 24, 6)
        ctx.restore()

        ctx.fillStyle = '#2e2318'
        ctx.font = '600 12px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`${p.name}`, x, y - 24)
      }

      if (me) {
        ctx.fillStyle = 'rgba(46, 35, 24, 0.8)'
        ctx.font = '600 13px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`Bạn: ${me.name}`, 12, 20)
      }

      frameRef.current = requestAnimationFrame(render)
    }

    frameRef.current = requestAnimationFrame(render)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [me, roomState])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  return (
    <div className="tankPage">
      <div className="tankHeader">
        <div className="tankTitle">
          <h1>Tank Battle Online</h1>
          <p>
            Phòng công khai tối đa 6 người. Di chuyển <code>WASD</code>/<code>Arrow</code>, bắn{' '}
            <code>Space</code> hoặc click chuột.
          </p>
        </div>

        <div className="tankActions">
          {joinState !== 'joined' ? (
            <>
              <label className="tankField">
                <span className="tankLabel">Mã phòng</span>
                <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="room-1" />
              </label>
              <label className="tankField">
                <span className="tankLabel">Tên người chơi</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nhập tên..." />
              </label>
              <button className="btn" onClick={joinRoom} disabled={joinState === 'connecting'}>
                {joinState === 'connecting' ? 'Đang vào phòng...' : 'Vào phòng'}
              </button>
            </>
          ) : (
            <>
              <span className="tankStatus">
                Phòng: <strong>{roomId}</strong> · Người chơi: <strong>{roomState.players.length}/6</strong>
              </span>
              <button className="btn" onClick={disconnect}>
                Rời phòng
              </button>
            </>
          )}
          <button className="btn" onClick={props.onBack}>
            Quay lại danh sách
          </button>
        </div>
      </div>

      {error ? <div className="tankError">{error}</div> : null}

      <div className="tankMain">
        <div className="tankArenaWrap" ref={wrapRef}>
          <canvas className="tankCanvas" ref={canvasRef} aria-label="Tank battle arena" />
        </div>

        <aside className="tankSidebar">
          <div className="tankPanel">
            <h3>Bảng xếp hạng</h3>
            <div className="tankRanks">
              {ranking.map((p, idx) => (
                <div key={p.id} className={`tankRank ${p.id === myId ? 'isMe' : ''}`}>
                  <span>#{idx + 1}</span>
                  <span>{p.name}</span>
                  <span>{p.kills} K</span>
                  <span>{p.deaths} D</span>
                </div>
              ))}
              {ranking.length === 0 ? <p>Chưa có người chơi</p> : null}
            </div>
          </div>

          <div className="tankPanel">
            <h3>Thông báo phòng</h3>
            <div className="tankLogs">
              {logs.map((log, i) => (
                <p key={`${log}-${i}`}>{log}</p>
              ))}
              {logs.length === 0 ? <p>Chưa có thông báo</p> : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

