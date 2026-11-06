// ============ REGISTRY TOOL DINAMIS ============
//
// MASALAH YANG DISELESAIKAN
// Sebelum ini, daftar kemampuan agent hidup di dalam `switch` di tools.js.
// Menambah kemampuan = menyunting sumber kode, dan agent tidak bisa
// melakukannya sendiri. Akibatnya agent mentok pada 12 tool bawaan selamanya.
//
// SEKARANG: tool buatan agent disimpan sebagai BERKAS di
//   ~/.agent-termux/tools/<nama>.tool.js
// lalu dimuat otomatis saat start. Agent menulis berkas → tool langsung
// tersedia di giliran berikutnya. Tidak ada penyuntingan kode inti.
//
// KONTRAK BERKAS TOOL (satu berkas = satu tool):
//   export const meta = {
//     nama: "nama_tool",              // wajib, unik, huruf/angka/underscore
//     deskripsi: "...",               // wajib (dibaca model)
//     parameter: { type: "object", properties: {...}, required: [...] },
//     kategori: "umum",               // opsional, untuk /tools
//     buatan: "agent",                // ditandai otomatis bila dibuat via bikin_tool
//   };
//   export async function jalankan(args, ctx) { 
//     return { judul, detail, raw, ok };   // bentuk balikan sama dgn tool bawaan
//   }
//
// SAFETY
// Tool dinamis menjalankan kode NYATA di mesin user — itu memang tujuannya.
// Karena itu tiap berkas dijalankan di dalam `import()` terisolasi dengan
// penanganan galat yang rapi: tool rusak TIDAK boleh mematikan agent.
// Tool yang gagal dimuat hanya dicatat dan dilewati.

import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { DIR_DATA } from "../paths.js";

export const DIR_TOOL = path.join(DIR_DATA, "tools");

// ---------- State modul (cache) ----------
let cache = null;          // { waktu, tool: Array }
let janjiMuat = null;      // dedup pemuatan paralel
let galatMuat = [];        // berkas yang gagal dimuat (ditampilkan di /tools)

/** Pola nama tool yang sah: hindari path traversal & nama aneh. */
const NAMA_SAH = /^[a-z][a-z0-9_]{1,40}$/;

export function namaSah(nama) {
  return NAMA_SAH.test(String(nama || ""));
}

/**
 * Nama tool BAWAAN (dari tools.js). Diisi sekali oleh tools.js lewat
 * `setNamaBawaan()` saat modul dimuat.
 *
 * MENGAPA ADA DI SINI
 * Guard "tool dinamis tidak boleh menimpa tool bawaan" sebelumnya hanya
 * dipasang di tools.js (`bikin_tool` dan daftarToolsLengkap). Akibatnya
 * `simpanTool()` — yang juga dipanggil langsung oleh kode lain dan oleh
 * uji — TETAP menulis berkas shadow `~/.agent-termux/tools/baca_file.tool.js`
 * ke disk walau tool-nya ditolak. Berkas mati itu menumpuk, membuat
 * `lihat_tool` ambigu, dan mengotori folder tool.
 *
 * Guard di lapisan registry membuat SEMUA jalur (termasuk pemanggilan
 * langsung simpanTool) ikut aman — pertahanan tidak bergantung pada
 * disiplin pemanggil.
 */
let namaBawaan = new Set();

/** Dipanggil tools.js sekali saat modul dimuat untuk menyerahkan daftar nama inti. */
export function setNamaBawaan(daftar) {
  namaBawaan = new Set((daftar || []).filter(Boolean));
}

/** True bila `nama` adalah tool bawaan (tidak boleh dibuat/ditimpa). */
export function namaBawaanTool(nama) {
  return namaBawaan.has(String(nama || ""));
}

/** Path berkas tool untuk sebuah nama. */
export function berkasTool(nama) {
  return path.join(DIR_TOOL, `${nama}.tool.js`);
}

/**
 * Muat semua tool dari disk.
 *
 * Dipanggil ulang bila cache sudah basi (mtime folder berubah), sehingga
 * tool yang BARU dibuat agent langsung terpakai di giliran berikutnya
 * tanpa restart. Gagal membaca folder = bukan galat fatal (tool dinamis
 * memang opsional).
 *
 * @param {{paksa?: boolean}} opsi
 * @returns {Promise<Array>} daftar { meta, jalankan, berkas }
 */
export async function muatToolDinamis(opsi = {}) {
  if (!opsi.paksa && cache) return cache.tool;
  if (janjiMuat) return janjiMuat;

  janjiMuat = (async () => {
    const daftar = [];
    const galat = [];
    try {
      await fs.mkdir(DIR_TOOL, { recursive: true });
      const berkas = (await fs.readdir(DIR_TOOL)).filter((f) => f.endsWith(".tool.js"));
      for (const f of berkas) {
        const penuh = path.join(DIR_TOOL, f);
        try {
          // Cache-bust: berkas yang ditulis ulang harus memuat kode TERBARU,
          // bukan modul yang sudah di-cache Node dari impor sebelumnya.
          const stat = await fs.stat(penuh);
          const mod = await import(`${pathToFileURL(penuh).href}?v=${stat.mtimeMs}`);
          const meta = mod.meta || {};
          const jalankan = mod.jalankan || mod.default;
          if (!namaSah(meta.nama)) { galat.push(`${f}: meta.nama tidak sah ("${meta.nama}")`); continue; }
          if (namaBawaanTool(meta.nama)) {
            // Berkas shadow dari versi lama (dibuat sebelum guard registry ada).
            // Dibuang dari daftar SEKALIGUS dihapus dari disk supaya tidak
            // menumpuk dan tidak membingungkan `lihat_tool`.
            galat.push(`${f}: nama "${meta.nama}" bentrok dengan tool bawaan → berkas dihapus`);
            await fs.unlink(penuh).catch(() => {});
            continue;
          }
          if (typeof jalankan !== "function") { galat.push(`${f}: tidak ada fungsi jalankan(args, ctx)`); continue; }
          if (!meta.deskripsi) { galat.push(`${f}: meta.deskripsi kosong`); continue; }
          daftar.push({ meta, jalankan, berkas: penuh });
        } catch (e) {
          // Tool rusak tidak boleh menjatuhkan agent: catat, lewati.
          galat.push(`${f}: ${e.message}`);
        }
      }
    } catch (e) {
      galat.push(`folder ${DIR_TOOL}: ${e.message}`);
    }
    galatMuat = galat;
    cache = { waktu: Date.now(), tool: daftar };
    return daftar;
  })();

  try {
    return await janjiMuat;
  } finally {
    janjiMuat = null;
  }
}

/** Buang cache → pemuatan berikutnya membaca disk lagi (setelah bikin/hapus tool). */
export function segarkanCache() {
  cache = null;
}

/** Daftar galat pemuatan terakhir (untuk /tools). */
export function galatTool() {
  return [...galatMuat];
}

/**
 * Bentuk tool dinamis ke format function-calling OpenAI.
 * @param {{meta:object}} t
 */
export function keSkema(t) {
  const meta = t.meta || {};
  return {
    type: "function",
    function: {
      name: meta.nama,
      description: String(meta.deskripsi || "").slice(0, 1024),
      parameters: meta.parameter && typeof meta.parameter === "object"
        ? meta.parameter
        : { type: "object", properties: {} },
    },
  };
}

/**
 * Buat kerangka kode tool (yang ditulis agent ke disk).
 * Dikembalikan sebagai teks supaya bisa ditampilkan/diperiksa dulu.
 */
export function kerangkaTool({ nama, deskripsi, parameter = null, kode = null, kategori = "umum" }) {
  const par = parameter || { type: "object", properties: {}, required: [] };
  const isiJalankan = kode || [
    "  // args = argumen dari model, ctx = { cwd, home, eksekusi, cfg }",
    "  return {",
    "    judul: `Contoh → ${JSON.stringify(args)}`,",
    "    detail: \"ringkasan singkat untuk layar\",",
    "    raw: \"teks lengkap yang dibaca model\",",
    "    ok: true,",
    "  };",
  ].join("\n");

  return `// Tool dinamis buatan agent — ${new Date().toISOString()}
// Berkas ini dimuat otomatis oleh src/tools/registry.js
export const meta = {
  nama: ${JSON.stringify(nama)},
  deskripsi: ${JSON.stringify(deskripsi)},
  kategori: ${JSON.stringify(kategori)},
  buatan: "agent",
  parameter: ${JSON.stringify(par, null, 2)},
};

export async function jalankan(args = {}, ctx = {}) {
${isiJalankan}
}
`;
}

/**
 * Simpan tool baru ke disk, lalu segarkan cache.
 * Mengembalikan { ok, berkas, pesan }.
 */
export async function simpanTool({ nama, deskripsi, parameter, kode, kategori }) {
  if (!namaSah(nama)) {
    return { ok: false, pesan: `Nama tool tidak sah: "${nama}". Gunakan huruf kecil, angka, garis bawah (mis. cek_baterai).` };
  }
  if (namaBawaanTool(nama)) {
    return { ok: false, pesan: `"${nama}" adalah tool BAWAAN dan tidak boleh ditimpa. Pilih nama lain (mis. cek_${nama}).` };
  }
  if (!deskripsi || !String(deskripsi).trim()) {
    return { ok: false, pesan: "Deskripsi tool wajib diisi — model memakainya untuk memutuskan kapan tool dipakai." };
  }
  const isi = kerangkaTool({ nama, deskripsi, parameter, kode, kategori });
  await fs.mkdir(DIR_TOOL, { recursive: true });
  const tujuan = berkasTool(nama);

  // Tulis dulu ke berkas sementara lalu rename: mencegah berkas setengah
  // jadi ikut dimuat bila agent menulis tool besar dan proses terputus.
  // PENTING: nama sementara WAJIB berakhiran .js — Node menolak mengimpor
  // berkas dengan ekstensi tak dikenal (uji: ".tmp-<angka>" → ERR_UNKNOWN_FILE_EXTENSION).
  const sementara = path.join(DIR_TOOL, `.tmp-${Date.now()}-${nama}.js`);
  await fs.writeFile(sementara, isi, "utf-8");

  // Uji muat SEBELUM dipasang permanen: tool yang sintaksnya rusak
  // lebih baik ditolak di sini (pesan jelas) daripada gagal senyap nanti.
  try {
    const mod = await import(`${pathToFileURL(sementara).href}?v=${Date.now()}`);
    if (typeof (mod.jalankan || mod.default) !== "function") {
      await fs.unlink(sementara).catch(() => {});
      return { ok: false, pesan: "Berkas tool harus mengekspor fungsi `jalankan(args, ctx)`." };
    }
    if (mod.meta?.nama && mod.meta.nama !== nama) {
      await fs.unlink(sementara).catch(() => {});
      return { ok: false, pesan: `meta.nama ("${mod.meta.nama}") tidak sama dengan nama berkas ("${nama}").` };
    }
  } catch (e) {
    await fs.unlink(sementara).catch(() => {});
    return { ok: false, pesan: `Tool gagal dimuat (sintaks/ekspor salah): ${e.message}` };
  }

  await fs.rename(sementara, tujuan);
  segarkanCache();
  return { ok: true, berkas: tujuan, pesan: `Tool "${nama}" terpasang di ${tujuan}.` };
}

/** Hapus tool dinamis. Mengembalikan { ok, pesan }. */
export async function hapusTool(nama) {
  if (!namaSah(nama)) return { ok: false, pesan: `Nama tool tidak sah: "${nama}".` };
  const berkas = berkasTool(nama);
  try {
    await fs.access(berkas);
  } catch {
    return { ok: false, pesan: `Tool "${nama}" tidak ada di ${DIR_TOOL}.` };
  }
  await fs.unlink(berkas);
  segarkanCache();
  return { ok: true, pesan: `Tool "${nama}" dihapus.` };
}

/** Ringkasan tool dinamis untuk /tools: [{nama, deskripsi, kategori}] */
export async function daftarToolDinamis() {
  const tool = await muatToolDinamis();
  return tool.map((t) => ({
    nama: t.meta.nama,
    deskripsi: t.meta.deskripsi,
    kategori: t.meta.kategori || "umum",
    berkas: t.berkas,
  }));
}
