import { useEffect, useMemo, useRef, useState } from 'react'

type JoinRole = 'lobby' | 'player' | 'queue'

type RoomInfo = {
  id: string
  players: number
  queue: number
  hostName: string | null
  status: 'waiting' | 'ready' | 'playing'
}

type RoomPlayer = {
  id: string
  name: string
  ready: boolean
  symbol: 'X' | 'O' | null
}

type RoomState = {
  roomId: string
  board: Array<Array<'X' | 'O' | null>>
  current: 'X' | 'O'
  winner: 'X' | 'O' | null
  started: boolean
  hostId: string | null
  lastMove: { row: number; col: number; by: string } | null
  players: RoomPlayer[]
  queue: Array<{ id: string; name: string }>
}

function getDefaultWsUrl() {
  if (import.meta.env.VITE_CARO_WS_URL) return String(import.meta.env.VITE_CARO_WS_URL)
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'ws://127.0.0.1:8790/caro-ws'
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:8790/caro-ws`
}

export function CaroOnlineGame(props: { onBack: () => void; initialRoomId?: string | null }) {
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [role, setRole] = useState<JoinRole>('lobby')
  const [joinState, setJoinState] = useState<'idle' | 'connecting' | 'ready'>('idle')
  const [roomId, setRoomId] = useState(props.initialRoomId ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [chat, setChat] = useState<Array<{ id: string; name: string; message: string; at: number }>>([])
  const [chatInput, setChatInput] = useState('')
  const [myId, setMyId] = useState<string | null>(null)
  const [hostId, setHostId] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const skipCloseOnceRef = useRef<boolean>(import.meta.env.DEV)

  const myPlayer = useMemo(
    () => (roomState ? roomState.players.find((p) => p.id === myId) ?? null : null),
    [myId, roomState],
  )

  const roomStatus = useMemo(() => {
    if (!roomState) return 'Chua vao phong'
    if (roomState.winner) return `Nguoi thang: ${roomState.winner}`
    if (!roomState.started) {
      if (roomState.players.length < 2) return 'Dang doi nguoi choi'
      return 'Cho san sang'
    }
    return `Luot cua: ${roomState.current}`
  }, [roomState])

  function addLog(msg: string) {
    setLogs((prev) => [msg, ...prev].slice(0, 8))
  }

  function send(payload: unknown) {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  function joinRoom(targetId?: string) {
    const rid = (targetId ?? roomId).trim()
    const playerName = name.trim()
    if (!rid || !playerName) {
      setError('Hay nhap ten va ma phong')
      return
    }
    setError(null)
    send({ type: 'join', roomId: rid, name: playerName })
  }

  function leaveRoom() {
    send({ type: 'leave' })
    setRoomState(null)
    setRole('lobby')
    setMyId(null)
    setHostId(null)
  }

  function readyToggle() {
    send({ type: 'ready' })
  }

  function kickPlayer(targetId: string) {
    send({ type: 'kick', targetId })
  }

  function sendChat() {
    const text = chatInput.trim()
    if (!text) return
    send({ type: 'chat', message: text })
    setChatInput('')
  }

  function play(row: number, col: number) {
    if (!roomState || role !== 'player') return
    if (!roomState.started || roomState.winner) return
    if (!myPlayer || myPlayer.symbol !== roomState.current) return
    if (roomState.board[row]?.[col] !== null) return
    send({ type: 'move', row, col })
  }

  useEffect(() => {
    if (wsRef.current) return
    setJoinState('connecting')
    const ws = new WebSocket(getDefaultWsUrl())
    wsRef.current = ws

    ws.onopen = () => {
      setJoinState('ready')
      send({ type: 'subscribe_rooms' })
    }

    ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }

      if (msg.type === 'rooms') {
        setRooms(msg.rooms ?? [])
        return
      }

      if (msg.type === 'error') {
        setError(msg.message ?? 'Co loi xay ra')
        return
      }

      if (msg.type === 'joined') {
        setRole(msg.role as JoinRole)
        setMyId(msg.playerId)
        setHostId(msg.hostId ?? null)
        setRoomId(msg.roomId ?? roomId)
        addLog(`Da vao phong ${msg.roomId}`)
        return
      }

      if (msg.type === 'role_update') {
        setRole(msg.role as JoinRole)
        setHostId(msg.hostId ?? null)
        addLog('Ban da duoc dua vao nguoi choi')
        return
      }

      if (msg.type === 'room_state') {
        setRoomState(msg as RoomState)
        setHostId(msg.hostId ?? null)
        return
      }

      if (msg.type === 'system') {
        if (msg.message) addLog(msg.message)
        return
      }

      if (msg.type === 'chat') {
        setChat((prev) => [
          { id: msg.id ?? `${Date.now()}`, name: msg.name ?? 'Guest', message: msg.message ?? '', at: msg.at ?? Date.now() },
          ...prev,
        ].slice(0, 50))
        return
      }

      if (msg.type === 'kicked') {
        setError(msg.message ?? 'Ban da bi kick')
        leaveRoom()
        return
      }
    }

    ws.onclose = () => {
      setJoinState('idle')
      setRoomState(null)
      setRole('lobby')
      setMyId(null)
      setHostId(null)
      addLog('Mat ket noi server')
    }

    return () => {
      if (skipCloseOnceRef.current) {
        skipCloseOnceRef.current = false
        return
      }
      ws.close()
      wsRef.current = null
    }
  }, [])

  const shareLink = roomState?.roomId
    ? `${window.location.origin}/caro-online/${roomState.roomId}`
    : null

  return (
    <div className="caroOnlinePage">
      <div className="caroHeader">
        <div className="caroTitle">
          <h1>Caro Online</h1>
          <p>Nhap ten va phong de tao phong. Phong se tu xoa khi khong con ai.</p>
        </div>

        <div className="caroActions">
          <label className="caroField">
            <span className="caroLabel">Ten nguoi choi</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nhap ten..." />
          </label>
          <label className="caroField">
            <span className="caroLabel">Ma phong</span>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="ten-phong" />
          </label>
          <button className="btn" onClick={() => joinRoom()} disabled={joinState !== 'ready'}>
            Vao phong
          </button>
          {roomState ? (
            <button className="btn" onClick={leaveRoom}>
              Roi phong
            </button>
          ) : null}
          <button className="btn" onClick={props.onBack}>
            Quay lai danh sach
          </button>
        </div>
      </div>

      {error ? <div className="tankError">{error}</div> : null}

      <div className="caroOnlineMain">
        <section className="caroLobby">
          <div className="caroPanel">
            <h3>Danh sach phong</h3>
            <div className="caroRooms">
              {rooms.length === 0 ? <p>Chua co phong nao</p> : null}
              {rooms.map((r) => (
                <div key={r.id} className="caroRoomCard">
                  <div>
                    <strong>{r.id}</strong>
                    <div className="caroRoomMeta">
                      <span>{r.players}/2 choi</span>
                      <span>Hang doi: {r.queue}</span>
                      <span>{r.status}</span>
                    </div>
                    {r.hostName ? <p>Chu phong: {r.hostName}</p> : null}
                  </div>
                  <button className="btn" onClick={() => joinRoom(r.id)} disabled={joinState !== 'ready'}>
                    Vao
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="caroPanel">
            <h3>Thong bao</h3>
            <div className="tankLogs">
              {logs.length === 0 ? <p>Chua co thong bao</p> : null}
              {logs.map((log, i) => (
                <p key={`${log}-${i}`}>{log}</p>
              ))}
            </div>
          </div>

          <div className="caroPanel">
            <h3>Chat trong phong</h3>
            <div className="caroChat">
              {chat.length === 0 ? <p>Chua co tin nhan</p> : null}
              {chat.map((m) => (
                <p key={m.id}>
                  <strong>{m.name}:</strong> {m.message}
                </p>
              ))}
            </div>
            <div className="caroChatInput">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Nhap tin nhan..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChat()
                }}
              />
              <button className="btn" onClick={sendChat}>
                Gui
              </button>
            </div>
          </div>
        </section>

        <section className="caroRoom">
          <div className="caroPanel">
            <div className="caroRoomHeader">
              <h3>Phong: {roomState?.roomId ?? '-'}</h3>
              <span className="caroStatus">{roomStatus}</span>
            </div>
            {shareLink ? (
              <p className="caroShare">
                Link vao phong: <code>{shareLink}</code>
              </p>
            ) : null}
            {roomState ? (
              <div className="caroRoomInfo">
                <div>
                  <strong>Nguoi choi</strong>
                  {roomState.players.map((p) => (
                    <div key={p.id} className={`caroPlayer ${p.id === myId ? 'isMe' : ''}`}>
                      <span>
                        {p.name} {p.id === hostId ? '(Chu phong)' : ''}
                      </span>
                      <span>{p.symbol ?? '-'}</span>
                      <span>{p.ready ? 'San sang' : 'Chua san sang'}</span>
                      {hostId === myId && p.id !== myId ? (
                        <button className="btn" onClick={() => kickPlayer(p.id)}>
                          Kick
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div>
                  <strong>Hang doi</strong>
                  {roomState.queue.length === 0 ? <p>Khong co ai</p> : null}
                  {roomState.queue.map((q, idx) => (
                    <div key={q.id} className="caroQueue">
                      <span>{idx + 1}. {q.name}</span>
                      {hostId === myId ? (
                        <button className="btn" onClick={() => kickPlayer(q.id)}>
                          Kick
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p>Hay vao phong de bat dau.</p>
            )}
            {roomState && role === 'player' && roomState.players.length === 2 && !roomState.started ? (
              <button className="btn" onClick={readyToggle}>
                {myPlayer?.ready ? 'Huy san sang' : 'San sang'}
              </button>
            ) : null}
          </div>

          <div className="caroPanel">
            <h3>Ban co</h3>
            <div className="caroBoard">
              {roomState?.board?.map((row, r) =>
                row.map((cell, c) => {
                  const isLast = roomState?.lastMove?.row === r && roomState?.lastMove?.col === c
                  return (
                    <button
                      key={`${r}-${c}`}
                      className={`caroCell ${isLast ? 'isLast' : ''}`}
                      onClick={() => play(r, c)}
                      disabled={!roomState || role !== 'player' || !roomState.started || !!roomState.winner}
                      aria-label={`Hang ${r + 1}, cot ${c + 1}${cell ? `: ${cell}` : ''}`}
                    >
                      {cell}
                    </button>
                  )
                }),
              )}
              {!roomState ? <p>Chua co du lieu phong.</p> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
