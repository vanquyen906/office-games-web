import { useState } from 'react'
import './App.css'
import { CaroGame } from './games/CaroGame'
import { TicTacToeGame } from './games/TicTacToeGame'

function App() {
  const games = [
    {
      id: 'two-truths-one-lie',
      name: '2 sự thật 1 lời nói dối',
      players: '3–20',
      duration: '5–10 phút',
      category: 'Icebreaker',
      tags: ['nhanh', 'vui', 'giới thiệu'],
      description:
        'Mỗi người nói 3 điều về bản thân (2 thật, 1 giả). Cả nhóm đoán điều nào là giả.',
    },
    {
      id: 'pictionary',
      name: 'Vẽ đoán ý (Pictionary)',
      players: '4–12',
      duration: '10–20 phút',
      category: 'Teamwork',
      tags: ['vẽ', 'đồng đội'],
      description:
        'Chia đội. Một người vẽ từ khóa (không chữ/không nói), đội đoán trong thời gian giới hạn.',
    },
    {
      id: 'charades',
      name: 'Đóng kịch câm (Charades)',
      players: '4–20',
      duration: '10–15 phút',
      category: 'Party',
      tags: ['diễn', 'vui'],
      description:
        'Diễn tả từ khóa bằng hành động, không được nói. Đội của bạn đoán càng nhanh càng tốt.',
    },
    {
      id: 'office-trivia',
      name: 'Đố vui văn phòng (Trivia)',
      players: '3–30',
      duration: '10–25 phút',
      category: 'Quiz',
      tags: ['kiến thức', 'nhẹ nhàng'],
      description:
        'Câu hỏi ngắn về công ty/văn hóa/đời sống. Có thể chơi theo đội để tăng tương tác.',
    },
    {
      id: 'paper-tower',
      name: 'Xây tháp giấy',
      players: '2–8',
      duration: '10–15 phút',
      category: 'Challenge',
      tags: ['thử thách', 'sáng tạo'],
      description:
        'Dùng giấy A4 và băng keo (tùy chọn) để xây tháp cao nhất trong thời gian giới hạn.',
    },
    {
      id: 'silent-lineup',
      name: 'Xếp hàng im lặng',
      players: '6–25',
      duration: '5–10 phút',
      category: 'Teamwork',
      tags: ['giao tiếp', 'đồng đội'],
      description:
        'Cả nhóm xếp theo thứ tự (sinh nhật/chiều cao/tuổi) nhưng tuyệt đối không được nói.',
    },
    {
      id: 'caro',
      name: 'Caro (Cờ caro / Gomoku)',
      players: '2',
      duration: '5–15 phút',
      category: 'Strategy',
      tags: ['chiến thuật', 'nhanh', 'đối kháng'],
      description:
        'Chơi 2 người trên lưới ô vuông. Lần lượt đánh X/O; ai tạo được 5 quân liên tiếp (ngang/dọc/chéo) trước sẽ thắng.',
    },
    {
      id: 'tic-tac-toe',
      name: 'Tic Tac Toe (3x3) chơi với máy',
      players: '1',
      duration: '2–5 phút',
      category: 'Strategy',
      tags: ['tic tac toe', 'AI', 'đối kháng', 'nhanh'],
      description:
        'Chơi X/O trên bàn 3x3. Bạn đấu với máy; ai nối 3 quân liên tiếp (ngang/dọc/chéo) trước sẽ thắng.',
    },
  ] as const

  type Category = (typeof games)[number]['category'] | 'Tất cả'

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category>('Tất cả')
  const [activeGameId, setActiveGameId] = useState<string | null>(null)

  const categories = ['Tất cả', ...new Set(games.map((g) => g.category))] as const

  const filtered = games.filter((g) => {
    const q = query.trim().toLowerCase()
    const matchesQuery =
      q.length === 0 ||
      g.name.toLowerCase().includes(q) ||
      g.description.toLowerCase().includes(q) ||
      g.tags.some((t) => t.toLowerCase().includes(q))
    const matchesCategory = category === 'Tất cả' || g.category === category
    return matchesQuery && matchesCategory
  })

  if (activeGameId === 'caro') {
    return (
      <div className="page">
        <CaroGame onBack={() => setActiveGameId(null)} />
      </div>
    )
  }

  if (activeGameId === 'tic-tac-toe') {
    return (
      <div className="page">
        <TicTacToeGame onBack={() => setActiveGameId(null)} />
      </div>
    )
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            BG
          </div>
          <div className="brandText">
            <h1>Danh sách trò chơi văn phòng</h1>
            <p>Chọn nhanh một trò để chơi cùng team (icebreaker, teamwork, quiz...).</p>
          </div>
        </div>

        <div className="controls" role="search">
          <label className="field">
            <span className="label">Tìm kiếm</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ví dụ: vẽ, đồng đội, trivia..."
            />
          </label>

          <label className="field">
            <span className="label">Thể loại</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="content">
        <div className="meta">
          <span className="count">
            Hiển thị <strong>{filtered.length}</strong> / {games.length} trò chơi
          </span>
          {query.trim().length > 0 || category !== 'Tất cả' ? (
            <button
              className="btn"
              onClick={() => {
                setQuery('')
                setCategory('Tất cả')
              }}
            >
              Xóa bộ lọc
            </button>
          ) : null}
        </div>

        <section className="grid" aria-label="Danh sách trò chơi">
          {filtered.map((g) => (
            <article
              key={g.id}
              className="card isClickable"
              tabIndex={0}
              role="button"
              aria-label={`Mở trò chơi: ${g.name}`}
              onClick={() => setActiveGameId(g.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveGameId(g.id)
              }}
            >
              <div className="cardTop">
                <div>
                  <h2 className="cardTitle">{g.name}</h2>
                  <p className="cardDesc">{g.description}</p>
                </div>
                <span className="pill">{g.category}</span>
              </div>

              <dl className="facts">
                <div className="fact">
                  <dt>Người chơi</dt>
                  <dd>{g.players}</dd>
                </div>
                <div className="fact">
                  <dt>Thời lượng</dt>
                  <dd>{g.duration}</dd>
                </div>
              </dl>

              <div className="tags" aria-label="Tags">
                {g.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </section>
      </main>

      <footer className="footer">
        <span>
          Gợi ý: bạn có thể thêm trò chơi bằng cách sửa mảng <code>games</code> trong{' '}
          <code>src/App.tsx</code>.
        </span>
      </footer>
    </div>
  )
}

export default App
