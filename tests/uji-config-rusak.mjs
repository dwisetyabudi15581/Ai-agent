// Uji: config.json yang RUSAK / berisi JSON tak valid tidak boleh membuat
// seluruh agen gagal start. muatConfig harus jatuh ke default.
//
// PENTING: src/paths.js menghitung DIR_DATA dari $HOME saat modul diimpor,
// dan config.js mengimpor paths.js — jadi HOME diganti SEBELUM impor.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const asli = { HOME: process.env.HOME, API_KEY: process.env.API_KEY, BASE_URL: process.env.BASE_URL };
const cwdAsli = process.cwd();
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-rusak-"));

process.env.HOME = tmp;
process.env.API_KEY = "sk-uji";
process.env.BASE_URL = "https://contoh.example.com";
process.chdir(tmp); // hindari ./.env repo

const { muatConfig, simpanConfig, DEFAULT_CONFIG } = await import("../src/config/config.js");
const dirData = path.join(tmp, ".config", "agent-termux");

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  ok ? lulus++ : gagal++;
  console.log(`${ok ? "OK   " : "GAGAL"} ${nama}: ${JSON.stringify(dapat)}` + (ok ? "" : ` (harusnya ${JSON.stringify(harus)})`));
};

try {
  await fs.mkdir(dirData, { recursive: true });
  const berkas = path.join(dirData, "config.json");

  // 1) JSON rusak total
  await fs.writeFile(berkas, '{ "model": "glm-5.3", RUSAK ');
  let cfg = await muatConfig();
  cek("JSON rusak: model kembali ke default", cfg.model, DEFAULT_CONFIG.model);
  cek("JSON rusak: sisa config tetap jalan", typeof cfg.apiKey === "string", true);

  // 2) Isi bukan objek (array / angka) — dulu bisa meledak saat spread
  await fs.writeFile(berkas, "[1,2,3]");
  cfg = await muatConfig();
  cek("array: model kembali ke default", cfg.model, DEFAULT_CONFIG.model);

  await fs.writeFile(berkas, "42");
  cfg = await muatConfig();
  cek("angka: model kembali ke default", cfg.model, DEFAULT_CONFIG.model);

  await fs.writeFile(berkas, "null");
  cfg = await muatConfig();
  cek("null: model kembali ke default", cfg.model, DEFAULT_CONFIG.model);

  // 3) Tipe field salah (string untuk angka, string untuk boolean)
  await fs.writeFile(berkas, JSON.stringify({ maxTokens: "banyak", suhu: "panas", streamDefault: "ya", maksPutaran: -5 }));
  cfg = await muatConfig();
  cek("maxTokens tak valid -> default", cfg.maxTokens, DEFAULT_CONFIG.maxTokens);
  cek("suhu tak valid -> default", cfg.suhu, DEFAULT_CONFIG.suhu);
  cek("maksPutaran negatif -> default", cfg.maksPutaran, DEFAULT_CONFIG.maksPutaran);
  cek("streamDefault dibaca boolean", typeof cfg.streamDefault, "boolean");

  // 4) simpanConfig tetap menulis JSON sah setelah config rusak
  cfg.model = "glm-5.3";
  await simpanConfig(cfg);
  const teks = await fs.readFile(berkas, "utf-8");
  let sah = true;
  try { JSON.parse(teks); } catch { sah = false; }
  cek("simpanConfig menulis JSON sah", sah, true);
  cek("simpanConfig tanpa apiKey", "apiKey" in JSON.parse(teks), false);
} finally {
  process.chdir(cwdAsli);
  process.env.HOME = asli.HOME;
  if (asli.API_KEY === undefined) delete process.env.API_KEY; else process.env.API_KEY = asli.API_KEY;
  if (asli.BASE_URL === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = asli.BASE_URL;
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\nHASIL: ${gagal === 0 ? "LULUS" : "GAGAL"} — lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);
