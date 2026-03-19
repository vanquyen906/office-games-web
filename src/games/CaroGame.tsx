import { useMemo, useState } from 'react'

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
      : `Lượt của: ${current}`

  function reset() {
    setBoard(Array.from({ length: size }, () => Array.from({ length: size }, () => null)))
    setCurrent('X')
    setWinner(null)
    setLastMove(null)
  }

  function play(row: number, col: number) {
    if (winner) return
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

  return (
    <div className="caroPage">
      <div className="caroHeader">
        <div className="caroTitle">
          <h1>Caro</h1>
          <p>Đánh 5 quân liên tiếp để thắng (ngang/dọc/chéo).</p>
        </div>

        <div className="caroActions">
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

