// ============ MEMORI JANGKA PANJANG (fakta tentang user & proyek) ============
import fs from "fs/promises";
import path from "path";
import { DIR_DATA, pastikanDir } from "../paths.js";

export const BERKAS_MEMORI = path.join(DIR_DATA, "memory.md");

// Bagian memori yang dikenal tool `ingat` (internal).
const BAGIAN_MEMORI = ["Tentang User", "Proyek & Lingkungan", "Fakta Penting", "Catatan Terakhir"];

export const KERANGKA_MEMORI = `# Memori Agent

## Tentang User
_(nama, preferensi, gaya bahasa, pekerjaan)_

## Proyek & Lingkungan
_(device, Termux, folder kerja, stack, paket terpasang)_

## Fakta Penting
_(keputusan, aturan khusus, jadwal)_

## Catatan Terakhir
_(hal yang sedang dikerjakan)_
`;

/** Muat memori; buat kerangka bila belum ada. */
export async function muatMemori() {
  await pastikanDir();
  try {
    return await fs.readFile(BERKAS_MEMORI, "utf-8");
  } catch {
    await fs.writeFile(BERKAS_MEMORI, KERANGKA_MEMORI);
    return KERANGKA_MEMORI;
  }
}

export async function simpanMemori(isi) {
  await pastikanDir();
  await fs.writeFile(BERKAS_MEMORI, isi);
}

/**
 * Tambahkan satu fakta ke bagian tertentu (satu-satunya implementasi;
 * dipakai oleh tool `ingat` maupun pemanggil lain).
 */
export async function tambahMemori(fakta, bagian = "Fakta Penting") {
  const memori = await muatMemori();
  const judul = BAGIAN_MEMORI.includes(bagian) ? bagian : "Fakta Penting";
  const cap = `## ${judul}`;
  const catatan = `- [${new Date().toISOString().slice(0, 10)}] ${String(fakta).trim()}`;

  const idx = memori.indexOf(cap);
  let baru;

  if (idx === -1) {
    // bagian baru → tambahkan di akhir
    baru = `${memori.trimEnd()}\n\n${cap}\n${catatan}\n`;
  } else {
    // sisipkan tepat sebelum header "## " berikutnya (atau di akhir file)
    const setelah = memori.indexOf("\n## ", idx + cap.length);
    if (setelah === -1) baru = `${memori.trimEnd()}\n${catatan}\n`;
    else baru = `${memori.slice(0, setelah).trimEnd()}\n${catatan}\n\n${memori.slice(setelah + 1)}`;
  }

  await simpanMemori(baru);
  return baru;
}

/** Buang seluruh isi memori (kembalikan kerangka kosong). */
export async function hapusMemori() {
  await simpanMemori(KERANGKA_MEMORI);
  return KERANGKA_MEMORI;
}

/** True bila memori masih kerangka kosong (tidak ada fakta nyata). */
export function memoriKosong(memori) {
  const baris = String(memori || "")
    .split("\n")
    .map((b) => b.trim())
    .filter(
      (b) =>
        b &&
        !b.startsWith("#") &&
        // placeholder kerangka: _(...)_
        !/^_\(.*\)_$/.test(b) &&
        // placeholder berbentuk daftar: - _(...)_  (dulu lolos → memori dianggap "berisi")
        !/^[-*]\s*_\(.*\)_$/.test(b)
    );
  return baris.length === 0;
}

/** Gabungkan memori ke system prompt (dipotong agar hemat konteks). */
export function sisipkanMemori(systemPrompt, memori, maks = 4000) {
  if (memoriKosong(memori)) return systemPrompt;
  const bersih = String(memori).trim();
  const potong = bersih.length > maks ? `${bersih.slice(0, maks)}\n…(memori dipotong)` : bersih;
  return `${systemPrompt}\n\n=== MEMORI JANGKA PANJANG ===\n${potong}\n=== AKHIR MEMORI ===\nGunakan memori ini bila relevan. Jangan mengarang fakta yang tidak ada di memori.`;
}
