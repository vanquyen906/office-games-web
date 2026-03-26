import { useEffect, useMemo, useRef, useState } from 'react'

type Cell = 'X' | 'O' | null
type Difficulty = 'easy' | 'normal'

const LINES: Array<[number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function getWinner(board: Cell[]) {
  for (const [a, b, c] of LINES) {
    const v = board[a]
    if (v && v === board[b] && v === board[c]) return v
  }
  return null;
}

function getEmptyIndexes(board: Cell[]) {
  const res: number[] = []
  for (let i = 0; i < board.length; i++) if (board[i] === null) res.push(i)
  return res
}

function minimax(board: Cell[], playerToMove: Exclude<Cell, null>, ai: Exclude<Cell, null>) {
  const winner = getWinner(board)
  if (winner) return { score: winner === ai ? 10 : -10, move: null as number | null }

  const empties = getEmptyIndexes(board)
  if (empties.length === 0) return { score: 0, move: null as number | null }

  const opponent: Exclude<Cell, null> = playerToMove === 'X' ? 'O' : 'X'

  let bestMove: number | null = null
  let bestScore = playerToMove === ai ? -Infinity : Infinity

  for (const idx of empties) {
    const next = board.slice()
    next[idx] = playerToMove
    const child = minimax(next, opponent, ai)
    const score = child.score

    if (playerToMove === ai) {
      if (score > bestScore) {
        bestScore = score
        bestMove = idx
      }
    } else {
      if (score < bestScore) {
        bestScore = score
        bestMove = idx
      }
    }
  }

  return { score: bestScore, move: bestMove }
}

function chooseAiMove(board: Cell[], ai: Exclude<Cell, null>, difficulty: Difficulty) {
  const empties = getEmptyIndexes(board)
  if (empties.length === 0) return null

  if (difficulty === 'easy') {
    return empties[Math.floor(Math.random() * empties.length)]!
  }

  const opponent: Exclude<Cell, null> = ai === 'X' ? 'O' : 'X'
  const { move } = minimax(board, ai, ai)
  if (move !== null) return move
  return opponent ? empties[0]! : empties[0]!
}

export function TicTacToeGame(props: { onBack: () => void }) {
  const [board, setBoard] = useState<Cell[]>(() => Array.from({ length: 9 }, () => null))
  const [mode] = useState<'ai'>('ai')
  const [human, setHuman] = useState<Exclude<Cell, null>>('X')
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [current, setCurrent] = useState<Exclude<Cell, null>>('X')
  const thinkingRef = useRef(false)

  const ai: Exclude<Cell, null> = human === 'X' ? 'O' : 'X'
  const winner = useMemo(() => getWinner(board), [board])
  const isDraw = useMemo(() => !winner && getEmptyIndexes(board).length === 0, [board, winner])

  const status = winner
    ? `Người thắng: ${winner}`
    : isDraw
      ? 'Hòa'
      : current === human
        ? `Lượt của bạn: ${human}`
        : `Máy đang đánh: ${ai}`

  function reset(nextHuman = human, nextDifficulty = difficulty) {
    setBoard(Array.from({ length: 9 }, () => null))
    setCurrent('X')
    setHuman(nextHuman)
    setDifficulty(nextDifficulty)
    thinkingRef.current = false
  }

  function play(index: number) {
    if (winner || isDraw) return
    if (mode === 'ai' && current !== human) return
    if (board[index] !== null) return

    const next = board.slice()
    next[index] = current
    setBoard(next)
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
      if (move === null) {
        thinkingRef.current = false
        return
      }
      const next = board.slice()
      next[move] = ai
      setBoard(next)
      setCurrent(human)
      thinkingRef.current = false
    }, 160)

    return () => window.clearTimeout(t)
  }, [ai, board, current, difficulty, human, isDraw, mode, winner])

  return (
    <div className="tttPage">
      <div className="tttHeader">
        <div className="tttTitle">
          <h1>Tic Tac Toe</h1>
          <p>3x3 — nối 3 quân liên tiếp để thắng.</p>
        </div>

        <div className="tttActions">
          <label className="tttField">
            <span className="tttLabel">Bạn chơi</span>
            <select
              value={human}
              onChange={(e) => reset(e.target.value as Exclude<Cell, null>, difficulty)}
            >
              <option value="X">X (đi trước)</option>
              <option value="O">O (đi sau)</option>
            </select>
          </label>

          <label className="tttField">
            <span className="tttLabel">Độ khó</span>
            <select
              value={difficulty}
              onChange={(e) => reset(human, e.target.value as Difficulty)}
            >
              <option value="easy">Dễ</option>
              <option value="normal">Vừa (tối ưu)</option>
            </select>
          </label>

          <span className="tttStatus" aria-live="polite">
            {status}
          </span>
          <button className="btn" onClick={() => reset()}>
            Chơi lại
          </button>
          <button className="btn" onClick={props.onBack}>
            Quay lại danh sách
          </button>
        </div>
      </div>

      <div className="tttBoard" role="grid" aria-label="Bàn cờ tic tac toe">
        {board.map((cell, idx) => (
          <button
            key={idx}
            className="tttCell"
            onClick={() => play(idx)}
            role="gridcell"
            aria-label={`Ô ${idx + 1}${cell ? `: ${cell}` : ''}`}
            disabled={winner !== null || isDraw || current !== human}
          >
            {cell}
          </button>
        ))}
      </div>
    </div>
  )
}

