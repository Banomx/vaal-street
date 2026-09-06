import { lazy, Suspense, useState } from "react";
import ErrorBoundary from "../shared/ui/ErrorBoundary.jsx";
import { activeGameStore } from "../shared/storage/jsonStore.js";

const Poe1App = lazy(() => import("../games/poe1/Poe1App.jsx"));
const Poe2App = lazy(() => import("../games/poe2/Poe2App.jsx"));
const GAME_APPS = {
  poe1: Poe1App,
  poe2: Poe2App,
};

export default function App() {
  const [game, setGame] = useState(() => activeGameStore.load("poe1"));
  const ActiveGame = GAME_APPS[game] || Poe1App;

  const selectGame = (nextGame) => {
    if (!GAME_APPS[nextGame]) return;
    setGame(nextGame);
    activeGameStore.save(nextGame);
  };

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="app-shell-page" role="status">Loading market tools…</div>}>
        <ActiveGame activeGame={game} onGameChange={selectGame} />
      </Suspense>
    </ErrorBoundary>
  );
}
