import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";

// Restore a whole league so no partial refresh is mixed with its last good snapshot.
export async function retainLeague(finalDir, stageDir, slug) {
  if (!slug || path.basename(slug) !== slug || slug === "." || slug === "..") throw new Error("Invalid league slug");
  const source = path.resolve(finalDir, slug);
  const target = path.resolve(stageDir, slug);
  const stage = path.resolve(stageDir);
  if (target === source || !target.startsWith(stage + path.sep)) throw new Error("Unsafe league restore");
  try { if (!(await stat(source)).isDirectory()) return false; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  return true;
}
