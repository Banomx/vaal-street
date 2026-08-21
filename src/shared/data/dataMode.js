/* Where a page is allowed to get its numbers.

     static  only the generated snapshots under public/data. The production
             default: a published site must not send every visitor at somebody
             else's API, and it must never answer a broken deployment with
             invented numbers — a market tool showing plausible fiction is
             worse than one showing nothing.
     live    an upstream API directly, for a dev server with a proxy.
     demo    a deterministic sample dataset, for offline interface work.
     auto    static, then live, then demo. Development default only.

   `?data=` overrides it anywhere, which is what makes demo mode explicit: it
   is something you ask for, not something that happens to you. */

export const DATA_MODES = ["static", "live", "demo", "auto"];

export function resolveDataMode(search, { dev = false } = {}) {
  let asked = null;
  try {
    const raw = new URLSearchParams(search || "").get("data");
    asked = raw ? String(raw).toLowerCase() : null;
  } catch { /* a malformed query string is not a reason to fail to load */ }
  if (asked && DATA_MODES.includes(asked)) return asked;
  return dev ? "auto" : "static";
}

export const allowsLiveApi = (mode) => mode === "live" || mode === "auto";
export const allowsDemo = (mode) => mode === "demo" || mode === "auto";
