import { useEffect, useMemo, useRef, useState } from 'react'

type Cell = 'X' | 'O' | null

function countInDirection(
  board: Cell[][],
  row: number,
  col: number,
  dRow: number,
  dCol: number,
  player: Exclude<Cell, null>,
) {
  let r = row + dRow
  let c = col + dCol
  let count = 0
  while (r >= 0 && r < board.length && c >= 0 && c < board[0]!.length) {
    if (board[r]![c] !== player) break
    count += 1
    r += dRow
    c += dCol
  }
  return count
}

function isWinFromMove(
  board: Cell[][],
  row: number,
  col: number,
  player: Exclude<Cell, null>,
  needed = 5,
) {
  const directions: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]

  for (const [dr, dc] of directions) {
    const total =
      1 +
      countInDirection(board, row, col, dr, dc, player) +
      countInDirection(board, row, col, -dr, -dc, player)
    if (total >= needed) return true
  }
  return false
}

function getCandidateMoves(board: Cell[][]) {
  const size = board.length
  const occupied: Array<{ row: number; col: number }> = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r]![c] !== null) occupied.push({ row: r, col: c })
    }
  }

  if (occupied.length === 0) {
    const mid = Math.floor(size / 2)
    return [{ row: mid, col: mid }]
  }

  const set = new Set<string>()
  const moves: Array<{ row: number; col: number }> = []
  const radius = 2
  for (const p of occupied) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const r = p.row + dr
        const c = p.col + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        if (board[r]![c] !== null) continue
        const key = `${r},${c}`
        if (set.has(key)) continue
        set.add(key)
        moves.push({ row: r, col: c })
      }
    }
  }
  return moves
}

function scoreMove(board: Cell[][], row: number, col: number, player: Exclude<Cell, null>) {
  const opponent: Exclude<Cell, null> = player === 'X' ? 'O' : 'X'
  const directions: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]

  const countLine = (p: Exclude<Cell, null>, dr: number, dc: number) => {
    const a = countInDirection(board, row, col, dr, dc, p)
    const b = countInDirection(board, row, col, -dr, -dc, p)
    return a + b
  }

  let score = 0
  for (const [dr, dc] of directions) {
    const own = countLine(player, dr, dc)
    const opp = countLine(opponent, dr, dc)
    score += (own + 1) * (own + 1) * 2
    score += (opp + 1) * (opp + 1)
  }
  return score
}

function chooseAiMove(
  board: Cell[][],
  ai: Exclude<Cell, null>,
  difficulty: 'easy' | 'normal',
) {
  const opponent: Exclude<Cell, null> = ai === 'X' ? 'O' : 'X'
  const candidates = getCandidateMoves(board)

  // 1) Win immediately
  for (const m of candidates) {
    const next = board.map((r) => r.slice())
    next[m.row]![m.col] = ai
    if (isWinFromMove(next, m.row, m.col, ai)) return m
  }

  // 2) Block opponent immediate win
  for (const m of candidates) {
    const next = board.map((r) => r.slice())
    next[m.row]![m.col] = opponent
    if (isWinFromMove(next, m.row, m.col, opponent)) return m
  }

  // 3) Heuristic best move
  const scored = candidates
    .map((m) => ({
      m,
      s: scoreMove(board, m.row, m.col, ai),
    }))
    .sort((a, b) => b.s - a.s)

  if (scored.length === 0) return null
  if (difficulty === 'easy') {
    const top = scored.slice(0, Math.min(6, scored.length))
    return top[Math.floor(Math.random() * top.length)]!.m
  }
  return scored[0]!.m
}

export function CaroGame(props: { onBack: () => void }) {
  const size = 15
  const [board, setBoard] = useState<Cell[][]>(() =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => null)),
  )
  const [current, setCurrent] = useState<Exclude<Cell, null>>('X')
  const [winner, setWinner] = useState<Exclude<Cell, null> | null>(null)
  const [lastMove, setLastMove] = useState<{ row: number; col: number } | null>(
    null,
  )
  const [mode, setMode] = useState<'pvp' | 'ai'>('ai')
  const [human, setHuman] = useState<Exclude<Cell, null>>('X')
  const [difficulty, setDifficulty] = useState<'easy' | 'normal'>('normal')
  const thinkingRef = useRef(false)

  const ai: Exclude<Cell, null> = human === 'X' ? 'O' : 'X'

  const isDraw = useMemo(() => {
    if (winner) return false
    for (const row of board) {
      for (const cell of row) if (cell === null) return false
    }
    return true
  }, [board, winner])

  const status = winner
    ? `Người thắng: ${winner}`
    : isDraw
      ? 'Hòa'
      : mode === 'ai'
        ? current === human
          ? `Lượt của bạn: ${human}`
          : `Máy đang đánh: ${ai}`
        : `Lượt của: ${current}`

  function reset() {
    setBoard(
      Array.from({ length: size }, () => Array.from({ length: size }, () => null)),
    )
    setCurrent('X')
    setWinner(null)
    setLastMove(null)
    thinkingRef.current = false
  }

  function play(row: number, col: number) {
    if (winner) return
    if (mode === 'ai' && current !== human) return
    if (board[row]![col] !== null) return

    const next = board.map((r) => r.slice())
    next[row]![col] = current

    setBoard(next)
    setLastMove({ row, col })

    if (isWinFromMove(next, row, col, current)) {
      setWinner(current)
      return
    }

    setCurrent((p) => (p === 'X' ? 'O' : 'X'))
  }

  useEffect(() => {
    if (mode !== 'ai') return
    if (winner || isDraw) return
    if (current !== ai) return
    if (thinkingRef.current) return

    thinkingRef.current = true
    const t = window.setTimeout(() => {
      const move = chooseAiMove(board, ai, difficulty)
      if (!move) {
        thinkingRef.current = false
        return
      }

      const next = board.map((r) => r.slice())
      next[move.row]![move.col] = ai
      setBoard(next)
      setLastMove(move)

      if (isWinFromMove(next, move.row, move.col, ai)) {
        setWinner(ai)
        thinkingRef.current = false
        return
      }

      setCurrent(human)
      thinkingRef.current = false
    }, 180)

    return () => window.clearTimeout(t)
  }, [ai, board, current, difficulty, human, isDraw, mode, winner])

  return (
    <div className="caroPage">
      <div className="caroHeader">
        <div className="caroTitle">
          <h1>Caro</h1>
          <p>Đánh 5 quân liên tiếp để thắng (ngang/dọc/chéo).</p>
        </div>

        <div className="caroActions">
          <label className="caroField">
            <span className="caroLabel">Chế độ</span>
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as 'pvp' | 'ai')
                reset()
              }}
            >
              <option value="ai">Chơi với máy</option>
              <option value="pvp">2 người</option>
            </select>
          </label>

          <label className="caroField">
            <span className="caroLabel">Bạn chơi</span>
            <select
              value={human}
              disabled={mode !== 'ai'}
              onChange={(e) => {
                setHuman(e.target.value as Exclude<Cell, null>)
                reset()
              }}
            >
              <option value="X">X (đi trước)</option>
              <option value="O">O (đi sau)</option>
            </select>
          </label>

          <label className="caroField">
            <span className="caroLabel">Độ khó</span>
            <select
              value={difficulty}
              disabled={mode !== 'ai'}
              onChange={(e) => {
                setDifficulty(e.target.value as 'easy' | 'normal')
                reset()
              }}
            >
              <option value="easy">Dễ</option>
              <option value="normal">Vừa</option>
            </select>
          </label>

          <span className="caroStatus" aria-live="polite">
            {status}
          </span>
          <button className="btn" onClick={reset}>
            Chơi lại
          </button>
          <button className="btn" onClick={props.onBack}>
            Quay lại danh sách
          </button>
        </div>
      </div>

      <div className="caroBoard" role="grid" aria-label="Bàn cờ caro">
        {board.map((row, r) =>
          row.map((cell, c) => {
            const isLast = lastMove?.row === r && lastMove?.col === c
            return (
              <button
                key={`${r}-${c}`}
                className={`caroCell ${isLast ? 'isLast' : ''}`}
                onClick={() => play(r, c)}
                role="gridcell"
                aria-label={`Hàng ${r + 1}, cột ${c + 1}${cell ? `: ${cell}` : ''}`}
                disabled={winner !== null || (mode === 'ai' && current !== human)}
              >
                {cell}
              </button>
            )
          }),
        )}
      </div>
    </div>
  )
}

