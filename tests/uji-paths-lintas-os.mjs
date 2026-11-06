// Uji: src/paths.js memilih direktori data secara benar di lintas OS
// (Termux/Android, Linux/macOS XDG, Windows APPDATA) + override AGENT_DATA_DIR
// + fallback ke nama lama ~/.agent-termux.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asli = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME, APP: process.env.APPDATA, AD: process.env.AGENT_DATA_DIR };
let lulus = 0, gagal = 0;
const ok = (nama, syarat, info = "") => {
  if (syarat) { lulus++; console.log(`  \u2713 ${nama}${info ? " — " + info : ""}`); }
  else { gagal++; console.log(`  \u2717 ${nama}${info ? " — " + info : ""}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "paths-uji-"));
const pulihkan = () => {
  for (const [k, v] of Object.entries({ HOME: asli.HOME, XDG_CONFIG_HOME: asli.XDG, APPDATA: asli.APP, AGENT_DATA_DIR: asli.AD })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};

let n = 0;
async function muatUlang(env) {
  // HOME harus diganti SEBELUM impor (paths.js menghitung DIR_DATA saat impor)
  pulihkan();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  // salin paths.js ke berkas unik agar cache ESM tidak menahan modul lama
  const salin = path.join(tmp, `paths-${++n}.mjs`);
  fs.writeFileSync(salin, fs.readFileSync(path.join(ROOT, "src/paths.js"), "utf8"));
  return await import("file://" + salin + `?v=${n}`);
}

try {
  // 1) Termux: home bersih -> ~/.config/agent-termux (belum ada berkas)
  const home1 = fs.mkdtempSync(path.join(tmp, "home1-"));
  let m = await muatUlang({ HOME: home1, XDG_CONFIG_HOME: undefined, APPDATA: undefined, AGENT_DATA_DIR: undefined });
  ok("lintas-OS: kandidat pertama non-Windows adalah ~/.config/agent-termux",
    m.kandidatDirData()[0] === path.join(home1, ".config", "agent-termux"), m.kandidatDirData()[0]);
  ok("lintas-OS: kandidat terakhir berisi nama lama ~/.agent-termux",
    m.kandidatDirData().at(-1) === path.join(home1, ".agent-termux"));
  ok("lintas-OS: DIR_DATA jatuh ke kandidat pertama bila belum ada data",
    m.DIR_DATA === path.join(home1, ".config", "agent-termux"));

  // 2) Data lama di ~/.agent-termux tetap terbaca
  fs.mkdirSync(path.join(home1, ".agent-termux"), { recursive: true });
  fs.writeFileSync(path.join(home1, ".agent-termux", "config.json"), "{}");
  m = await muatUlang({ HOME: home1, XDG_CONFIG_HOME: undefined, APPDATA: undefined, AGENT_DATA_DIR: undefined });
  ok("lintas-OS: fallback membaca data lama ~/.agent-termux",
    m.DIR_DATA === path.join(home1, ".agent-termux"), m.DIR_DATA);

  // 3) XDG_CONFIG_HOME dihormati
  const home2 = fs.mkdtempSync(path.join(tmp, "home2-"));
  const xdg = path.join(home2, "xdg");
  m = await muatUlang({ HOME: home2, XDG_CONFIG_HOME: xdg, APPDATA: undefined, AGENT_DATA_DIR: undefined });
  ok("lintas-OS: XDG_CONFIG_HOME dipakai", m.DIR_DATA === path.join(xdg, "agent-termux"), m.DIR_DATA);

  // 4) AGENT_DATA_DIR menang mutlak
  const kustom = path.join(tmp, "data-kustom");
  m = await muatUlang({ HOME: home2, XDG_CONFIG_HOME: xdg, APPDATA: undefined, AGENT_DATA_DIR: kustom });
  ok("lintas-OS: AGENT_DATA_DIR menang mutlak", m.DIR_DATA === kustom, m.DIR_DATA);

  // 5) pastikanDir membuat semua subfolder
  await m.pastikanDir();
  ok("lintas-OS: DIR_SESI/DIR_BACKUP/DIR_TRANSKRIP dibuat",
    ["sessions", "backups", "transkrip"].every((d) => fs.existsSync(path.join(kustom, d))));

  // 6) tampilDirData memendekkan home jadi ~ (hanya bila direktori di dalam HOME)
  const diHome = path.join(home2, "data-di-home");
  m = await muatUlang({ HOME: home2, XDG_CONFIG_HOME: xdg, APPDATA: undefined, AGENT_DATA_DIR: diHome });
  ok("lintas-OS: tampilDirData memakai ~ untuk path di dalam HOME",
    m.tampilDirData() === "~/data-di-home", m.tampilDirData());
  ok("lintas-OS: tampilDirData tidak memalsukan ~ untuk path di luar HOME",
    m.tampilDirData().startsWith("~") === diHome.startsWith(home2));
} finally {
  pulihkan();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\npaths lintas-OS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
