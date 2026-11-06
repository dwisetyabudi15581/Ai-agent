// ============ LOKASI DATA (satu sumber kebenaran untuk semua path) ============
// Lintas OS:
//   Termux/Android : ~/.agent-termux   (plus fallback ke nama lama agar data lama tetap terbaca)
//   Linux/macOS    : ~/.config/agent-termux
//   Windows        : %APPDATA%\agent-termux
// Override selalu bisa lewat env AGENT_DATA_DIR.
import fsNode from "fs";
import os from "os";
import path from "path";

export const IS_WIN = process.platform === "win32";

export const HOME =
  process.env.HOME || process.env.USERPROFILE || os.homedir() || process.cwd();

/** Kandidat direktori data, urut prioritas (yang pertama ada dipakai). */
export function kandidatDirData() {
  const daftar = [];
  const env = process.env.AGENT_DATA_DIR;
  if (env && env.trim()) daftar.push(env.trim());

  if (IS_WIN) {
    const appdata = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
    daftar.push(path.join(appdata, "agent-termux"));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg && xdg.trim()) daftar.push(path.join(xdg.trim(), "agent-termux"));
    daftar.push(path.join(HOME, ".config", "agent-termux"));
  }

  // Kandidat lama (gaya termux, langsung di home) — dipakai bila sudah berisi data.
  daftar.push(path.join(HOME, ".agent-termux"));
  return daftar;
}

function pilihDirData() {
  const daftar = kandidatDirData();
  const envDiberi = Boolean(process.env.AGENT_DATA_DIR && process.env.AGENT_DATA_DIR.trim());
  if (envDiberi) return daftar[0]; // override eksplisit: jangan cari-cari
  // Direktori dianggap "sudah dipakai" bila berisi data ATAU sudah dibuat
  // secara eksplisit oleh user/uji (mis. mkdir ~/.agent-termux). Tanpa cek
  // keduanya, folder kosong buatan sendiri akan dilewati dan data terpencar.
  const sudahDipakai = daftar.find((d) => {
    try {
      return (
        fsNode.existsSync(path.join(d, "config.json")) ||
        fsNode.existsSync(path.join(d, "memory.md")) ||
        fsNode.existsSync(d)
      );
    } catch {
      return false;
    }
  });
  return sudahDipakai || daftar[0];
}

export const DIR_DATA = pilihDirData();
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
        [DIR_DATA, DIR_SESI, DIR_BACKUP, DIR_TRANSKRIP].map((d) => fs.mkdir(d, { recursive: true }))
      );
    })().catch((e) => {
      dirSiap = null; // boleh dicoba lagi
      throw e;
    });
  }
  return dirSiap;
}

/** Tampilan pendek direktori data untuk pesan ke user (~ pengganti HOME). */
export function tampilDirData() {
  const h = HOME;
  return DIR_DATA === h ? DIR_DATA : DIR_DATA.startsWith(h) ? "~" + DIR_DATA.slice(h.length) : DIR_DATA;
}
