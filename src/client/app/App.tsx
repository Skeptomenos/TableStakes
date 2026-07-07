import { GAME_ROUTE_PREFIX } from '../../shared/routes'
import { usePath } from '../router'
import { GameRoute } from '../routes/GameRoute'
import { HomeRoute } from '../routes/HomeRoute'

export function App() {
  const path = usePath()
  const gameCode = path.startsWith(GAME_ROUTE_PREFIX)
    ? path.slice(GAME_ROUTE_PREFIX.length).split('/')[0]!
    : null

  return (
    <main className="app-shell">
      <header className="app-shell__header">
        <h1 className="app-shell__title">Poker Chip Counter</h1>
      </header>
      <section className="app-shell__body">
        {gameCode ? <GameRoute code={gameCode} /> : <HomeRoute />}
      </section>
    </main>
  )
}
