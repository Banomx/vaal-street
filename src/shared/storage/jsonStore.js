const PREFIX = "vaal-street";

export function createJsonStore({ game = "shared", feature, version = 1, storage }) {
  if (!feature) throw new Error("A storage feature name is required");
  const key = `${PREFIX}.${game}.${feature}.v${version}`;
  const target = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);

  return {
    key,
    load(fallback = null) {
      if (!target) return fallback;
      try {
        const value = JSON.parse(target.getItem(key));
        return value ?? fallback;
      } catch {
        return fallback;
      }
    },
    save(value) {
      if (!target) return value;
      try { target.setItem(key, JSON.stringify(value)); } catch { /* quota/private mode */ }
      return value;
    },
    clear() {
      try { target?.removeItem(key); } catch { /* private mode */ }
    },
  };
}

export const activeGameStore = createJsonStore({ feature: "active-game" });
