import { useEffect, useMemo, useRef, useState } from 'react'

type Difficulty = 'easy' | 'normal' | 'hard'
type Dir = 'up' | 'down' | 'left' | 'right'
type Pt = { x: number; y: number }

function same(a: Pt, b: Pt) {
  return a.x === b.x && a.y === b.y
}

function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function opposite(a: Dir, b: Dir) {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  )
}

function nextHead(head: Pt, dir: Dir) {
  if (dir === 'up') return { x: head.x, y: head.y - 1 }
  if (dir === 'down') return { x: head.x, y: head.y + 1 }
  if (dir === 'left') return { x: head.x - 1, y: head.y }
  return { x: head.x + 1, y: head.y }
}

function placeFood(cols: number, rows: number, snake: Pt[]) {
  for (let tries = 0; tries < 500; tries++) {
    const p = { x: randInt(0, cols - 1), y: randInt(0, rows - 1) }
    if (!snake.some((s) => same(s, p))) return p
  }
  // fallback: scan first empty
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = { x, y }
      if (!snake.some((s) => same(s, p))) return p
    }
  }
  return { x: 0, y: 0 }
}

export function SnakeGame(props: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [running, setRunning] = useState(true)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() => {
    const v = window.localStorage.getItem('bg_snake_best')
    const n = v ? Number(v) : 0
    return Number.isFinite(n) ? n : 0
  })
  const [gameOver, setGameOver] = useState(false)

  const tuning = useMemo(() => {
    // stepMs càng lớn thì rắn đi càng chậm
    if (difficulty === 'easy') return { stepMs: 185, cols: 18, rows: 18 }
    if (difficulty === 'hard') return { stepMs: 120, cols: 22, rows: 22 }
    return { stepMs: 150, cols: 20, rows: 20 }
  }, [difficulty])

  const stateRef = useRef<{
    w: number
    h: number
    dpr: number
    cols: number
    rows: number
    cell: number
    snake: Pt[]
    dir: Dir
    queuedDir: Dir | null
    food: Pt
    accMs: number
    growFlashMs: number
    running: boolean
    gameOver: boolean
  } | null>(null)

  function syncRunning(v: boolean) {
    setRunning(v)
    const s = stateRef.current
    if (s) s.running = v
  }

  function reset(nextDifficulty = difficulty) {
    setDifficulty(nextDifficulty)
    setScore(0)
    setGameOver(false)
    syncRunning(true)

    const s = stateRef.current
    if (!s) return
    s.cols = nextDifficulty === 'easy' ? 18 : nextDifficulty === 'hard' ? 22 : 20
    s.rows = s.cols
    s.cell = Math.floor(Math.min(s.w / s.cols, s.h / s.rows))
    const start: Pt = { x: Math.floor(s.cols / 2), y: Math.floor(s.rows / 2) }
    s.snake = [start, { x: start.x - 1, y: start.y }, { x: start.x - 2, y: start.y }]
    s.dir = 'right'
    s.queuedDir = null
    s.food = placeFood(s.cols, s.rows, s.snake)
    s.accMs = 0
    s.growFlashMs = 0
    s.gameOver = false
  }

  useEffect(() => {
    window.localStorage.setItem('bg_snake_best', String(best))
  }, [best])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const init = () => {
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(320, Math.floor(rect.width))
      const h = Math.max(420, Math.floor(Math.min(rect.width * 0.78, 620)))

      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      if (!stateRef.current) {
        const cols = tuning.cols
        const rows = tuning.rows
        const cell = Math.floor(Math.min(w / cols, h / rows))
        const start: Pt = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) }
        const snake = [start, { x: start.x - 1, y: start.y }, { x: start.x - 2, y: start.y }]
        stateRef.current = {
          w,
          h,
          dpr,
          cols,
          rows,
          cell,
          snake,
          dir: 'right',
          queuedDir: null,
          food: placeFood(cols, rows, snake),
          accMs: 0,
          growFlashMs: 0,
          running: true,
          gameOver: false,
        }
      } else {
        const s = stateRef.current
        s.w = w
        s.h = h
        s.dpr = dpr
        s.cell = Math.floor(Math.min(w / s.cols, h / s.rows))
      }
    }

    init()
    const ro = new ResizeObserver(init)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [tuning.cols, tuning.rows])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current
      if (!s) return

      const key = e.key
      const map: Record<string, Dir | undefined> = {
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
      const next = map[key]
      if (next) {
        e.preventDefault()
        const current = s.queuedDir ?? s.dir
        if (!opposite(current, next)) s.queuedDir = next
      }

      if (key === 'p' || key === 'P') syncRunning(!running)
      if ((key === ' ' || key === 'Enter') && gameOver) reset(difficulty)
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown as any)
  }, [difficulty, gameOver, running])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = (ts: number) => {
      const s = stateRef.current
      if (!s) return

      const dt = lastTsRef.current === null ? 0 : Math.min(0.05, (ts - lastTsRef.current) / 1000)
      lastTsRef.current = ts
      const stepMs = tuning.stepMs

      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0)
      ctx.clearRect(0, 0, s.w, s.h)

      const pad = 14
      const gridW = s.cols * s.cell
      const gridH = s.rows * s.cell
      const ox = Math.floor((s.w - gridW) / 2)
      const oy = Math.floor((s.h - gridH) / 2)

      // background panel
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.beginPath()
      ctx.roundRect(ox - pad, oy - pad, gridW + pad * 2, gridH + pad * 2, 16)
      ctx.fill()

      // subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x <= s.cols; x++) {
        const px = ox + x * s.cell
        ctx.beginPath()
        ctx.moveTo(px, oy)
        ctx.lineTo(px, oy + gridH)
        ctx.stroke()
      }
      for (let y = 0; y <= s.rows; y++) {
        const py = oy + y * s.cell
        ctx.beginPath()
        ctx.moveTo(ox, py)
        ctx.lineTo(ox + gridW, py)
        ctx.stroke()
      }

      // simulate
      if (s.running && !s.gameOver) {
        s.accMs += dt * 1000
        s.growFlashMs = Math.max(0, s.growFlashMs - dt * 1000)
        while (s.accMs >= stepMs) {
          s.accMs -= stepMs
          if (s.queuedDir && !opposite(s.dir, s.queuedDir)) s.dir = s.queuedDir
          s.queuedDir = null

          const head = s.snake[0]!
          const nh = nextHead(head, s.dir)
          // walls
          if (nh.x < 0 || nh.x >= s.cols || nh.y < 0 || nh.y >= s.rows) {
            s.gameOver = true
            setGameOver(true)
            syncRunning(false)
            break
          }
          // self hit (allow tail move if not growing)
          const willEat = same(nh, s.food)
          const bodyToCheck = willEat ? s.snake : s.snake.slice(0, -1)
          if (bodyToCheck.some((p) => same(p, nh))) {
            s.gameOver = true
            setGameOver(true)
            syncRunning(false)
            break
          }

          s.snake.unshift(nh)
          if (willEat) {
            setScore((sc) => {
              const nextScore = sc + 10
              setBest((b) => Math.max(b, nextScore))
              return nextScore
            })
            s.food = placeFood(s.cols, s.rows, s.snake)
            // làm nổi bật ô vừa dài thêm (đuôi) giống màu đầu
            s.growFlashMs = 520
          } else {
            s.snake.pop()
          }
        }
      }

      // draw food
      const fx = ox + s.food.x * s.cell + s.cell / 2
      const fy = oy + s.food.y * s.cell + s.cell / 2
      ctx.fillStyle = 'rgba(170, 59, 255, 0.75)'
      ctx.beginPath()
      ctx.arc(fx, fy, Math.max(5, s.cell * 0.28), 0, Math.PI * 2)
      ctx.fill()

      // draw snake
      for (let i = 0; i < s.snake.length; i++) {
        const p = s.snake[i]!
        const x = ox + p.x * s.cell
        const y = oy + p.y * s.cell
        const rr = Math.max(8, Math.floor(s.cell * 0.28))
        const isHead = i === 0
        const isNewTail = s.growFlashMs > 0 && i === s.snake.length - 1
        if (isHead || isNewTail) {
          // đầu rắn (và ô mới dài thêm) màu xám
          ctx.fillStyle = 'rgba(156, 163, 175, 0.38)'
          ctx.strokeStyle = 'rgba(156, 163, 175, 0.78)'
          ctx.lineWidth = 2
        } else {
          // thân rắn màu vàng
          ctx.fillStyle = 'rgba(250, 204, 21, 0.22)'
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)'
          ctx.lineWidth = 1.5
        }
        ctx.beginPath()
        ctx.roundRect(x + 2, y + 2, s.cell - 4, s.cell - 4, rr)
        ctx.fill()
        ctx.stroke()
      }

      // overlay
      if (s.gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, 0, s.w, s.h)
        ctx.fillStyle = 'rgba(255,255,255,0.94)'
        ctx.textAlign = 'center'
        ctx.font = '700 28px system-ui, Segoe UI, Roboto, sans-serif'
        ctx.fillText('Game Over', s.w / 2, s.h / 2 - 14)
        ctx.font = '500 14px system-ui, Segoe UI, Roboto, sans-serif'
        ctx.fillText('Nhấn Space/Enter để chơi lại', s.w / 2, s.h / 2 + 16)
      } else if (!s.running) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(0, 0, s.w, s.h)
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.textAlign = 'center'
        ctx.font = '700 22px system-ui, Segoe UI, Roboto, sans-serif'
        ctx.fillText('Tạm dừng', s.w / 2, s.h / 2)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTsRef.current = null
    }
  }, [difficulty, tuning.stepMs])

  return (
    <div className="snakePage">
      <div className="snakeHeader">
        <div className="snakeTitle">
          <h1>Rắn săn mồi</h1>
          <p>
            Điều khiển: <code>WASD</code> / <code>←↑→↓</code>. Tạm dừng: <code>P</code>.
          </p>
        </div>

        <div className="snakeActions">
          <label className="snakeField">
            <span className="snakeLabel">Tốc độ</span>
            <select
              value={difficulty}
              onChange={(e) => {
                const d = e.target.value as Difficulty
                reset(d)
              }}
            >
              <option value="easy">Chậm</option>
              <option value="normal">Vừa</option>
              <option value="hard">Nhanh</option>
            </select>
          </label>

          <span className="snakeStatus" aria-live="polite">
            Điểm: <strong>{score}</strong> · Best: <strong>{best}</strong>
          </span>

          <button className="btn" onClick={() => syncRunning(!running)} disabled={gameOver}>
            {running ? 'Tạm dừng' : 'Tiếp tục'}
          </button>
          <button className="btn" onClick={() => reset()}>
            Chơi lại
          </button>
          <button className="btn" onClick={props.onBack}>
            Quay lại danh sách
          </button>
        </div>
      </div>

      <div className="snakeWrap" ref={wrapRef}>
        <canvas className="snakeCanvas" ref={canvasRef} aria-label="Game rắn săn mồi" role="img" />
      </div>
    </div>
  )
}

