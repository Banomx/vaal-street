import { useState } from "react";
import Poe1App from "../games/poe1/Poe1App.jsx";
import Poe2App from "../games/poe2/Poe2App.jsx";
import { activeGameStore } from "../shared/storage/jsonStore.js";

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

  return <ActiveGame activeGame={game} onGameChange={selectGame} />;
}
