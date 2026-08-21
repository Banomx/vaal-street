const GAME_IDS = new Set(["poe1", "poe2"]);

export function gameDataBase(game) {
  if (!GAME_IDS.has(game)) throw new Error(`Unsupported game data namespace: ${game}`);
  return `${import.meta.env.BASE_URL}data/${game}`;
}

export function gameDataUrl(game, ...parts) {
  const safeParts = parts.map((part) => encodeURIComponent(String(part)));
  return [gameDataBase(game), ...safeParts].join("/");
}
