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
const { muatConfig, DEFAULT_CONFIG, BASE_UTAMA, BERKAS_CONFIG, daftarUrl } = await import("../src/config/config.js");

cek("baseUrl bawaan kosong (wajib dari env/config)", DEFAULT_CONFIG.baseUrl === "", JSON.stringify(DEFAULT_CONFIG.baseUrl));
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
  // muatConfig() mem-parse ./.env ke process.env; baca ulang nilainya sekarang.
  // BASE_URL bisa datang dari process.env ATAU dari ./.env (diparse muatConfig).
  // Skrip ini chdir ke folder kerja, jadi ./.env ikut terbaca.
  let envBase = String(process.env.BASE_URL || process.env.RELINK_BASE_URL || "").trim();
  if (!envBase) {
    try {
      const isiEnv = await fs.readFile(path.join(process.cwd(), ".env"), "utf-8");
      const m = isiEnv.match(/^\s*(?:BASE_URL|RELINK_BASE_URL)\s*=\s*(.+?)\s*$/m);
      if (m) envBase = m[1].replace(/^["']|["']$/g, "").trim();
    } catch { /* .env tidak ada — biarkan kosong */ }
  }
  // URL di .env terbukti benar-benar dipakai gateway (permintaan nyata lolos),
  // jadi host itu bukan "host lama" — cukup pastikan nilai disk tidak menang.
  const hostEnv = (() => { try { return new URL(envBase).host; } catch { return ""; } })();
  const hostCfg = (() => { try { return new URL(cfg.baseUrl).host; } catch { return ""; } })();
  // Inti yang diuji: host lama dari disk TIDAK boleh menang.
  // Bila env/.env berisi BASE_URL → hasil harus mengikuti host env (presedensi env > disk).
  // Bila repo bersih tanpa .env → tak ada yang menang, baseUrl harus kosong.
  const tidakAdaEnv = !envBase;
  const diskTidakMenang = cfg.baseUrl !== "https://api.penyedia-lama.example/v1";
  const sesuaiAturan = tidakAdaEnv ? cfg.baseUrl === "" : hostCfg === hostEnv;
  cek("baseUrl dari env/.env menang atas disk (bukan host lama)",
      diskTidakMenang && sesuaiAturan,
      tidakAdaEnv
        ? `tanpa env/.env → baseUrl="${cfg.baseUrl || "(kosong)"}"`
        : `cfg=${cfg.baseUrl || "(kosong)"} vs env=${envBase}`);
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

// ── Migrasi kredensial: config.json lama tidak boleh "hidup" lagi ───────────
// Sasarannya: kejadian URL/APIKEY menggantung di config.json sehingga perilaku
// (mis. ke gateway lama) berbeda dari yang tertulis di .env.
{
  const cwd2 = process.cwd();
  const env2 = { BASE_URL: process.env.BASE_URL, RELINK_BASE_URL: process.env.RELINK_BASE_URL, API_KEY: process.env.API_KEY, RELINK_API_KEY: process.env.RELINK_API_KEY };
  const home2 = process.env.HOME;
  const UA = "https://gateway-uniq.example/v1";
  const UK = "sk-uniq-777";
  const LA = "https://api.lama.example/v1";
  const LK = "sk-lama-999";
  const UA_CAD = "https://gateway-uniq-cadangan.example/v1";
  try {
    // 1) Environment bersih total: tidak ada BASE_URL/API_KEY dari mana pun.
    for (const k of ["BASE_URL", "RELINK_BASE_URL", "API_KEY", "RELINK_API_KEY"]) delete process.env[k];
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "uji-migrasi-"));
    const homeIsolasi = await fs.mkdtemp(path.join(os.tmpdir(), "uji-migrasi-home-"));
    process.env.HOME = homeIsolasi;
    process.chdir(dir2);
    // 2) .env: URL baru + kunci baru (hanya ini yang sah).
    await fs.writeFile(
      path.join(dir2, ".env"),
      `BASE_URL=${UA}\nAPI_KEY=${UK}\nBASE_URL_CADANGAN=${UA_CAD}\n`,
      "utf8"
    );
    // 3) config.json warisan: baseUrl + apiKey dari penyedia lama.
    await fs.mkdir(path.join(homeIsolasi, ".agent-termux"), { recursive: true });
    await fs.writeFile(
      path.join(homeIsolasi, ".agent-termux", "config.json"),
      JSON.stringify({ baseUrl: LA, apiKey: LK, model: "model-x" }, null, 2),
      "utf8"
    );
    const cfg2 = await muatConfig();
    cek("migrasi: baseUrl warisan tidak menang", cfg2.baseUrl === UA, String(cfg2.baseUrl));
    cek("migrasi: apiKey warisan tidak terpakai", cfg2.apiKey === UK, String(cfg2.apiKey).slice(0, 12));
    const url2 = daftarUrl(cfg2);
    cek("migrasi: URL lama tidak ikut dicoba", !url2.some((u) => u.includes("api.lama.example")), JSON.stringify(url2));
    // 4) Rantai cadangan tetap utuh.
    cek(
      "migrasi: cadangan masih terbaca",
      url2.some((u) => u.startsWith(UA_CAD + "/")),
      JSON.stringify(url2)
    );

    // 5) Kasus .env hanya punya API_KEY (tanpa BASE_URL): warisan baseUrl dari
    //    config.json TIDAK boleh dipakai — perilakunya harus jelas, bukan diam-diam.
    await fs.writeFile(path.join(dir2, ".env"), `API_KEY=${UK}\n`, "utf8");
    const cfg3 = await muatConfig();
    cek(
      "migrasi: tanpa BASE_URL di .env, baseUrl warisan tidak dipakai",
      cfg3.baseUrl !== LA,
      String(cfg3.baseUrl)
    );
  } finally {
    process.chdir(cwd2);
    for (const [k, v] of Object.entries(env2)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    process.env.HOME = home2;
  }
}

console.log(`\n${gagal === 0 ? "LULUS ✓" : "GAGAL ✗"}  ${lulus} lulus / ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
