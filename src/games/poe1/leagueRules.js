// GGG replaced scarabs with Threads of Creation starting with 3.30.
const THREADS_ERA = Date.parse("2026-11-13T00:00:00Z");
const UMBRA = /^(?:(?:hardcore|ssf|ruthless|hc) )*(?:covens(?: of umbra)?|umbra)(?: (?:hardcore|ssf|ruthless|hc))*$/i;

export function usesThreads(name, start) {
  if (UMBRA.test((name || "").trim().replace(/\s+/g, " "))) return true;
  return typeof start === "string" && Date.parse(start) >= THREADS_ERA;
}
