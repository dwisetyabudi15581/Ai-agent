// ============ KONFIGURASI (env + .env + file config lokal) ============
import fs from "fs/promises";
import path from "path";
import { DIR_DATA, pastikanDir } from "../paths.js";

export const BERKAS_CONFIG = path.join(DIR_DATA, "config.json");

// Base URL resmi Re:Link Gateway (OpenAI-compatible)
export const BASE_UTAMA = "https://api.relink-gateway.biz.id/v1";

export const DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: BASE_UTAMA,
  // Re:Link hanya punya satu host; baseCadangan boleh diisi manual untuk
  // penyedia lain dan dipakai failover otomatis (lihat daftarUrl).
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
  maksPutaran: 20,
  maksTool: 50,
  verbose: false,
  // Router model otomatis: pilih model per giliran sesuai kesulitan tugas
  // (hemat kuota untuk obrolan ringan, model kuat untuk tugas berat).
  routingOtomatis: true,
  // True bila user memilih model secara eksplisit (/model atau --model):
  // router harus menyerah dan tidak menimpa pilihan itu.
  modelTerkunci: false,
};

// Field yang boleh disimpan ke config.json (apiKey dikecualikan: sumbernya .env)
const FIELD_DISIMPAN = Object.keys(DEFAULT_CONFIG).filter((k) => k !== "apiKey");

// Kredensial TIDAK PERNAH ditulis ke config.json — sumber tunggal adalah .env
// (RELINK_API_KEY). simpanConfig() memakai FIELD_DISIMPAN yang sudah membuang
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

  // Prioritas naik: default → config.json → .env → process.env.
  // (Bug lama: hanya RELINK_API_KEY yang dibaca dari process.env —
  // RELINK_BASE_URL/MODEL* diabaikan bila di-export langsung.)
  const ambilEnv = (nama) => process.env[nama] || envFile[nama] || "";
  const cfg = {
    ...DEFAULT_CONFIG,
    ...dariFile,
    ...(ambilEnv("RELINK_BASE_URL") ? { baseUrl: ambilEnv("RELINK_BASE_URL") } : {}),
    ...(ambilEnv("RELINK_MODEL") ? { model: ambilEnv("RELINK_MODEL") } : {}),
    ...(ambilEnv("RELINK_MODEL_CEPAT") ? { modelCepat: ambilEnv("RELINK_MODEL_CEPAT") } : {}),
    ...(ambilEnv("RELINK_MODEL_CADANGAN") ? { modelCadangan: ambilEnv("RELINK_MODEL_CADANGAN") } : {}),
    apiKey: ambilEnv("RELINK_API_KEY") || dariFile.apiKey || "",
  };

  // normalisasi nilai numerik
  cfg.maxTokens = keAngka(cfg.maxTokens, DEFAULT_CONFIG.maxTokens, 64, 131072);
  cfg.batasKonteks = keAngka(cfg.batasKonteks, DEFAULT_CONFIG.batasKonteks, 4000, 2000000);
  cfg.suhu = keAngka(cfg.suhu, DEFAULT_CONFIG.suhu, 0, 2);
  cfg.maksPutaran = keAngka(cfg.maksPutaran, DEFAULT_CONFIG.maksPutaran, 1, 200);
  cfg.maksTool = keAngka(cfg.maksTool, DEFAULT_CONFIG.maksTool, 1, 500);
  cfg.streamDefault = cfg.streamDefault !== false;
  cfg.autoCompact = cfg.autoCompact !== false;
  cfg.verbose = cfg.verbose === true;
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
  const utama = (cfg.baseUrl || BASE_UTAMA).replace(/\/+$/, "");
  const cadangan = (cfg.baseCadangan || "").replace(/\/+$/, "");
  const urut = cadangan && cadangan !== utama
    ? (stream ? [utama, cadangan] : [cadangan, utama])
    : [utama];
  const sekarang = Date.now();
  const hidup = urut.filter((u) => {
    const t = hostBermasalah.get(u);
    return !t || sekarang - t > MASA_ISTIRAHAT;
  });
  // bila semua sedang "istirahat", tetap coba semua (jangan mati total)
  return [...new Set(hidup.length ? hidup : urut)].map((b) => `${b}/chat/completions`);
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
