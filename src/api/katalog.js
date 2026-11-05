// ============ KATALOG MODEL: LIVE ( /v1/models ) + PRESET + CACHE ============
//
// Tiga sumber digabung dengan prioritas:
//   1. KATALOG LIVE  — status aktif/nonaktif paling baru dari gateway.
//   2. PRESET        — multiplier, nama tampilan, vendor (tidak disediakan
//                      endpoint /v1/models; lihat api/preset-model.js).
//   3. CACHE DISK    — katalog live terakhir yang berhasil diambil (1 jam).
// Bila gateway tidak bisa dihubungi sama sekali, katalog jatuh ke preset
// (status aktif = snapshot) sehingga menu /model dan router tetap hidup.
import fs from "fs/promises";
import path from "path";
import { daftarUrl } from "../config/config.js";
import { DIR_DATA } from "../paths.js";
import { PRESET_RELINK, TANGGAL_PRESET, cariPreset } from "./preset-model.js";

const BERKAS_CACHE_KATALOG = path.join(DIR_DATA, "cache-model.json");
const UMUR_CACHE = 60 * 60 * 1000; // 1 jam
const FORMAT_CACHE = 3; // naikkan bila bentuk data berubah → cache lama diabaikan

let cacheKatalog = { waktu: 0, data: null }; // data = daftar LENGKAP (aktif + nonaktif)
let janjiKatalog = null; // dedup: permintaan paralel berbagi satu fetch

// ---------- Normalisasi ----------
/**
 * Satu baris katalog live + preset gabung jadi bentuk baku.
 * `kapabilitas` dibiarkan null bila gateway tidak mendeklarasikannya —
 * router memakai null sebagai "tidak diketahui → asumsi sanggup tool-calling",
 * bukan "tidak punya tools" (asumsi lama membuat router tidak pernah
 * memilih model apa pun di Re:Link).
 * @param {object} m          baris katalog (live atau preset)
 * @param {boolean} [preset]  true bila baris berasal dari fallback preset
 */
function normalisasi(m, preset = false) {
  const p = cariPreset(m.id);
  const vision = m.vision === true || p?.vision === true;
  const hargaInput = m.pricing?.input_per_million ?? p?.hargaInput ?? 0;
  const hargaOutput = m.pricing?.output_per_million ?? p?.hargaOutput ?? 0;
  return {
    id: m.id,
    nama: m.name || p?.nama || m.id,
    pemilik: m.owned_by || p?.vendor || "relink",
    vendor: p?.vendor || m.owned_by || "relink",
    konteks: m.context_length || m.max_context || 0, // 0 = tidak dipublikasikan
    outputMaks: m.max_output_tokens || m.max_tokens || 0,
    // null = gateway tidak mendeklarasikan kapabilitas
    kapabilitas: Array.isArray(m.capabilities) ? m.capabilities : null,
    vision,
    harga: { input: Number(hargaInput) || 0, output: Number(hargaOutput) || 0 },
    // multiplier Re:Link = pengali token terhadap kuota; 1 = 1:1.
    multiplier: m.multiplier ?? p?.multiplier ?? null,
    aktif: m.available !== false && m.enabled !== false,
    dariPreset: preset, // penyanda baris fallback offline
  };
}

/** Kapabilitas untuk DITAMPILKAN (null → tebakan chat/vision). */
export function kapabilitasTampil(m) {
  if (Array.isArray(m.kapabilitas)) return m.kapabilitas;
  return m.vision ? ["chat", "vision"] : ["chat"];
}

/** Preset sebagai katalog bentuk-baku (fallback offline). */
function katalogPreset() {
  return PRESET_RELINK.map((p) => normalisasi({
    id: p.id, vision: p.vision, enabled: p.aktif, available: p.aktif,
  }, true));
}

// ---------- Cache disk ----------
async function bacaCacheDisk() {
  try {
    const j = JSON.parse(await fs.readFile(BERKAS_CACHE_KATALOG, "utf-8"));
    if (j?.format === FORMAT_CACHE && Array.isArray(j?.data) && j.data.length) return j;
  } catch { /* belum ada / format lama */ }
  return null;
}

async function tulisCacheDisk(waktu, data) {
  try {
    await fs.mkdir(DIR_DATA, { recursive: true });
    await fs.writeFile(BERKAS_CACHE_KATALOG, JSON.stringify({ waktu, data, format: FORMAT_CACHE }));
  } catch { /* cache gagal disimpan tidak fatal */ }
}

// ---------- Pengambil ----------
/**
 * Ambil katalog model lengkap (aktif + nonaktif).
 * @param {object} cfg
 * @param {{paksa?: boolean}} opsi  paksa=true mengabaikan cache
 * @returns {Promise<Array>} daftar model bentuk-baku
 */
export async function ambilKatalogLengkap(cfg, opsi = {}) {
  const sekarang = Date.now();

  // 1) cache memori
  if (!opsi.paksa && cacheKatalog.data && sekarang - cacheKatalog.waktu < UMUR_CACHE) {
    return cacheKatalog.data;
  }

  // 2) cache disk
  if (!opsi.paksa && !cacheKatalog.data) {
    const disk = await bacaCacheDisk();
    if (disk && sekarang - disk.waktu < UMUR_CACHE) {
      cacheKatalog = { waktu: disk.waktu, data: disk.data };
      return disk.data;
    }
  }

  // 3) dedup request paralel
  if (janjiKatalog) return janjiKatalog;

  janjiKatalog = (async () => {
    const urls = [...new Set(
      [...daftarUrl(cfg, { stream: false }), ...daftarUrl(cfg, { stream: true })]
        .map((u) => u.replace(/\/chat\/completions$/, "/models"))
    )];
    let galat;
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        });
        if (!res.ok) { galat = new Error(`HTTP ${res.status}`); continue; }
        const json = await res.json();
        if (!json.data?.length) { galat = new Error("Katalog kosong"); continue; }
        const data = json.data.map(normalisasi);
        cacheKatalog = { waktu: Date.now(), data };
        await tulisCacheDisk(cacheKatalog.waktu, data);
        return data;
      } catch (e) { galat = e; }
    }
    // gagal total → cache kedaluwarsa bila ada (lebih baru dari preset)
    if (cacheKatalog.data) return cacheKatalog.data;
    const disk = await bacaCacheDisk();
    if (disk) { cacheKatalog = { waktu: disk.waktu, data: disk.data }; return disk.data; }
    // terakhir: preset snapshot (offline / gateway mati)
    return katalogPreset();
  })();

  try {
    return await janjiKatalog;
  } finally {
    janjiKatalog = null;
  }
}

/**
 * Katalog model AKTIF saja — dipakai router & pilihan default /model.
 * (Model nonaktif tidak bisa dipanggil, jangan ditawarkan untuk dipilih.)
 */
export async function ambilKatalog(cfg, opsi = {}) {
  const semua = await ambilKatalogLengkap(cfg, opsi);
  const aktif = semua.filter((m) => m.aktif !== false);
  return aktif.length ? aktif : semua;
}

/** Info snapshot preset untuk ditampilkan di UI. */
export function infoPreset() {
  return { tanggal: TANGGAL_PRESET, jumlah: PRESET_RELINK.length };
}
