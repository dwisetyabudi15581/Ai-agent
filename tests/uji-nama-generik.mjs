// Uji regresi: penetralan nama "RELINK" pada env var & konstanta preset.
// Tujuan: memastikan nama generik (API_KEY / BASE_URL / PRESET_MODEL) bekerja,
// sekaligus alias lama tetap kompatibel agar instalasi lama tidak rusak.
import process from "node:process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

let lulus = 0;
let gagal = 0;
function cek(nama, syarat, detail = "") {
  if (syarat) {
    lulus++;
    console.log(`  ok   ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` -> ${detail}` : ""}`);
  }
}

// Siapkan direktori terisolasi SEBELUM mengimpor modul konfigurasi,
// karena src/paths.js menghitung DIR_DATA dari $HOME saat impor.
const homeAsli = process.env.HOME;
const cwdAsli = process.cwd();
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "uji-generik-"));
process.env.HOME = tmp;
process.chdir(tmp);

// Bersihkan semua nama env terkait agar kondisinya terkontrol.
for (const k of [
  "API_KEY",
  "BASE_URL",
  "BASE_URL_CADANGAN",
  "OPENAI_API_KEY",
  "RELINK_API_KEY",
  "RELINK_BASE_URL",
  "RELINK_BASE_CADANGAN",
]) {
  delete process.env[k];
}

const ROOT = path.resolve(cwdAsli);

console.log("\n[1] Konstanta preset memakai nama generik");
const {
  PRESET_MODEL,
  PRESET_RELINK,
} = await import(`${ROOT}/src/api/preset-model.js`);
cek("PRESET_MODEL berupa array tidak kosong", Array.isArray(PRESET_MODEL) && PRESET_MODEL.length > 0);
cek("alias PRESET_RELINK masih menunjuk objek yang sama", PRESET_RELINK === PRESET_MODEL);

console.log("\n[2] config.js membaca API_KEY / BASE_URL generik");
process.env.API_KEY = "sk-generik-uji";
process.env.BASE_URL = "https://contoh.test/v1";
const { muatConfig } = await import(`${ROOT}/src/config/config.js`);
const cfg = await muatConfig();
cek("apiKey dari API_KEY terbaca", cfg.apiKey === "sk-generik-uji", String(cfg.apiKey));
cek("baseUrl dari BASE_URL terbaca", cfg.baseUrl === "https://contoh.test/v1", String(cfg.baseUrl));

console.log("\n[3] Alias lama tetap dihormati bila nama generik kosong");
delete process.env.API_KEY;
delete process.env.BASE_URL;
process.env.RELINK_API_KEY = "sk-lama-uji";
process.env.RELINK_BASE_URL = "https://lama.test/v1";
const cfgLama = await muatConfig();
cek("RELINK_API_KEY masih terbaca sebagai cadangan", cfgLama.apiKey === "sk-lama-uji", String(cfgLama.apiKey));
cek("RELINK_BASE_URL masih terbaca sebagai cadangan", cfgLama.baseUrl === "https://lama.test/v1", String(cfgLama.baseUrl));

console.log("\n[4] Nama generik menang atas alias lama");
process.env.API_KEY = "sk-generik-2";
process.env.BASE_URL = "https://baru.test/v1";
const cfgMenang = await muatConfig();
cek("API_KEY diprioritaskan", cfgMenang.apiKey === "sk-generik-2", String(cfgMenang.apiKey));
cek("BASE_URL diprioritaskan", cfgMenang.baseUrl === "https://baru.test/v1", String(cfgMenang.baseUrl));

// Bereskan.
process.chdir(cwdAsli);
process.env.HOME = homeAsli;
await fs.rm(tmp, { recursive: true, force: true });

console.log(`\nHasil: ${lulus} lulus / ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
