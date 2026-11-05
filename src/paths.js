// ============ LOKASI DATA (satu sumber kebenaran untuk semua path) ============
import path from "path";

export const HOME = process.env.HOME || process.cwd();
export const DIR_DATA = path.join(HOME, ".agent-termux");
export const DIR_SESI = path.join(DIR_DATA, "sessions");
export const DIR_BACKUP = path.join(DIR_DATA, "backups");
export const DIR_TRANSKRIP = path.join(DIR_DATA, "transkrip");

// ---------- State modul ----------
let dirSiap = null;

/** Buat semua direktori data sekali saja (idempoten, tanpa fs.mkdir berulang). */
export function pastikanDir() {
  if (!dirSiap) {
    dirSiap = (async () => {
      const fs = await import("fs/promises");
      await Promise.all(
        [DIR_SESI, DIR_BACKUP, DIR_TRANSKRIP].map((d) => fs.mkdir(d, { recursive: true }))
      );
    })().catch((e) => {
      dirSiap = null; // boleh dicoba lagi
      throw e;
    });
  }
  return dirSiap;
}
