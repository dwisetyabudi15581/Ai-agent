// ============ DETEKSI LINGKUNGAN: Android/Termux vs desktop ============
// Dipakai prompt (system) & bagian lain yang butuh tahu shell/OS nyata.
// Tidak bergantung pada nama folder proyek — bebas dipindah ke Windows/Linux/macOS.

import fs from "fs";
import os from "os";
import path from "path";

export const IS_ANDROID = process.platform === "android" || /android/i.test(os.release() || "");
export const IS_TERMUX = IS_ANDROID && (fs.existsSync("/data/data/com.termux") || /com\.termux/.test(process.env.PREFIX || ""));
export const IS_WIN = process.platform === "win32";

/** Nama sistem operasi yang enak dibaca. */
export function namaOS() {
  if (IS_TERMUX) return "Android/Termux";
  if (IS_ANDROID) return "Android";
  if (IS_WIN) return `Windows ${os.release()}`;
  const peta = { darwin: "macOS", linux: "Linux", freebsd: "FreeBSD" };
  const dasar = peta[process.platform] || process.platform;
  return `${dasar} ${os.release()}`;
}

/** Shell yang benar-benar dipakai saat menjalankan perintah. */
export function namaShell() {
  if (IS_WIN) return `${process.env.COMSPEC || "cmd.exe"} / powershell`;
  return process.env.SHELL || "/bin/sh";
}

/** Direktori home user yang sedang aktif. */
export function homeUser() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Folder kerja saat ini, dipendekkan bila di dalam home. */
export function dirKerja() {
  const cwd = process.cwd();
  const h = homeUser();
  return cwd === h ? cwd : cwd.startsWith(h) ? "~" + cwd.slice(h.length) : cwd;
}

/** Pemetaan path -> path lokal (mis. /sdcard di Termux vs C:\ di Windows). */
export function pemetaanPath() {
  if (IS_TERMUX) return "penyimpanan HP: /sdcard (= ~/storage/shared)";
  if (IS_WIN) return "path Windows: C:\\..., gunakan forward slash di perintah bash";
  return "path POSIX standar";
}

/** Ringkasan satu baris untuk prompt sistem. */
export function ringkasLingkungan() {
  return `OS: ${namaOS()}, shell: ${namaShell()}, node: ${process.version}`;
}
