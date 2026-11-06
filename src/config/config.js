// ============ KONFIGURASI (env + .env + file config lokal) ============
import fs from "fs/promises";
import path from "path";
import { DIR_DATA, pastikanDir } from "../paths.js";

export const BERKAS_CONFIG = path.join(DIR_DATA, "config.json");

// Base URL default gateway (OpenAI-compatible).
// Sengaja KOSONG: tidak ada host yang dibakar di kode. Nilai wajib datang
// dari .env (BASE_URL) atau config.json (baseUrl).
export const BASE_UTAMA = "";

export const DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: BASE_UTAMA,
  // baseCadangan dipakai untuk failover otomatis bila host utama gagal
  // (lihat daftarUrl).
  baseCadangan: "",
  model: "deepseek-v4-pro",
  modelCepat: "deepseek-v4.1-flash",
  modelCadangan: "glm-5.3-flash",
  maxTokens: 16384,
  suhu: 0.7,
  namaAgent: "Agent",
  namaUser: "Anda",
  streamDefault: true,
  autoCompact: true,
  batasKonteks: 60000,
  // ---------- PENGHEMAT TOKEN ----------
  // Batas keluaran tool (karakter) yang dikirim balik ke model sebagai
  // pesan role:tool. Keluaran tool TINGGAL DI RIWAYAT selamanya (dikirim
  // ulang di setiap putaran), jadi satu `cat` file 40KB = 40KB × jumlah
  // putaran sisa. Output utuh tetap dilihat user di layar lewat `detail`;
  // yang dipotong hanya versi yang masuk konteks model.
  // 0 = tanpa batas (perilaku lama).
  batasOutputTool: 8000,
  // Riwayat yang disisakan saat meringkas. Terlalu besar = ringkasan tak
  // berguna; terlalu kecil = konteks tugas hilang. 6 = titik seimbang.
  simpanRiwayat: 6,
  // Berapa pesan tool TERAKHIR yang isinya dibiarkan UTUH saat riwayat
  // dikirim ke model. Sisanya (tool-tool yang sudah "basi") dipadatkan jadi
  // satu baris ringkas — di sinilah penghematan token terbesar terjadi.
  // 2 = tool terakhir + satu sebelumnya utuh (hasil terakhir sedang dipakai
  // model untuk memutuskan langkah berikutnya). 0 = padatkan semua tool.
  // Catatan: dulu bernama `padatkanToolLama` dengan arti TERBALIK
  // ("pertahankan N tool terakhir") sehingga dengan 5 tool dalam satu sesi
  // tidak ada yang pernah dipadatkan → penghematan 0%. Nama lama masih
  // diterima sebagai alias, tapi jangan dipakai di kode baru.
  jagaToolTerakhir: 2,
  // Zona aman di ujung riwayat: sekian pesan terakhir TIDAK pernah dipadatkan
  // apa pun perannya. Ini yang menjaga putaran tool-calling yang sedang
  // berjalan tetap utuh (model masih butuh isi hasil terakhir untuk
  // memutuskan langkah berikutnya).
  jagaTerakhir: 4,
  // Batas per giliran. Default 0 = TANPA BATAS: agent baru berhenti saat
  // tugasnya selesai atau saat ia menyatakan selesai — tidak dipotong jumlah
  // putaran. Isi angka > 0 bila ingin memasang rem sendiri lewat config.json,
  // /putaran <n>, atau CLI --putaran <n>.
  maksPutaran: 0,
  maksTool: 0,
  verbose: false,
  // Router model otomatis: pilih model per giliran sesuai kesulitan tugas
  // (hemat kuota untuk obrolan ringan, model kuat untuk tugas berat).
  routingOtomatis: true,
  // True bila user memilih model secara eksplisit (/model atau --model):
  // router harus menyerah dan tidak menimpa pilihan itu.
  modelTerkunci: false,
};

// Field yang boleh disimpan ke config.json.
// apiKey DAN baseUrl dikecualikan: keduanya kredensial/endpoint yang sumber
// tunggalnya .env (API_KEY, BASE_URL). Tanpa pengecualian ini,
// presedensi .env atas config.json jadi tidak konsisten — BASE_URL
// diabaikan saat simpanConfig() menuliskan URL lama dari memori ke disk.
const FIELD_DISIMPAN = Object.keys(DEFAULT_CONFIG).filter(
  (k) => k !== "apiKey" && k !== "baseUrl",
);

// Kredensial TIDAK PERNAH ditulis ke config.json — sumber tunggal adalah .env
// (API_KEY). simpanConfig() memakai FIELD_DISIMPAN yang sudah membuang
// apiKey, jadi kunci tidak pernah menetap di disk.

// ---------- Penanda host bermasalah ----------
const hostBermasalah = new Map();
const MASA_ISTIRAHAT = 5 * 60 * 1000;

/** Baca file .env sederhana (KEY=VALUE, komentar #) tanpa dependensi. */
async function bacaEnvFile(berkas) {
  const hasil = {};
  try {
    const isi = await fs.readFile(berkas, "utf-8");
    for (const baris of isi.split("\n")) {
      if (/^\s*#/.test(baris)) continue;
      const m = baris.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) hasil[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* tidak ada .env */ }
  return hasil;
}

function keAngka(nilai, bawaan, min, maks) {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(Math.max(n, min), maks);
}

/**
 * Batas yang mengenal nilai 0 sebagai "tanpa batas".
 * keAngka() biasa memaksa nilai masuk rentang [min, maks], sehingga 0 tidak
 * akan pernah lolos. Di sini 0 dilewatkan apa adanya dan pemakaiannya di
 * loop memakai Infinity (lihat core/agen.js).
 */
function keAngkaBebas(nilai, bawaan, maks) {
  const n = Number(nilai);
  if (!Number.isFinite(n) || n < 0) return bawaan;
  if (n === 0) return 0;
  return Math.min(n, maks);
}

/** Muat konfigurasi: default -> config.json -> .env -> process.env (prioritas naik). */
export async function muatConfig() {
  await pastikanDir();

  let dariFile = {};
  let perluSimpan = false;
  try {
    dariFile = JSON.parse(await fs.readFile(BERKAS_CONFIG, "utf-8")) || {};
  } catch { /* belum ada / rusak */ }

  // Bersihkan sisa field tak dikenal (mis. "apiKey" warisan versi lama yang
  // menang atas .env saat dibaca, atau kunci model tak ada di gateway).
  // Kredensial hanya boleh datang dari .env / process.env.
  if (Object.prototype.hasOwnProperty.call(dariFile, "apiKey")) {
    delete dariFile.apiKey;
    perluSimpan = true;
  }
  for (const k of Object.keys(dariFile)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) { delete dariFile[k]; perluSimpan = true; }
  }
  if (perluSimpan && Object.keys(dariFile).length) {
    // Tulis balik ke disk supaya residu tidak ikut terbaca lagi.
    // Kegagalan tulis tidak boleh mematikan start: cukup dicatat di verbose.
    try { await fs.writeFile(BERKAS_CONFIG, JSON.stringify(dariFile, null, 2)); }
    catch (e) { if (process.env.AGENT_VERBOSE) console.error("[config] gagal simpan pembersihan:", e.message); }
  }

  // .env dicari di DIR_DATA lalu di cwd
  const envFile = {
    ...(await bacaEnvFile(path.join(DIR_DATA, ".env"))),
    ...(await bacaEnvFile(path.join(process.cwd(), ".env"))),
  };

  // Prioritas naik: default → .env/process.env → config.json.
  // .env adalah SUMBER NILAI AWAL (baseline), config.json adalah OVERRIDE
  // RUNTIME. Urutan ini penting: perintah seperti `/model`, `/suhu`, `/router`
  // menulis ke config.json, jadi config.json HARUS menang atas .env — kalau
  // tidak, setiap perubahan runtime diam-diam tidak berefek.
  // process.env menang atas isi .env (agar `MODEL=x npm start` bekerja).
  //
  // Kompatibilitas nama variabel:
  //   - Nama generik (BASE_URL, API_KEY, MODEL, ...) adalah nama RESMI yang
  //     didokumentasikan di .env.example dan dipakai semua instalasi baru.
  //   - Nama lama berawalan RELINK_ tetap diterima sebagai alias agar setup
  //     lama tidak rusak saat upgrade. Nama generik selalu menang.
  //     Alias ini bisa dihapus pada rilis mayor berikutnya.
  const awalanLama = "RELINK_";
  const bacaMentah = (nama) => process.env[nama] || envFile[nama] || "";
  const ambilEnv = (nama) => {
    const utama = bacaMentah(nama);
    if (utama !== "") return utama;
    // fallback ke alias lama: BASE_URL -> RELINK_BASE_URL
    return bacaMentah(awalanLama + nama);
  };
  const envNum = (nama) => {
    const v = ambilEnv(nama);
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  // Bool dari env hanya dianggap ada bila ditulis eksplisit, supaya nilai
  // default/`false` di config.json tidak tertimpa diam-diam.
  const envBool = (nama) => {
    const v = ambilEnv(nama).toLowerCase();
    if (["1", "true", "ya", "on"].includes(v)) return true;
    if (["0", "false", "tidak", "off"].includes(v)) return false;
    return undefined;
  };
  const envAngkaBebas = (nama) => {
    const v = ambilEnv(nama);
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const cfg = {
    ...DEFAULT_CONFIG,
    // baseUrl: .env menang; config.json hanya dipakai bila .env tidak mengisinya
    // (jalur pengisian manual lama). Keduanya tidak pernah ditulis ulang.
    ...(ambilEnv("BASE_URL")
      ? { baseUrl: ambilEnv("BASE_URL") }
      : dariFile.baseUrl
        ? { baseUrl: dariFile.baseUrl }
        : { baseUrl: "" }),
    ...(ambilEnv("MODEL") ? { model: ambilEnv("MODEL") } : {}),
    ...(ambilEnv("MODEL_CEPAT") ? { modelCepat: ambilEnv("MODEL_CEPAT") } : {}),
    ...(ambilEnv("MODEL_CADANGAN") ? { modelCadangan: ambilEnv("MODEL_CADANGAN") } : {}),
    ...(ambilEnv("BASE_CADANGAN") ? { baseCadangan: ambilEnv("BASE_CADANGAN") } : {}),
    ...(ambilEnv("NAMA_AGENT") ? { namaAgent: ambilEnv("NAMA_AGENT") } : {}),
    ...(envNum("MAX_TOKENS") !== undefined ? { maxTokens: envNum("MAX_TOKENS") } : {}),
    ...(envNum("SUHU") !== undefined ? { suhu: envNum("SUHU") } : {}),
    ...(envAngkaBebas("MAKS_PUTARAN") !== undefined ? { maksPutaran: envAngkaBebas("MAKS_PUTARAN") } : {}),
    ...(envAngkaBebas("MAKS_TOOL") !== undefined ? { maksTool: envAngkaBebas("MAKS_TOOL") } : {}),
    ...(envBool("VERBOSE") !== undefined ? { verbose: envBool("VERBOSE") } : {}),
    ...(envBool("ROUTING_OTOMATIS") !== undefined ? { routingOtomatis: envBool("ROUTING_OTOMATIS") } : {}),
    ...(envBool("MODEL_TERKUNCI") !== undefined ? { modelTerkunci: envBool("MODEL_TERKUNCI") } : {}),
    ...(envBool("STREAM") !== undefined ? { streamDefault: envBool("STREAM") } : {}),
    ...(envBool("AUTO_COMPACT") !== undefined ? { autoCompact: envBool("AUTO_COMPACT") } : {}),
    // config.json menang atas env: override runtime tidak boleh hilang.
    // Kecuali baseUrl/apiKey: keduanya BUKAN field tersimpan (FIELD_DISIMPAN
    // mengecualikannya), jadi bila ada nilainya di config.json itu sisa basi
    // dari versi lama dan tidak boleh mengalahkan .env.
    ...(() => {
      const bersih = { ...dariFile };
      delete bersih.baseUrl;
      delete bersih.apiKey;
      return bersih;
    })(),
    apiKey: ambilEnv("API_KEY") || dariFile.apiKey || "",
  };

  // normalisasi nilai numerik
  cfg.maxTokens = keAngka(cfg.maxTokens, DEFAULT_CONFIG.maxTokens, 64, 131072);
  cfg.batasKonteks = keAngka(cfg.batasKonteks, DEFAULT_CONFIG.batasKonteks, 4000, 2000000);
  cfg.suhu = keAngka(cfg.suhu, DEFAULT_CONFIG.suhu, 0, 2);
  // 0 = tanpa batas; selain itu dibatasi 1..10000 (rem pengaman agar tidak
  // ada loop abadi karena salah ketik, mis. /putaran 999999).
  cfg.maksPutaran = keAngkaBebas(cfg.maksPutaran, DEFAULT_CONFIG.maksPutaran, 10000);
  cfg.maksTool = keAngkaBebas(cfg.maksTool, DEFAULT_CONFIG.maksTool, 10000);
  cfg.streamDefault = cfg.streamDefault !== false;
  cfg.autoCompact = cfg.autoCompact !== false;
  cfg.verbose = cfg.verbose === true;
  cfg.batasOutputTool = keAngkaBebas(cfg.batasOutputTool, DEFAULT_CONFIG.batasOutputTool, 100000);
  cfg.simpanRiwayat = keAngka(cfg.simpanRiwayat, DEFAULT_CONFIG.simpanRiwayat, 2, 40);
  // Jumlah tool terakhir yang isinya dibiarkan utuh. 0 = padatkan semuanya.
  // Batas atas 100: cukup besar untuk "praktis tidak memadatkan", tapi tidak
  // sampai membuat riwayat membengkak tak terkendali karena salah ketik.
  cfg.jagaToolTerakhir = keAngka(cfg.jagaToolTerakhir, DEFAULT_CONFIG.jagaToolTerakhir, 0, 100);
  // Zona aman ekor: min 1 (pesan terakhir yang sedang diproses JANGAN pernah
  // dipadatkan — itu pesan user/assistant aktif), maks 200.
  cfg.jagaTerakhir = keAngka(cfg.jagaTerakhir, DEFAULT_CONFIG.jagaTerakhir, 1, 200);
  // Kompatibilitas: config.json lama menyimpan `padatkanToolLama` dengan arti
  // terbalik. Bila user belum punya `jagaToolTerakhir`, pakai nilai aliasnya
  // supaya tidak diam-diam kembali ke perilaku 0%. Field lama tidak lagi
  // ditulis ke disk (tidak ada di DEFAULT_CONFIG).
  if (dariFile.jagaToolTerakhir === undefined && dariFile.padatkanToolLama !== undefined) {
    cfg.jagaToolTerakhir = keAngka(dariFile.padatkanToolLama, DEFAULT_CONFIG.jagaToolTerakhir, 0, 100);
  }
  cfg.routingOtomatis = cfg.routingOtomatis !== false;
  cfg.modelTerkunci = cfg.modelTerkunci === true;

  return cfg;
}

/** Simpan hanya field yang dikenal (tanpa key sementara). */
export async function simpanConfig(cfg) {
  await pastikanDir();
  const bersih = {};
  for (const k of FIELD_DISIMPAN) if (cfg[k] !== undefined) bersih[k] = cfg[k];
  await fs.writeFile(BERKAS_CONFIG, JSON.stringify(bersih, null, 2));
}

/**
 * Urutan URL untuk dicoba.
 * stream     : baseUrl -> baseCadangan
 * non-stream : baseCadangan -> baseUrl (host cadangan biasanya tanpa batas edge)
 * Bila baseCadangan kosong / sama dengan baseUrl, cukup satu host.
 */
export function daftarUrl(cfg, { stream = true } = {}) {
  const utama = (cfg.baseUrl || "").trim().replace(/\/+$/, "");
  const cadangan = (cfg.baseCadangan || "").replace(/\/+$/, "");
  const urut = cadangan && cadangan !== utama
    ? (stream ? [utama, cadangan] : [cadangan, utama])
    : [utama];
  const sekarang = Date.now();
  const terisi = urut.filter((u) => u.length > 0);
  if (!terisi.length) return [];
  const hidup = terisi.filter((u) => {
    const t = hostBermasalah.get(u);
    return !t || sekarang - t > MASA_ISTIRAHAT;
  });
  // bila semua sedang "istirahat", tetap coba semua (jangan mati total)
  return [...new Set(hidup.length ? hidup : terisi)].map((b) => `${b}/chat/completions`);
}

export function tandaiBermasalah(urlDasar) {
  hostBermasalah.set(urlDasar, Date.now());
}

/** Tandai host pulih (dipanggil saat request sukses). */
export function tandaiPulih(urlDasar) {
  hostBermasalah.delete(urlDasar);
}

export function dasarDari(urlPenuh) {
  return String(urlPenuh).replace(/\/(chat\/completions|models)$/, "");
}
