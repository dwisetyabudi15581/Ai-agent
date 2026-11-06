// Verifikasi: presedensi BASE_URL atas config.json, dan baseUrl tidak
// ikut tersimpan ke disk (termasuk sisa lama).
//
// PENTING: src/paths.js menghitung DIR_DATA dari $HOME saat modul diimpor,
// jadi HOME harus diganti SEBELUM impor dinamis — bukan sesudahnya.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const asli = process.env.HOME;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agentcfg-"));
const dirData = path.join(tmp, ".agent-termux");
await fs.mkdir(dirData, { recursive: true });
const berkas = path.join(dirData, "config.json");

process.env.HOME = tmp; // wajib sebelum impor di bawah
process.env.API_KEY = "sk-uji";
process.env.BASE_URL = "https://segar.example.com";

const { muatConfig, simpanConfig } = await import("../src/config/config.js");

let lulus = 0;
let gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = dapat === harus;
  ok ? lulus++ : gagal++;
  console.log(`${ok ? "OK   " : "GAGAL"} ${nama}: ${JSON.stringify(dapat)}` +
    (ok ? "" : ` (harusnya ${JSON.stringify(harus)})`));
};

// Kasus 1: presedensi baru — .env adalah baseline, config.json adalah override
// runtime. Untuk field yang disimpan (model), config.json yang menang.
// Untuk baseUrl yang TIDAK PERNAH disimpan, nilai basi di config.json diabaikan.
await fs.writeFile(berkas, JSON.stringify({ baseUrl: "https://basi.example.com", model: "glm-5.3" }));
const cfg = await muatConfig();
cek("baseUrl: env menang atas nilai basi", cfg.baseUrl, "https://segar.example.com");

// Kasus 2: simpanConfig tidak menulis baseUrl/apiKey, field lain aman
await simpanConfig(cfg);
const isi = JSON.parse(await fs.readFile(berkas, "utf-8"));
cek("baseUrl TIDAK tersimpan", "baseUrl" in isi, false);
cek("apiKey TIDAK tersimpan", "apiKey" in isi, false);
cek("model tetap tersimpan", isi.model, "glm-5.3");

// Kasus 3: tanpa env -> config.json jadi sumber
// cwd harus dipindah: muatConfig juga membaca ./.env, dan repo ini punya
// .env berisi BASE_URL yang akan menimpa config.json.
delete process.env.BASE_URL;
process.chdir(tmp);
delete process.env.BASE_URL;
await fs.writeFile(berkas, JSON.stringify({ baseUrl: "https://manual.example.com" }));
const cfg2 = await muatConfig();
cek("fallback ke config.json", cfg2.baseUrl, "https://manual.example.com");

// Kasus 4: sisa baseUrl lama ikut terbuang saat simpan ulang
await fs.writeFile(berkas, JSON.stringify({ baseUrl: "https://sisa.lama", model: "x" }));
await simpanConfig(await muatConfig());
const isi2 = JSON.parse(await fs.readFile(berkas, "utf-8"));
cek("sisa baseUrl lama terbuang", "baseUrl" in isi2, false);

process.env.HOME = asli;
await fs.rm(tmp, { recursive: true, force: true });
console.log(`\nHASIL: ${gagal === 0 ? "LULUS" : "GAGAL"} — lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);
