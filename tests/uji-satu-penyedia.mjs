// ============ UJI: SATU PENYEDIA (RE:LINK) — TANPA RESIDU PENYEDIA LAMA ============
// Memverifikasi tiga hal:
//  1. Tak ada jejak domain/nama penyedia lama di seluruh kode proyek.
//  2. Config tidak membawa field asing / apiKey dari disk; kredensial murni .env.
//  3. baseUrl bawaan = Re:Link, dan pembersihan otomatis menulis balik ke disk.
import fs from "fs/promises";
import path from "path";
import os from "os";

const AKAR = fileURLToPath_(new URL("..", import.meta.url));
function fileURLToPath_(u) { return decodeURIComponent(u.pathname); }

// Pola dibangun terpisah agar berkas uji ini sendiri tak ikut terdeteksi.
const TERLARANG = [new RegExp("clar" + "io", "i"), new RegExp("clar" + "iohub", "i")];
let lulus = 0, gagal = 0;
function cek(nama, syarat, info = "") {
  if (syarat) { lulus++; console.log(`  ✅ ${nama}`); }
  else { gagal++; console.log(`  ❌ ${nama}${info ? " → " + info : ""}`); }
}

// ---------- 1. Sapu kode proyek ----------
async function sapu(dir, keluar = []) {
  const ABAIKAN = new Set(["node_modules", ".git", "backups", "sessions", "sesi", "transkrip", "tmp-uji"]);
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (ABAIKAN.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await sapu(p, keluar);
    else if (/\.(mjs|js|json|md|sh|txt)$/.test(e.name)) {
      const isi = await fs.readFile(p, "utf-8").catch(() => "");
      for (const pola of TERLARANG) if (pola.test(isi)) { keluar.push(p); break; }
    }
  }
  return keluar;
}

console.log("=== 1. SAPU JEJAK PENYEDIA LAMA DI KODE ===");
const kotor = await sapu(AKAR);
cek("tidak ada berkas menyebut penyedia lama", kotor.length === 0, kotor.join(", "));

// Arsip sesi lama: hanya field setelan (bukan isi percakapan) yang boleh menyebut penyedia lama.
const DIR_SESI = path.join(os.homedir(), ".agent-termux", "sesi");
const DIR_SESI2 = path.join(os.homedir(), ".agent-termux", "sessions");
async function sapuSetelanSesi() {
  const keluar = [];
  for (const dir of [DIR_SESI2, DIR_SESI]) {
    const daftar = await fs.readdir(dir).catch(() => null);
    if (!daftar) continue;
    for (const n of daftar) {
      if (!n.endsWith(".json")) continue;
      const p = path.join(dir, n);
      const d = JSON.parse(await fs.readFile(p, "utf-8").catch(() => "null"));
      if (!d) continue;
      const nilai = [d.model, d.modelCepat, d.modelCadangan, d.baseUrl, d.baseCadangan];
      if (Array.isArray(d.pesan)) for (const m of d.pesan) nilai.push(m.model);
      if (nilai.some((v) => typeof v === "string" && TERLARANG.some((r) => r.test(v)))) keluar.push(n);
    }
  }
  return keluar;
}
const sesiKotor = await sapuSetelanSesi();
cek("field setelan di arsip sesi bersih dari penyedia lama", sesiKotor.length === 0, sesiKotor.slice(0, 5).join(", "));

// ---------- 2. Pembersihan config ----------
console.log("\n=== 2. PEMBERSIHAN CONFIG DI DISK ===");
const { muatConfig, DEFAULT_CONFIG, BASE_UTAMA, BERKAS_CONFIG } = await import("../src/config/config.js");

cek("baseUrl bawaan mengarah ke Re:Link", DEFAULT_CONFIG.baseUrl === BASE_UTAMA, DEFAULT_CONFIG.baseUrl);
cek("apiKey tidak ikut tersimpan ke disk (FIELD_DISIMPAN)", true); // diuji nyata di bagian 3

const lama = await fs.readFile(BERKAS_CONFIG, "utf-8").catch(() => null);
try {
  // Tanam residu: apiKey mati + field asing + host lama
  await fs.writeFile(BERKAS_CONFIG, JSON.stringify({
    apiKey: "sk-MATI-jangan-dipakai-000",
    baseUrl: "https://api.penyedia-lama.example/v1",
    model: "penyedia-lama/model-x",
    fieldAsingTidakDikenal: 12345,
    suhu: 0.4,
  }, null, 2));

  const cfg = await muatConfig();
  cek("apiKey dari disk diabaikan", cfg.apiKey !== "sk-MATI-jangan-dipakai-000", String(cfg.apiKey).slice(0, 12));
  cek("baseUrl dari .env menang atas disk", cfg.baseUrl === BASE_UTAMA, cfg.baseUrl);
  cek("field asing tidak ikut termuat", !("fieldAsingTidakDikenal" in cfg));

  const disk = JSON.parse(await fs.readFile(BERKAS_CONFIG, "utf-8"));
  cek("disk ditulis balik TANPA apiKey", !("apiKey" in disk), JSON.stringify(Object.keys(disk).slice(0, 5)));
  cek("disk ditulis balik TANPA field asing", !("fieldAsingTidakDikenal" in disk));
  cek("setelan user yang sah tetap tersimpan", disk.suhu === 0.4, String(disk.suhu));
} finally {
  if (lama !== null) await fs.writeFile(BERKAS_CONFIG, lama);
}

// ---------- 3. simpanConfig tidak bocorkan kredensial ----------
console.log("\n=== 3. simpanConfig TIDAK MENULIS KREDENSIAL ===");
const { simpanConfig } = await import("../src/config/config.js");
const lama2 = await fs.readFile(BERKAS_CONFIG, "utf-8").catch(() => null);
try {
  await simpanConfig({ ...DEFAULT_CONFIG, apiKey: "sk-RAHASIA-harusnya-tidak-tertulis", suhu: 0.9 });
  const mentah = await fs.readFile(BERKAS_CONFIG, "utf-8");
  cek("apiKey tidak ada di berkas", !/sk-RAHASIA/.test(mentah));
  cek("setelan lain tetap tertulis", JSON.parse(mentah).suhu === 0.9);
} finally {
  if (lama2 !== null) await fs.writeFile(BERKAS_CONFIG, lama2);
}

console.log(`\n${gagal === 0 ? "LULUS ✓" : "GAGAL ✗"}  ${lulus} lulus / ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
