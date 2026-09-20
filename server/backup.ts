import fs from "fs";
import path from "path";

const DB_PATH = process.env.DATABASE_PATH ?? "clr.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? (DB_PATH.startsWith("/data") ? "/data/backups" : path.join(path.dirname(path.resolve(DB_PATH)), "backups"));

// Retention is by *reason*, not a flat count: daily backups are the ones we
// want for disaster recovery; pre-delete snapshots are ephemeral safety nets
// that used to refill /data when every LO/outcome delete kept a full DB copy.
const MAX_DAILY_BACKUPS = Number(process.env.BACKUP_MAX_DAILY ?? 3);
const MAX_PRE_DELETE_BACKUPS = Number(process.env.BACKUP_MAX_PRE_DELETE ?? 0);
const MAX_OTHER_BACKUPS = Number(process.env.BACKUP_MAX_OTHER ?? 3);

type BackupFile = { name: string; time: number; reason: string };

/** Filename shape: clr.db.{iso-ts}.{reason}.bak */
function reasonFromFilename(name: string): string {
  const parts = name.split(".");
  // ["clr", "db", "2026-09-19T08-00-00", "daily", "bak"]
  if (parts.length >= 5 && parts[parts.length - 1] === "bak") {
    return parts[parts.length - 2] || "other";
  }
  return "other";
}

function limitForReason(reason: string): number {
  if (reason === "daily") return Math.max(0, MAX_DAILY_BACKUPS);
  if (reason === "pre-delete" || reason === "pre_delete") return Math.max(0, MAX_PRE_DELETE_BACKUPS);
  return Math.max(0, MAX_OTHER_BACKUPS);
}

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
    const files: BackupFile[] = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".bak"))
      .map((f) => ({
        name: f,
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs,
        reason: reasonFromFilename(f),
      }))
      .sort((a, b) => b.time - a.time);

    const keptByReason = new Map<string, number>();
    for (const f of files) {
      const kept = keptByReason.get(f.reason) ?? 0;
      const limit = limitForReason(f.reason);
      if (kept < limit) {
        keptByReason.set(f.reason, kept + 1);
        continue;
      }
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log(`[backup] Pruned old backup: ${f.name} (reason=${f.reason}, keep=${limit})`);
      } catch (e: any) {
        console.error(`[backup] Failed to prune ${f.name}: ${e?.message ?? e}`);
      }
    }
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
