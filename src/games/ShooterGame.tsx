import { useEffect, useMemo, useRef, useState } from 'react'

type Difficulty = 'easy' | 'normal' | 'hard'

type Rect = { x: number; y: number; w: number; h: number }
type Bullet = { x: number; y: number; vy: number; r: number }
type Target = { x: number; y: number; vx: number; vy: number; r: number; hp: number; maxHp: number }
type Star = { x: number; y: number; s: number; v: number }

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function circleHit(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy <= (a.r + b.r) * (a.r + b.r)
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

export function ShooterGame(props: { onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const isMountedRef = useRef(true)

  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [running, setRunning] = useState(true)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [best, setBest] = useState(() => {
    const v = window.localStorage.getItem('bg_shooter_best')
    const n = v ? Number(v) : 0
    return Number.isFinite(n) ? n : 0
  })

  const isGameOver = lives <= 0

  const tuning = useMemo(() => {
    if (difficulty === 'easy') {
      return {
        fireCooldownMs: 220,
        bulletSpeed: 720,
        targetSpawnMs: 900,
        targetSpeedMin: 55,
        targetSpeedMax: 115,
        targetHp: 1,
        lives: 4,
      }
    }
    if (difficulty === 'hard') {
      return {
        fireCooldownMs: 170,
        bulletSpeed: 820,
        targetSpawnMs: 520,
        targetSpeedMin: 95,
        targetSpeedMax: 190,
        targetHp: 2,
        lives: 3,
      }
    }
    return {
      fireCooldownMs: 190,
      bulletSpeed: 780,
      targetSpawnMs: 700,
      targetSpeedMin: 75,
      targetSpeedMax: 155,
      targetHp: 1,
      lives: 3,
    }
  }, [difficulty])

  const stateRef = useRef<{
    w: number
    h: number
    dpr: number
    ship: Rect & { vx: number }
    bullets: Bullet[]
    targets: Target[]
    stars: Star[]
    fireCooldown: number
    spawnCooldown: number
    pointerX: number | null
    leftHeld: boolean
    rightHeld: boolean
    spaceHeld: boolean
    running: boolean
  } | null>(null)

  function syncRunning(v: boolean) {
    setRunning(v)
    const s = stateRef.current
    if (s) s.running = v
  }

  function reset(nextDifficulty = difficulty) {
    setDifficulty(nextDifficulty)
    setScore(0)
    setLives(nextDifficulty === 'easy' ? 4 : nextDifficulty === 'hard' ? 3 : 3)
    syncRunning(true)

    const s = stateRef.current
    if (!s) return
    s.bullets = []
    s.targets = []
    s.fireCooldown = 0
    s.spawnCooldown = 0
    s.pointerX = null
    s.leftHeld = false
    s.rightHeld = false
    s.spaceHeld = false
    s.ship.x = (s.w - s.ship.w) / 2
    s.ship.y = s.h - s.ship.h - 18
    s.ship.vx = 0
  }

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const ro = new ResizeObserver(() => {
      const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(320, Math.floor(rect.width))
      const h = Math.max(420, Math.floor(Math.min(rect.width * 0.72, 560)))

      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`

      const s = stateRef.current
      if (!s) return
      s.w = w
      s.h = h
      s.dpr = dpr
      s.ship.y = h - s.ship.h - 18
      s.ship.x = clamp(s.ship.x, 8, w - s.ship.w - 8)

      if (s.stars.length === 0) {
        s.stars = Array.from({ length: 64 }, () => ({
          x: rand(0, w),
          y: rand(0, h),
          s: rand(0.7, 1.6),
          v: rand(18, 55),
        }))
      }
    })

    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
    const w = 520
    const h = 520
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    stateRef.current = {
      w,
      h,
      dpr,
      ship: { x: (w - 46) / 2, y: h - 56 - 18, w: 46, h: 56, vx: 0 },
      bullets: [],
      targets: [],
      stars: Array.from({ length: 64 }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        s: rand(0.7, 1.6),
        v: rand(18, 55),
      })),
      fireCooldown: 0,
      spawnCooldown: 0,
      pointerX: null,
      leftHeld: false,
      rightHeld: false,
      spaceHeld: false,
      running: true,
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current
      if (!s) return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') s.leftHeld = true
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') s.rightHeld = true
      if (e.key === ' ' || e.key === 'Enter') s.spaceHeld = true
      if (e.key === 'p' || e.key === 'P') syncRunning(!running)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const s = stateRef.current
      if (!s) return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') s.leftHeld = false
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') s.rightHeld = false
      if (e.key === ' ' || e.key === 'Enter') s.spaceHeld = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [running])

  useEffect(() => {
    if (difficulty === 'easy') setLives(4)
    else if (difficulty === 'hard') setLives(3)
    else setLives(3)
  }, [difficulty])

  useEffect(() => {
    if (!isMountedRef.current) return
    window.localStorage.setItem('bg_shooter_best', String(best))
  }, [best])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current
      if (!s) return
      const rect = canvas.getBoundingClientRect()
      s.pointerX = e.clientX - rect.left
    }

    const onPointerLeave = () => {
      const s = stateRef.current
      if (!s) return
      s.pointerX = null
    }

    const onPointerDown = () => {
      const s = stateRef.current
      if (!s) return
      s.spaceHeld = true
    }
    const onPointerUp = () => {
      const s = stateRef.current
      if (!s) return
      s.spaceHeld = false
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = (ts: number) => {
      const s = stateRef.current
      if (!s) return

      const dt = lastTsRef.current === null ? 0 : Math.min(0.033, (ts - lastTsRef.current) / 1000)
      lastTsRef.current = ts

      const scale = s.dpr
      ctx.setTransform(scale, 0, 0, scale, 0, 0)

      // background
      ctx.clearRect(0, 0, s.w, s.h)
      const bg = ctx.createLinearGradient(0, 0, 0, s.h)
      bg.addColorStop(0, 'rgba(170, 59, 255, 0.16)')
      bg.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, s.w, s.h)

      // stars
      for (const st of s.stars) {
        st.y += st.v * dt
        if (st.y > s.h + 4) {
          st.y = -6
          st.x = rand(0, s.w)
          st.v = rand(18, 55)
        }
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath()
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2)
        ctx.fill()
      }

      // sim only when running and not game over
      if (s.running && !isGameOver) {
        s.fireCooldown = Math.max(0, s.fireCooldown - dt * 1000)
        s.spawnCooldown = Math.max(0, s.spawnCooldown - dt * 1000)

        // ship move
        const speed = 420
        let desiredVx = 0
        if (s.pointerX !== null) {
          const target = s.pointerX - s.ship.w / 2
          const dx = target - s.ship.x
          desiredVx = clamp(dx * 10, -speed, speed)
        } else {
          if (s.leftHeld) desiredVx -= speed
          if (s.rightHeld) desiredVx += speed
        }
        s.ship.vx = desiredVx
        s.ship.x = clamp(s.ship.x + s.ship.vx * dt, 8, s.w - s.ship.w - 8)

        // fire
        if (s.spaceHeld && s.fireCooldown <= 0) {
          s.fireCooldown = tuning.fireCooldownMs
          s.bullets.push({
            x: s.ship.x + s.ship.w / 2,
            y: s.ship.y + 10,
            vy: -tuning.bulletSpeed,
            r: 4.2,
          })
        }

        // spawn targets
        if (s.spawnCooldown <= 0) {
          s.spawnCooldown = tuning.targetSpawnMs * rand(0.85, 1.15)
          const r = rand(14, 22)
          const x = rand(r + 10, s.w - r - 10)
          const vy = rand(tuning.targetSpeedMin, tuning.targetSpeedMax)
          const vx = rand(-35, 35)
          const hp = tuning.targetHp
          s.targets.push({ x, y: -r - 10, vx, vy, r, hp, maxHp: hp })
        }

        // bullets update
        s.bullets = s.bullets
          .map((b) => ({ ...b, y: b.y + b.vy * dt }))
          .filter((b) => b.y > -30)

        // targets update + life loss on escape
        const nextTargets: Target[] = []
        for (const t of s.targets) {
          const nx = t.x + t.vx * dt
          const ny = t.y + t.vy * dt
          const bouncedX =
            nx < t.r + 8 ? { x: t.r + 8, vx: Math.abs(t.vx) } : nx > s.w - t.r - 8 ? { x: s.w - t.r - 8, vx: -Math.abs(t.vx) } : null
          const x2 = bouncedX ? bouncedX.x : nx
          const vx2 = bouncedX ? bouncedX.vx : t.vx

          if (ny > s.h + t.r + 20) {
            setLives((lv) => Math.max(0, lv - 1))
            continue
          }
          nextTargets.push({ ...t, x: x2, y: ny, vx: vx2 })
        }
        s.targets = nextTargets

        // collisions
        if (s.targets.length && s.bullets.length) {
          const bullets = s.bullets.slice()
          const targets = s.targets.slice()
          const bulletUsed = new Array(bullets.length).fill(false)

          for (let ti = 0; ti < targets.length; ti++) {
            const t = targets[ti]!
            for (let bi = 0; bi < bullets.length; bi++) {
              if (bulletUsed[bi]) continue
              const b = bullets[bi]!
              if (!circleHit({ x: t.x, y: t.y, r: t.r }, { x: b.x, y: b.y, r: b.r })) continue
              bulletUsed[bi] = true
              t.hp -= 1
              if (t.hp <= 0) {
                setScore((sc) => sc + 10)
              } else {
                setScore((sc) => sc + 2)
              }
              break
            }
          }

          s.bullets = bullets.filter((_, i) => !bulletUsed[i])
          s.targets = targets.filter((t) => t.hp > 0)
        }
      }

      // draw ship
      const ship = s.ship
      ctx.save()
      ctx.translate(ship.x, ship.y)
      ctx.fillStyle = 'rgba(192, 132, 252, 0.26)'
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.55)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(0, 8, ship.w, ship.h - 8, 12)
      ctx.fill()
      ctx.stroke()

      // cannon
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.beginPath()
      ctx.roundRect(ship.w / 2 - 6, 0, 12, 18, 8)
      ctx.fill()
      ctx.restore()

      // draw bullets
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      for (const b of s.bullets) {
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // draw targets
      for (const t of s.targets) {
        ctx.fillStyle = 'rgba(170, 59, 255, 0.18)'
        ctx.strokeStyle = 'rgba(170, 59, 255, 0.45)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        if (t.maxHp > 1) {
          const pct = t.hp / t.maxHp
          const bw = t.r * 1.6
          const bh = 5
          const bx = t.x - bw / 2
          const by = t.y + t.r + 9
          ctx.fillStyle = 'rgba(0,0,0,0.25)'
          ctx.fillRect(bx, by, bw, bh)
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.fillRect(bx, by, bw * pct, bh)
        }
      }

      // overlay game over
      if (isGameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, 0, s.w, s.h)
        ctx.fillStyle = 'rgba(255,255,255,0.94)'
        ctx.font = '700 28px system-ui, Segoe UI, Roboto, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Game Over', s.w / 2, s.h / 2 - 10)
        ctx.font = '500 14px system-ui, Segoe UI, Roboto, sans-serif'
        ctx.fillText('Bấm “Chơi lại” để thử lần nữa', s.w / 2, s.h / 2 + 18)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTsRef.current = null
    }
  }, [isGameOver, tuning])

  useEffect(() => {
    if (score > best) setBest(score)
  }, [best, score])

  return (
    <div className="shooterPage">
      <div className="shooterHeader">
        <div className="shooterTitle">
          <h1>Bắn súng</h1>
          <p>
            Di chuyển: <code>A/D</code> hoặc <code>←/→</code> (hoặc rê chuột). Bắn:{' '}
            <code>Space</code> (hoặc click). Tạm dừng: <code>P</code>.
          </p>
        </div>

        <div className="shooterActions">
          <label className="shooterField">
            <span className="shooterLabel">Độ khó</span>
            <select
              value={difficulty}
              onChange={(e) => {
                const d = e.target.value as Difficulty
                reset(d)
              }}
            >
              <option value="easy">Dễ</option>
              <option value="normal">Vừa</option>
              <option value="hard">Khó</option>
            </select>
          </label>

          <span className="shooterStatus" aria-live="polite">
            Điểm: <strong>{score}</strong> · Mạng: <strong>{lives}</strong> · Best:{' '}
            <strong>{best}</strong>
          </span>

          <button className="btn" onClick={() => syncRunning(!running)} disabled={isGameOver}>
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

      <div className="shooterWrap" ref={wrapRef}>
        <canvas className="shooterCanvas" ref={canvasRef} aria-label="Game bắn súng" role="img" />
      </div>
    </div>
  )
}

