const GAMES = [
  { id: "poe1", label: "PoE 1" },
  { id: "poe2", label: "PoE 2" },
];

export default function GameSwitcher({ activeGame, onChange }) {
  return (
    <div className="game-switcher" aria-label="Path of Exile game">
      <span>Game</span>
      <div className="game-switcher-buttons">
        {GAMES.map((game) => (
          <button
            type="button"
            key={game.id}
            className={activeGame === game.id ? "on" : ""}
            aria-pressed={activeGame === game.id}
            onClick={() => onChange(game.id)}
          >
            {game.label}
          </button>
        ))}
      </div>
    </div>
  );
}
