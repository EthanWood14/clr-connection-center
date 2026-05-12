import fs from "fs";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH ?? "clr.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? (DB_PATH.startsWith("/data") ? "/data/backups" : path.join(path.dirname(path.resolve(DB_PATH)), "backups"));
const MAX_BACKUPS = 10;

export function createBackup(reason: string): string {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.error(`[backup] Source DB not found at ${DB_PATH}`);
      return "";
    }
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeReason = reason.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `clr.db.${ts}.${safeReason}.bak`;
    const dest = path.join(BACKUP_DIR, filename);

    fs.copyFileSync(DB_PATH, dest);
    console.log(`[backup] Created: ${dest}`);
    pruneBackups();
    return dest;
  } catch (e: any) {
    console.error(`[backup] Failed: ${e?.message ?? e}`);
    return "";
  }
}

function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".bak"))
      .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUPS).forEach((f) => {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log(`[backup] Pruned old backup: ${f.name}`);
      } catch (e: any) {
        console.error(`[backup] Failed to prune ${f.name}: ${e?.message ?? e}`);
      }
    });
  } catch (e: any) {
    console.error(`[backup] Prune error: ${e?.message ?? e}`);
  }
}

export function listBackups(): Array<{ name: string; size: number; created_at: string }> {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".bak"))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, created_at: new Date(st.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (e: any) {
    console.error(`[backup] List error: ${e?.message ?? e}`);
    return [];
  }
}
