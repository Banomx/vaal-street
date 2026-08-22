const GAME_IDS = new Set(["poe1", "poe2"]);

export function gameDataBase(game) {
  if (!GAME_IDS.has(game)) throw new Error(`Unsupported game data namespace: ${game}`);
  /* `import.meta.env` only exists under vite. Falling back to "/" keeps every
     module that reaches this importable from node, which is what lets the
     tests check the app's own file contracts against the generated data
     instead of a hand-copied duplicate of them. */
  return `${import.meta.env?.BASE_URL ?? "/"}data/${game}`;
}

export function gameDataUrl(game, ...parts) {
  const safeParts = parts.map((part) => encodeURIComponent(String(part)));
  return [gameDataBase(game), ...safeParts].join("/");
}
