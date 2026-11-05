// ============ KELUAR AMAN: SIGINT/SIGTERM selalu menyimpan sesi ============
// Masalah lama: Ctrl+C memanggil process.exit() tanpa simpanSesi → riwayat
// sejak giliran terakhir hilang. Modul ini jadi satu pintu keluar yang:
//   1. menyimpan sesi (idempoten; Ctrl+C berulang tidak menimpa separuh),
//   2. mengarsipkan transkrip (opsional),
//   3. punya jalur sinkron sebagai jaring pengaman di event "exit",
//   4. tidak pernah menggantung: simpan async dibatasi 4 detik.
import fs from "fs";
import path from "path";
import { simpanSesi } from "../core/sesi.js";
import { DIR_SESI } from "../paths.js";
import { C, tulis } from "./util.js";

// Batas cadangan bila simpanSesi async menggantung (disk lambat / proses sibuk).
const BATAS_SIMPAN_MS = 4000;

/** Jalankan janji dengan batas waktu; lewat batas → anggap gagal (tanpa lempar). */
function denganBatas(janji, ms) {
  let t;
  const penjaga = new Promise((selesai) => { t = setTimeout(() => selesai("__TIMEOUT__"), ms); });
  penjaga.unref?.();
  return Promise.race([Promise.resolve(janji), penjaga]).finally(() => clearTimeout(t));
}

let sesiAktif = null;
let arsip = null;
let janjiSelesai = null;
let sedangKeluar = false;
let handlerTerpasang = false;

/** Simpan sinkron (dipakai saat async sudah tidak mungkin jalan lagi). */
function simpanSesiSinkron(sesi) {
  if (!sesi?.id || !Array.isArray(sesi.messages)) return false;
  try {
    fs.mkdirSync(DIR_SESI, { recursive: true });
    const salinan = { ...sesi, diperbarui: new Date().toISOString() };
    fs.writeFileSync(path.join(DIR_SESI, `${sesi.id}.json`), JSON.stringify(salinan, null, 2));
    return true;
  } catch { return false; }
}

/**
 * Daftarkan sesi & (opsional) fungsi arsip transkrip yang dipakai saat keluar.
 * @param {object} sesi
 * @param {(s: object) => Promise<any>} [fungsiArsip]
 */
export function siapkanKeluar(sesi, fungsiArsip = null) {
  sesiAktif = sesi;
  arsip = fungsiArsip;
  if (handlerTerpasang) return;
  handlerTerpasang = true;

  process.on("SIGINT", () => keluarAman("Ctrl+C", 130));
  process.on("SIGTERM", () => keluarAman("SIGTERM", 143));

  // Jaring pengaman: bila proses berakhir lewat jalur lain (uncaught/exit),
  // simpan sinkron — saat "exit" async sudah tidak dijalankan lagi.
  process.on("exit", (kode) => {
    if (sedangKeluar || !sesiAktif) return;
    if (simpanSesiSinkron(sesiAktif) && process.stdout.isTTY) {
      tulis(`${C.gray}\n💾 Sesi ${sesiAktif.id} tersimpan (exit ${kode}).${C.reset}`);
    }
    sesiAktif = null;
  });
}

/**
 * Simpan sekali saja lalu keluar. Panggilan berulang hanya menunggu proses
 * yang sama (tidak memicu penulisan kedua yang bisa merusak data).
 */
export function keluarAman(sebab = "quit", kode = 0) {
  if (janjiSelesai) return janjiSelesai;

  sedangKeluar = true;
  janjiSelesai = (async () => {
    let id = sesiAktif?.id ?? "-";
    let pesan = `Sesi disimpan sebagai ${id}`;

    try {
      if (sesiAktif?.messages?.length) {
        // Jangan menunggu tanpa batas: kalau menggantung, langsung ke jalur sinkron.
        const hasil = await denganBatas(simpanSesi(sesiAktif), BATAS_SIMPAN_MS);
        if (hasil === "__TIMEOUT__") throw new Error(`lewat ${BATAS_SIMPAN_MS} ms`);

        // Arsip transkrip bersifat opsional dan TIDAK boleh menahan keluar.
        if (arsip) denganBatas(Promise.resolve().then(() => arsip(sesiAktif)), BATAS_SIMPAN_MS)
          .catch(() => { /* arsip tidak fatal */ });
      }
    } catch (e) {
      if (simpanSesiSinkron(sesiAktif)) pesan = `Sesi disimpan sebagai ${id} (cara sinkron: ${e.message})`;
      else pesan = `Sesi ${id} GAGAL disimpan: ${e.message}`;
    } finally {
      sesiAktif = null;
      const ikon = sebab === "quit" ? "👋" : "💾";
      tulis(`\n${C.gray}${ikon} ${pesan} (${sebab}). Sampai jumpa!${C.reset}\n`);
      process.exit(kode);
    }
  })();
  return janjiSelesai;
}
