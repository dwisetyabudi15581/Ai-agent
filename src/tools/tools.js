// ============ TOOLS: EKSEKUSI NYATA DI TERMUX ============
import fs from "fs/promises";
import fsSinkron from "fs";
import path from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { HOME, DIR_BACKUP, pastikanDir } from "../paths.js";
import { singkat } from "../ui/util.js";
import { ambilKatalogLengkap, kapabilitasTampil } from "../api/katalog.js";
import { muatMemori, tambahMemori } from "../core/memori.js";
import {
  muatToolDinamis, keSkema, simpanTool, hapusTool,
  daftarToolDinamis, galatTool, DIR_TOOL, namaSah,
} from "./registry.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const BATAS_OUTPUT_TERMINAL = 20000;
export const BATAS_BACA_FILE = 40000;

/**
 * Potong isi tool SEBELUM masuk konteks model.
 *
 * PENTING — kenapa ini bukan sekadar "potong output": setiap keluaran tool
 * disimpan sebagai pesan role:tool di `sesi.messages`, dan pesan itu DIKIRIM
 * ULANG ke model pada setiap putaran berikutnya sampai sesi diringkas.
 * Satu `cat` 40 KB yang dipanggil di putaran ke-2 dari 20 putaran = 40 KB
 * × 19 kiriman. Batas ini memotong biaya itu di sumbernya.
 *
 * Yang dilihat user di layar (`detail`) TIDAK terpengaruh — hanya versi
 * yang dibaca model yang dipotong. Kepala + ekor dipertahankan karena
 * informasi penting biasanya ada di keduanya (awal output & pesan galat).
 *
 * @param {string} teks       keluaran mentah
 * @param {number} batas      karakter; 0/undefined = tanpa batas
 * @param {string} label      keterangan jenis keluaran (untuk pesan potong)
 */
export function potongUntukModel(teks, batas, label = "keluaran") {
  const s = String(teks ?? "");
  const n = Number(batas) || 0;
  if (n <= 0 || s.length <= n) return s;
  const kepala = Math.floor(n * 0.7);
  const ekor = n - kepala;
  return `${s.slice(0, kepala)}\n\n…(DIPOTONG: ${label} total ${s.length} karakter, hanya ${n} pertama+terakhir dikirim ke model. Untuk melihat bagian lain, panggil ulang dengan perintah yang lebih spesifik — mis. head/tail/sed -n/grep — jangan baca ulang seluruhnya.)\n\n${s.slice(-ekor)}`;
}

// ---------- BACA GAMBAR (vision) ----------
// PENTING: kedua konstanta ini HARUS berada di atas buatEksekutor.
// `const` tidak di-hoist seperti `function` — bila diletakkan di bawah,
// siapkanGambar() yang dijalankan saat buatEksekutor() dipanggil akan
// menabrak TDZ (ReferenceError) dan mimeGambar() mengembalikan null
// karena peta ekstensinya belum terinisialisasi.
const EKSTENSI_GAMBAR = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// 8 MB: base64 membengkakkan ~33%, dan gateway membatasi ukuran body.
const BATAS_GAMBAR = 8 * 1024 * 1024;

/**
 * Mime gambar dari nama berkas; null bila ekstensi tidak didukung.
 * Menerima nama lengkap ("foto.PNG") MAUPUN ekstensi mentah (".png").
 * Tanpa path.extname() di sini, "foto.png" akan gagal cocok karena peta
 * EKSTENSI_GAMBAR berkunci ".png" (dengan titik).
 */
export function mimeGambar(nama) {
  const mentah = String(nama || "");
  const ext = path.extname(mentah).toLowerCase() || mentah.toLowerCase();
  return EKSTENSI_GAMBAR[ext] || null;
}

// Shell untuk eksekusi_terminal. Termux (tanpa root) tidak punya /bin, jadi
// harus memakai bash bawaan prefix-nya. Di lingkungan lain (Linux/macOS
// biasa) /bin/bash atau /bin/sh dipakai — dulu path Termux di-hardcode
// sehingga tool GAGAL di semua lingkungan non-Termux.
const BASH_TERMUX = "/data/data/com.termux/files/usr/bin/bash";
const SHELL_EKSEKUSI =
  fsSinkron.existsSync(BASH_TERMUX) ? BASH_TERMUX
  : fsSinkron.existsSync("/bin/bash") ? "/bin/bash"
  : fsSinkron.existsSync("/bin/sh") ? "/bin/sh"
  : undefined; // biarkan Node memilih default

// Daftar tools dalam format OpenAI function-calling
// ---------- TOOL BAWAAN (hardcoded, selalu ada) ----------
function toolBawaan() {
  return [
    { type: "function", function: { name: "baca_file", description: "Membaca isi file lokal (teks/kode).", parameters: { type: "object", properties: { nama_file: { type: "string" } }, required: ["nama_file"] } } },
    { type: "function", function: { name: "tulis_file", description: "Membuat atau menimpa file. Backup otomatis dibuat bila file sudah ada.", parameters: { type: "object", properties: { nama_file: { type: "string" }, isi_kode: { type: "string" } }, required: ["nama_file", "isi_kode"] } } },
    { type: "function", function: { name: "edit_file", description: "Mengganti teks tertentu di dalam file (cari & ganti). Lebih aman daripada menimpa seluruh file.", parameters: { type: "object", properties: { nama_file: { type: "string" }, cari: { type: "string", description: "teks lama yang persis ada di file" }, ganti: { type: "string", description: "teks pengganti" } }, required: ["nama_file", "cari", "ganti"] } } },
    { type: "function", function: { name: "hapus_file", description: "Menghapus file atau folder (rekursif).", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
    { type: "function", function: { name: "eksekusi_terminal", description: "Menjalankan perintah shell (bash) di Termux secara nyata dan mengembalikan stdout/stderr.", parameters: { type: "object", properties: { perintah: { type: "string" }, timeout_detik: { type: "number", description: "default 120" } }, required: ["perintah"] } } },
    { type: "function", function: { name: "cek_folder", description: "Melihat daftar isi direktori beserta ukurannya.", parameters: { type: "object", properties: { path_direktori: { type: "string", description: "contoh: ./" } }, required: ["path_direktori"] } } },
    { type: "function", function: { name: "cari_teks", description: "Mencari teks/pola di dalam file-file proyek (grep rekursif).", parameters: { type: "object", properties: { pola: { type: "string" }, folder: { type: "string", description: "default ./" } }, required: ["pola"] } } },
    { type: "function", function: { name: "daftar_model", description: "Mengambil daftar semua model AI Re:Link yang didukung (aktif + nonaktif) beserta multiplier token, vendor, dan kapabilitasnya.", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "ingat", description: "Menyimpan fakta penting ke memori jangka panjang (bertahan antar sesi).", parameters: { type: "object", properties: { fakta: { type: "string", description: "fakta ringkas yang harus diingat" }, bagian: { type: "string", enum: ["Tentang User", "Proyek & Lingkungan", "Fakta Penting", "Catatan Terakhir"] } }, required: ["fakta"] } } },
    { type: "function", function: { name: "baca_memori", description: "Membaca seluruh memori jangka panjang.", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "cari_web", description: "Mencari informasi terbaru di internet (DuckDuckGo) dan mengembalikan ringkasan hasil.", parameters: { type: "object", properties: { kueri: { type: "string" } }, required: ["kueri"] } } },
    { type: "function", function: { name: "ambil_url", description: "Mengambil isi halaman web / API (teks) dari sebuah URL.", parameters: { type: "object", properties: { url: { type: "string" }, maks_karakter: { type: "number" } }, required: ["url"] } } },
    { type: "function", function: {
      name: "baca_gambar",
      description: "Membaca berkas GAMBAR dari mesin user (screenshot, foto, QR, grafik) lalu mengirimnya ke model. WAJIB memakai model yang mendukung VISION — panggil ini hanya bila model aktif sanggup melihat gambar. Kegunaan: membaca screenshot layar Termux, mengekstrak teks dari foto (OCR), memeriksa tampilan aplikasi, membaca grafik/plot, memeriksa QR code.",
      parameters: {
        type: "object",
        properties: {
          nama_file: { type: "string", description: "path gambar; relatif terhadap folder kerja, atau absolut, atau diawali ~/" },
          instruksi: { type: "string", description: "apa yang ingin diketahui dari gambar, contoh: \"baca semua teks di dalamnya\" atau \"apakah tata letak ini rapi?\"" },
        },
        required: ["nama_file"],
      },
    } },

    // ── TOOL META: agent membangun kemampuannya sendiri ──────────────────
    { type: "function", function: {
      name: "bikin_tool",
      description: "MEMBUAT TOOL BARU secara permanen. Pakai ini bila kemampuan yang dibutuhkan belum ada di daftar tool — jangan menyerah karena tool belum tersedia. Tool yang dibuat langsung tersedia di giliran berikutnya tanpa restart. Tulis kode ESM lengkap di dalam `kode` (isi fungsi jalankan).",
      parameters: {
        type: "object",
        properties: {
          nama: { type: "string", description: "nama tool: huruf kecil, angka, garis bawah. contoh: cek_baterai" },
          deskripsi: { type: "string", description: "penjelasan singkat KAPAN tool dipakai — ini yang dibaca model lain untuk memutuskan" },
          parameter: { type: "object", description: "skema JSON parameter (format OpenAI). contoh: {\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}" },
          kode: { type: "string", description: "ISI fungsi jalankan(args, ctx) — tanpa pembungkus fungsi. Boleh pakai await, ctx.eksekusi(perintah, timeoutDetik), ctx.cwd, ctx.home. Contoh: \"const {stdout} = await ctx.eksekusi('uname -a');\\nreturn {judul:'uname', detail:stdout, raw:stdout, ok:true};\" Bila dikosongkan, dibuat kerangka kosong." },
          kategori: { type: "string", description: "kategori bebas untuk pengelompokan, contoh: sistem, jaringan, media" },
        },
        required: ["nama", "deskripsi"],
      },
    } },
    { type: "function", function: {
      name: "hapus_tool",
      description: "Menghapus tool dinamis yang pernah dibuat. Tool bawaan tidak bisa dihapus.",
      parameters: { type: "object", properties: { nama: { type: "string" } }, required: ["nama"] },
    } },
    { type: "function", function: {
      name: "lihat_tool",
      description: "Membaca sumber kode sebuah tool dinamis — untuk memeriksa atau memperbaiki tool yang sudah dibuat.",
      parameters: { type: "object", properties: { nama: { type: "string" } }, required: ["nama"] },
    } },
  ];
}

// Nama tool bawaan (dipakai untuk mencegah tool dinamis menimpa/menyamar
// sebagai tool inti, dan untuk membedakan sumber kode di lihat_tool).
const NAMA_BAWAAN = new Set(toolBawaan().map((t) => t.function?.name).filter(Boolean));

// ---------- Peta kemampuan: tool → kemampuan yang dibutuhkan ----------
// Dipakai router untuk menyimpulkan kebutuhan model dari tool yang SEDANG
// dipanggil model, bukan dari tebakan kata di teks user. Sumbernya bukan
// tebakan: `baca_gambar` memang hanya bisa bekerja pada model vision.
export const TOOL_BUTUH_KAPABILITAS = {
  baca_gambar: "vision",
};

/** Ekspor untuk pemakaian luar (index.js menampilkan "butuh X" di /tools). */
export function kebutuhanTool(nama) {
  return TOOL_BUTUH_KAPABILITAS[nama] || null;
}

/**
 * Daftar tool LENGKAP: bawaan + tool dinamis hasil buatan agent.
 *
 * Dibuat async karena tool dinamis dibaca dari disk. Dipanggil ulang tiap
 * giliran supaya tool yang baru dibuat agent langsung dikenali model —
 * tanpa restart. Bila folder tool bermasalah, agent tetap jalan dengan
 * tool bawaan saja (kegagalan tool dinamis tidak boleh fatal).
 *
 * `toolsInti` (bila diberikan) dipakai apa adanya sebagai ganti tool
 * bawaan — jalur ini dipakai oleh eksekutor agar tidak ada perbedaan
 * daftar antara yang dilihat model dan yang bisa dijalankan.
 */
export async function daftarToolsLengkap(opsi = {}) {
  const inti = Array.isArray(opsi.toolsInti) ? opsi.toolsInti : toolBawaan();
  try {
    const dinamis = await muatToolDinamis();
    // Tool dinamis TIDAK boleh menimpa tool bawaan: nama bentrok dilewati.
    const namaInti = new Set(inti.map((t) => t.function?.name).filter(Boolean));
    const tambahan = dinamis.filter((t) => !namaInti.has(t.meta.nama)).map(keSkema);
    return [...inti, ...tambahan];
  } catch {
    return inti;
  }
}

/** Versi sinkron (tool bawaan saja) — untuk pemanggil lama / tampilan cepat. */
export function daftarTools() {
  return toolBawaan();
}

// ---------- PEMADATAN KONTEKS (penghemat token terbesar) ----------
//
// MASALAH
// `sesi.messages` dikirim UTUH ke API pada setiap putaran tool-calling.
// Semua pesan `role: "tool"` dari putaran-putaran sebelumnya ("sudah basi")
// sebenarnya tidak lagi dibutuhkan: model hanya perlu tahu APA hasilnya,
// bukan seluruh isi mentahnya. Tanpa pemadatan, satu sesi panjang bisa
// mengirim puluhan KB isi file/terminal lama berulang kali.
//
// SOLUSI (nol efek terhadap kualitas kerja)
// 1. Isi pesan tool lama dipotong ke SATU baris ringkas (judul + baris
//    pertama yang informatif, maks ~180 karakter). Model tetap tahu tool
//    apa dipanggil dan apa hasil pokoknya → tidak kehilangan jejak.
// 2. Pesan tool dari putaran TERAKHIR (`jagaTerakhir`) dibiarkan UTUH,
//    karena itu yang sedang dipakai model untuk memutuskan langkah
//    berikutnya. Jadi penalaran berantai tidak terganggu.
// 3. Pesan `tool_calls` assistant TIDAK disentuh sama sekali — pasangan
//    tool_call_id tetap lengkap sehingga API tidak menolak permintaan.
//
// Hasil: penghematan besar pada sesi panjang, akurasi tetap 100% pada
// langkah yang sedang dikerjakan.
const BATAS_BASI = 180; // karakter per pesan tool yang dipadatkan
// Ambang pemadatan untuk pesan assistant non-tool (narasi lama). Lebih longgar
// dari pesan tool karena narasi carry penalaran, tapi tetap dibatasi supaya
// sesi 30+ putaran tidak menggelembung linear tanpa akhir.
const BATAS_ASST = 600;
// Ambang pemadatan pesan `user` lama. Pesan user adalah INSTRUKSI — memangkasnya
// jauh lebih berisiko daripada memangkas narasi assistant, jadi ambangnya
// paling longgar (1200) dan penjagaannya paling ketat.
//
// Kenapa perlu sama sekali: pada sesi obrolan/diskusi panjang (tanpa satu pun
// role "tool"), pesan user-lah pemegang beban dominan. Terukur pada sesi 40
// putaran: user 101.759 char vs assistant 28.363 char setelah pemadatan →
// 64% beban proyeksi tetap tersisa, rasio pertumbuhan hampir linear (3.6x per
// 4x putaran). Pemadatan assistant saja TIDAK cukup.
//
// YANG DILINDUNGI (tidak pernah disentuh):
//   1. Pesan user PERTAMA — biasaya berisi tugas/peran awal sesi.
//   2. `jagaUserTerakhir` pesan user TERAKHIR — biasaya tugas yang sedang
//      dikerjakan. Bawaan 3 (bukan 1) karena rangkaian instruksi berurutan
//      (mis. "buat file" → "jalankan" → "perbaiki") baru bermakna bila utuh.
//   3. Pesan di dalam zona `jagaTerakhir`.
//   4. Pesan yang lebih pendek dari ambang (tidak ada yang bisa dihemat).
const BATAS_USER = 1200;
const JAGA_USER_TERAKHIR = 3;
// Jendela pemadatan: berapa BANYAK pesan lama (di luar ekor terjaga) yang
// boleh tinggal di proyeksi. Pemadatan ke ambang tetap saja TIDAK cukup —
// jumlah pesannya tetap tumbuh linear, jadi total ikut linear meski lerengnya
// lebih landai. Terukur sebelum opsi ini ada: kontribusi pesan lama naik
// 47% (10 putaran) → 79% (40 putaran) → 86% (80 putaran) dari total proyeksi.
//
// Dengan jendela ini, proyeksi berhenti tumbuh: yang tertinggal hanya
// `jendelaPadat` pesan lama terbaru. Pesan yang DIBUANG dicatat sebagai
// pengganti satu baris ("…[N pesan lama dipadatkan]") sehingga model tahu ada
// riwayat yang diringkas, bukan seolah tidak pernah terjadi.
//
// 0 = matikan pembuangan (kembali ke perilaku "pangkas saja").
const JENDELA_PADAT = 24;
// Pesan assistant pembuka blok tool: isi teksnya dipangkas ke batas ini,
// sementara array `tool_calls`-nya dibiarkan utuh (id harus lengkap agar API
// menerima request). Argumen panggilan tool memang cenderung tumbuh tiap
// putaran, jadi bagian inilah yang paling cepat membengkakkan riwayat.
const BATAS_CALL = 300;
// Pesan yang DIBUANG tidak boleh memutus pasangan assistant(tool_calls) ↔
// tool(tool_call_id) — API menolak request bila pasangannya menggantung.
// Blok panggilan tool karena itu selalu dipertahankan apa adanya.

/**
 * Padatkan pesan tool yang sudah "basi" menjadi satu baris ringkas.
 *
 * SEMANTIK (dibuat eksplisit — versi lama salah arah dan mengakibatkan
 * NOL pemadatan pada kasus nyata):
 *
 *   jagaToolTerakhir : berapa pesan tool TERAKHIR yang dibiarkan UTUH.
 *                      Ini satu-satunya penjaga yang penting — hanya hasil
 *                      tool paling akhir yang sedang dipakai model untuk
 *                      memutuskan langkah berikutnya.
 *   jagaTerakhir     : jumlah pesan ekor (semua peran) yang kebal pemadatan.
 *                      Dipakai HANYA untuk giliran yang sedang berjalan.
 *
 * Versi lama memakai `padatkanToolLama = 8` sebagai "jumlah tool terakhir yang
 * dipertahankan" — dengan 5 tool dalam sesi, `5 - 8 <= 0` sehingga TIDAK ADA
 * pesan tool yang pernah dipadatkan (penghematan 0%). Sekarang parameternya
 * `jagaToolTerakhir` (bawaan 2): semua tool sisanya dipadatkan, berapa pun
 * panjang sesinya.
 *
 * `padatkanToolLama` masih diterima sebagai alias lama agar pemanggil yang
 * belum diperbarui tidak diam-diam kehilangan pemadatan.
 */
export function padatkanRiwayat(messages, opsi = {}) {
  if (!Array.isArray(messages)) return messages;

  // Bawaan sengaja konservatif: 2 tool terakhir utuh → penalaran berantai aman,
  // sisanya dipadatkan. 0 = matikan pemadatan sepenuhnya.
  const jaga =
    opsi.jagaToolTerakhir != null ? Number(opsi.jagaToolTerakhir)
    : opsi.padatkanToolLama != null ? Number(opsi.padatkanToolLama) // alias lama
    : 2;
  if (!Number.isFinite(jaga)) return messages;
  // Nilai besar = "jangan padatkan apa pun" (dipakai jalur yang memang ingin
  // riwayat utuh). Diterjemahkan sebelum perhitungan agar tidak overflow.
  if (jaga >= messages.length) return messages;

  if (jaga < 0) return messages;

  // Kumpulkan indeks pesan tool, dari yang PALING LAMA ke paling baru.
  // CATATAN: TIDAK ADA `return messages` di sini walau kosong. Sesi murni
  // naratif (tanpa satu pun role "tool") dulu lolos utuh dan tumbuh tanpa
  // batas — justru sesi itulah yang paling perlu dipadatkan di sisi assistant.
  const idxTool = [];
  messages.forEach((m, i) => { if (m?.role === "tool") idxTool.push(i); });
  const kandidat = jaga > 0 ? idxTool.slice(0, Math.max(0, idxTool.length - jaga)) : idxTool;

  // Zona aman ekor (lihat doc di atas).
  const batasAman = messages.length - (Number(opsi.jagaTerakhir) || 0);

  const target = new Set(kandidat.filter((i) => i < batasAman));

  // ── SISI ASSISTANT: kebocoran terbesar di sesi panjang ────────────────────
  // Pemadatan lama hanya menyentuh role "tool" — padahal di sesi agent nyata
  // role "assistant" (narasi + argumen tool_call) justru 3-5x lebih besar.
  // Hasil terukur: 81% beban riwayat tak pernah tersentuh, rasio mentok ~69%.
  //
  // Yang WAJIB dilindungi pada pesan assistant:
  //   1. Pesan yang memuat tool_calls → bloK-nya harus utuh. Kalau tool_calls
  //      dibuang, pasangan tool_call_id ikut hilang dan API menolak request.
  //   2. z.B. putaran terakhir tetap utuh agar model ingat langkah terkininya.
  //  Isi teksnya boleh dipangkas; hanya .content yang disentuh.
  const batasAsst = Number.isFinite(Number(opsi.batasAssistant))
    ? Number(opsi.batasAssistant)
    : BATAS_ASST;
  if (batasAsst > 0) {
    for (let i = 0; i < Math.min(batasAman, messages.length); i++) {
      const m = messages[i];
      if (m?.role !== "assistant") continue;
      if (m.tool_calls?.length) {
        // Pesan pembuka blok tool: isinya (argumen panggilan) ikut besar dan
        // tumbuh tiap putaran. Boleh dipangkas, TAPI tool_calls wajib utuh —
        // satu id hilang = API menolak seluruh request.
        const isi = String(m.content || "").replace(/\s+/g, " ").trim();
        if (isi.length > BATAS_CALL) target.add(i);
        continue;
      }
      const isi = String(m.content || "").replace(/\s+/g, " ").trim();
      if (isi.length <= batasAsst) continue;
      target.add(i);
    }
  }
  // Sisi tool lama: isi keluaran panjang ikut dipotong (perilaku lama — sudah
  // ada, hanya ditegaskan di sini agar kandidat lamanya tidak lolos utuh).
  for (const i of kandidat) {
    if (i >= batasAman) continue;
    target.add(i);
  }

  // ── SISI USER: penutup kebocoran pada sesi obrolan panjang ────────────────
  // Role "user" sengaja paling akhir disentuh karena isinya adalah INSTRUKSI.
  // Pada sesi ber-tool, bagian ini biasanya tidak melakukan apa pun (pesan user
  // pendek); ia baru berarti di sesi naratif panjang, di mana setelah pemadatan
  // assistant sisanya justru didominasi user.
  const batasUser = Number.isFinite(Number(opsi.batasUser)) ? Number(opsi.batasUser) : BATAS_USER;
  const jagaUser = Number.isFinite(Number(opsi.jagaUserTerakhir))
    ? Number(opsi.jagaUserTerakhir)
    : JAGA_USER_TERAKHIR;
  if (batasUser > 0 && jagaUser >= 0) {
    // Indeks pesan user dari yang PALING BARU → untuk menandai N terakhir.
    const idxUser = [];
    messages.forEach((m, i) => { if (m?.role === "user") idxUser.push(i); });
    const kebalUser = new Set(
      (jagaUser > 0 ? idxUser.slice(Math.max(0, idxUser.length - jagaUser)) : [])
        .concat(idxUser.slice(0, 1)) // pesan user PERTAMA = tugas awal sesi
    );
    for (let i = 0; i < Math.min(batasAman, messages.length); i++) {
      const m = messages[i];
      if (m?.role !== "user") continue;
      if (kebalUser.has(i)) continue;
      if (String(m.content || "").length <= batasUser) continue;
      target.add(i);
    }
  }

  const dipadatkan = messages
    .map((m, i) => {
      if (!target.has(i)) return m;
      const isi = String(m.content || "").replace(/\s+/g, " ").trim();
      const batas =
        m.role === "assistant" ? batasAsst
        : m.role === "user" ? batasUser
        : BATAS_BASI;
      // Sudah singkat → biarkan apa adanya (tidak ada yang bisa dihemat).
      if (isi.length <= batas) return m;
      const ringkas = isi.slice(0, batas);
      return { ...m, content: `${ringkas} …[dipadatkan: ${isi.length}→${batas} char]` };
    })
    // Buang pesan assistant yang benar-benar hampa (content null/kosong dan
    // tanpa panggilan tool). Pesan seperti ini muncul dari pemadatan maupun
    // pembuangan, dan hanya memakan slot tanpa memberi informasi apa pun.
    .filter((m) => {
      if (m?.role !== "assistant") return true;
      const isi = typeof m.content === "string" ? m.content.trim() : "";
      const adaCall = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      return !!(isi || adaCall);
    });

  // ── PENTING: filter di atas MEMBUANG elemen → indeks array bergeser. ──────
  // Seluruh perhitungan di bawah (bolehBuang, blok, penjaga integritas) memakai
  // indeks array, jadi indeks WAJIB diambil ulang dari `dipadatkan`, bukan dari
  // `messages`. Kalau tidak, blok tool diambil dari posisi yang salah pada
  // riwayat campuran → pembuangan tidak konsisten dan jendela tidak mengikat.
  const indeksHidup = new Set(dipadatkan.map((_, i) => i));

  // ── JENDELA: buang pesan lama agar pertumbuhan benar-benar berhenti ───────
  // Tanpa langkah ini, proyeksi tetap naik linear (hanya lebih landai) karena
  // jumlah pesan lama terus bertambah walau masing-masing sudah dipendekkan.
  const jendela = Number.isFinite(Number(opsi.jendelaPadat)) ? Number(opsi.jendelaPadat) : JENDELA_PADAT;
  if (!(jendela > 0)) return dipadatkan;
  // Yang dihitung terhadap jendela adalah SEMUA pesan lama yang boleh dibuang,
  // bukan hanya yang kebetulan sudah masuk himpunan `target`. BUG lama: ukuran
  // diambil dari `target`, padahal pesan assistant ber-tool_calls dan blok tool
  // sering TIDAK masuk target → jumlahnya selalu ≤ jendela → jendela tak pernah
  // jalan (terukur: 76 pesan masuk, 76 pesan keluar, sama sekali tidak menyusut).
  //
  // Yang tidak boleh dibuang: pesan system, dan ekor terjaga (JAGA ekor).
  // Perhitungan memakai `dipadatkan` (array yang benar-benar difilter di akhir),
  // BUKAN `messages`, karena panjang keduanya bisa berbeda akibat penyaringan
  // pesan assistant hampa. Zona ekor terjaga diukur dari panjang `dipadatkan`
  // agar yang dilindungi tepat N pesan TERAKHIR dari proyeksi nyata.
  const batasJendela = dipadatkan.length - (Number(opsi.jagaTerakhir) || 0);
  const bolehBuang = [];
  for (let i = 0; i < dipadatkan.length; i++) {
    const m = dipadatkan[i];
    if (!m || m.role === "system") continue; // instruksi: jangan pernah dibuang
    if (i >= batasJendela) continue; // ekor terjaga
    bolehBuang.push(i);
  }
  const bolehBuangSet = new Set(bolehBuang);
  if (bolehBuang.length <= jendela) return dipadatkan;

  // KUOTA vs JENDELA — bug yang membuat proyeksi tumbuh linear:
  // dulu `terpakai` dibandingkan dengan `jendela` (24), sehingga yang dibuang
  // selalu TEPAT 24 pesan berapa pun panjang sesinya:
  //   p=40: asli 101 → out 77 | p=80: asli 201 → out 177
  // Keluaran tetap naik karena yang dibuang tetap, sedangkan riwayat memanjang.
  //
  // MAKNA JENDELA YANG BENAR: berapa pesan lama yang boleh TERSISA di proyeksi.
  // Jadi kuota buang = (jumlah pesan yang boleh dibuang) − jendela. Nilainya
  // ikut tumbuh bersama riwayat, sehingga sisanya berhenti di sekitar `jendela`.
  const kuotaBuang = bolehBuang.length - jendela;

  // Kandidat buang: yang paling lama dulu (urutan indeks sudah kronologis).
  const kandidatBuang = bolehBuang.slice(0, kuotaBuang);

  // ── Satuan pembuangan = SATU BLOK TOOL, bukan satu pesan ────────────────
  // Pesan assistant ber-`tool_calls` dan pesan `tool` yang menjawabnya adalah
  // satu kesatuan: API menolak request bila salah satunya tertinggal. Jadi
  // yang dihitung terhadap jendela haruslah BLOK, bukan pesan tunggal. Inilah
  // akar bug "jendela kadang batal": dulu per pesan, lalu penjaga integritas
  // terpaksa menyeret blok ke dalam himpunan buang — dan loop perluasannya
  // salah arah sehingga himpunan buang membengkak sampai seluruh sesi
  // (terukur: 80 putaran → 188 pesan keluar, bukan ~24).
  //
  // Peta id panggilan → indeks pesan yang memuatnya (assistant) dan yang
  // menjawabnya (tool). Satu id boleh memiliki beberapa jawaban (tool paralel).
  const idKeIndeks = new Map(); // id → { call: i|null, jawab: [i…] }
  dipadatkan.forEach((m, i) => {
    if (m?.tool_calls?.length) {
      for (const c of m.tool_calls) {
        const s = idKeIndeks.get(c.id) || { call: null, jawab: [] };
        s.call = i;
        idKeIndeks.set(c.id, s);
      }
    }
    if (m?.role === "tool" && m.tool_call_id) {
      const s = idKeIndeks.get(m.tool_call_id) || { call: null, jawab: [] };
      s.jawab.push(i);
      idKeIndeks.set(m.tool_call_id, s);
    }
  });

  // Satuan blok: setiap id → himpunan indeks anggotanya. Pesan non-blok
  // (narasi assistant, user, system) berdiri sendiri sebagai blok satu pesan.
  const blokDariIndeks = new Map(); // indeks → Set(indeks anggota blok)
  for (const [, s] of idKeIndeks) {
    const anggota = new Set();
    if (s.call != null) anggota.add(s.call);
    s.jawab.forEach((j) => anggota.add(j));
    for (const a of anggota) blokDariIndeks.set(a, anggota);
  }

  // Susun ulang: ambil kandidat dari yang paling lama, masukkan seluruh bloknya.
  //
  // PENTING — jangan `break` saat satu blok tidak muat. Sesi agent berisi
  // campuran blok tool (2 pesan) dan pesan tunggal (1 pesan). Kalau kita
  // berhenti di blok pertama yang melebihi sisa kuota, hampir seluruh kandidat
  // lama tidak pernah dibuang → proyeksi tumbuh linear lagi (terukur: 40
  // putaran → 70 pesan, 80 → 164, 120 → 257). Yang benar: LEWATI blok yang
  // tidak muat dan lanjut ke kandidat berikutnya selama masih ada sisa kuota
  // yang bisa memuat setidaknya satu blok.
  //
  // TIGA BUG yang diperbaiki di sini (semuanya hanya muncul di riwayat PANJANG,
  // sehingga tidak terlihat pada uji pendek):
  //
  //  [A] ANGGOTA BLOK BISA DILEWATI → dibuang lalu diloloskan lagi.
  //      `blokDariIndeks` dihitung pada `dipadatkan` — array HASIL penyaringan,
  //      sementara `bolehBuang`/`kandidatBuang` memakai indeks `messages`.
  //      Satu pesan saja yang tersaring di pangkal (mis. assistant hampa)
  //      menggeser SELURUH indeks setelahnya, sehingga `blokDariIndeks.get(i)`
  //      mengembalikan blok milik pesan LAIN — index bergeser satu.
  //      Akibatnya ada anggota blok yang tidak pernah dimasukkan, lalu loop
  //      berikutnya menemukannya lewat indeks lain → masuk dua kali.
  //  [B] SATU INDEKS DIHITUNG DUA KALI → kuota jebol. Dulu penjaga
  //      "sudah pernah dimasukkan lewat anggota lain" TIDAK ADA (`continue`
  //      hanya bila i ∈ akanDibuang), padahal blok berukuran 2+ dipakai ulang
  //      oleh anggota keduanya → `terpakai` bertambah, `akanDibuang` tidak.
  //      Terukur: kuota=372 tetapi NYATA dibuang 398 (kelebihan 26) — dan yang
  //      hilang termasuk pesan `user` yang seharusnya TIDAK PERNAH disentuh.
  //  [C] PEMBUANGAN BISA DIBATALKAN PENJAGA INTEGRITAS → jendela tak mengikat.
  //      Kandidat lama memakai potongan AWAL indeks; pada riwayat campuran
  //      (user | assistant | user | assistant...) separuh batas blok tepat
  //      memotong pasangan di indeks TERAKHIR kandidat. Penjaga integritas
  //      lalu mengembalikan blok itu → sisa bertambah 2 → outN tidak pernah
  //      stabil berapa pun panjang riwayat. Perbaikan: kandidat diambil dari
  //      potongan awal TOKEN, sedangkan kuota diukur pada indeks TERAKHIR yang
  //      benar-benar ikut dibuang. Bila token terakhir jatuh di TENGAH blok,
  //      token itu mundur ke anggotanya yang paling awal.
  //
  // Kandidat = potongan awal, KUOTA = indeks ambil-terakhir yang sesungguhnya.
  // Selisih keduanya membuat batas pembuangan SELALU jatuh di batas blok,
  // sehingga tidak ada blok yang bisa menggantung dan batal dibuang.
  const kandidatToken = kandidatBuang;
  const batasKuota = kandidatToken.length
    ? kandidatToken[kandidatToken.length - 1] + 1
    : 0;

  // HIMPUNAN BUANG HARUS KEBAL JENDELA (tetap, tidak berubah-ubah).
  //
  // Ini adalah keputusan desain yang menyelesaikan [C] secara tuntas, bukan
  // tambal-sulam. Pendekatan lama ("kuota diukur pada indeks terakhir token")
  // masih membuat pembuangan TIDAK KEBAL: pada riwayat campuran
  // (user | assistant | user | assistant...), token terakhir sering jatuh
  // TEPAT di assistant pembuka blok tool, sehingga indeks jawaban tool-nya
  // (i+1) berada DI LUAR kandidat. Blok itu lalu ditolak ("tidak muat") →
  // penjaga integritas tidak menemukan ketidakseimbangan (karena blok ditolak
  // utuh) → hasilnya sisa riwayat bertambah dua → outN tidak stabil.
  //
  // Aturan baru yang lebih sederhana dan deterministik:
  //   • blok LAMA di luar jendela → SELALU dibuang (bila seluruh anggotanya
  //     boleh dibuang). Tidak ada kuota yang bisa menolaknya.
  //   • blok yang menyeberangi jendela (satu anggota boleh, satu tidak) →
  //     dilewati, bukan dibatalkan; tidak ada paksaan kuota, jadi tidak ada
  //     pengembalian yang membatalkan hasil.
  //   • pesan tunggal (narasi/user lama) tetap dihitung kuota agar sisanya
  //     berhenti di sekitar `jendela`, bukan habis.
  //
  // Kata "lama" = SELURUH indeks blok < batasKuota, sehingga blok yang
  // menyeberang batas tidak akan pernah setengah dibuang.
  const akanDibuang = new Set();
  let terpakaiBlok = 0;  // blok yang menyeberangi jendela (dibatasi kuota)
  let terpakaiTunggal = 0; // pesan tunggal (dibatasi kuota)
  for (const i of kandidatToken) {
    if (akanDibuang.has(i)) continue;
    if (!bolehBuangSet.has(i)) continue; // hanya pesan yang boleh dibuang
    const blok = blokDariIndeks.get(i) || new Set([i]);
    // SETIAP anggota blok harus boleh dibuang; satu saja yang terkunci
    // (system / ekor terjaga) → seluruh blok dibatalkan sejak awal, tidak
    // menunggu penjaga integritas di bawah.
    if (![...blok].every((x) => bolehBuangSet.has(x))) continue;
    // [B] Penjaga riwayat-timpa: blok yang SELURUH anggotanya sudah pernah
    // dimasukkan tidak boleh menambah `terpakai` lagi.
    const baru = [...blok].filter((x) => !akanDibuang.has(x));
    if (baru.length === 0) continue;
    // Blok yang seluruh anggotanya berada DI DALAM kandidat (indeks terbesar
    // ≤ batasKuota) → dibuang tanpa syarat kuota. Inilah yang membuat jendela
    // benar-benar mengikat pada riwayat panjang berisi banyak blok tool.
    const dalamKandidat = [...blok].every((x) => x <= batasKuota - 1);
    if (dalamKandidat && baru.length > 1) {
      terpakaiBlok += baru.length;
      baru.forEach((x) => akanDibuang.add(x));
      continue;
    }
    // Sisanya (pesan tunggal, termasuk narasi/user lama) tetap dibatasi kuota
    // total supaya proyeksi tidak habis — model masih perlu jangkar riwayat.
    if (terpakaiTunggal + baru.length > kuotaBuang - terpakaiBlok) continue;
    terpakaiTunggal += baru.length;
    baru.forEach((x) => akanDibuang.add(x));
  }

  // Verifikasi akhir: pastikan tidak ada pasangan menggantung. Bila ada
  // (mis. karena bentuk riwayat tak terduga), kembalikan ke sisa HANYA anggota
  // blok yang bermasalah — bukan membatalkan seluruh pembuangan.
  //
  // BUG yang diperbaiki di sini: versi sebelumnya membaca id lewat
  // `m.tool_calls?.[0]?.id` — HANYA panggilan PERTAMA. Pesan assistant dengan
  // beberapa tool_calls (tool paralel) menyisakan id ke-2..n tanpa terverifikasi,
  // sehingga blok yang seharusnya utuh bisa lolos terpotong dan API menolak
  // request (terbukti: uji integrasi gagal, tool_call_id "t1" hilang).
  //
  // Aturan yang ditegakkan: setiap id HARUS muncul lengkap di sisi sisa atau
  // lengkap di sisi buang. Bila id yang sama ada di dua sisi, SELURUH indeks
  // yang memuat id itu dikembalikan ke sisi sisa.
  const idKeIndeksVerif = new Map(); // id → [indeks yang memuatnya]
  dipadatkan.forEach((m, i) => {
    const ids = [];
    if (m?.tool_calls?.length) for (const c of m.tool_calls) if (c?.id) ids.push(c.id);
    if (m?.role === "tool" && m.tool_call_id) ids.push(m.tool_call_id);
    for (const id of ids) {
      const arr = idKeIndeksVerif.get(id) || [];
      arr.push(i);
      idKeIndeksVerif.set(id, arr);
    }
  });
  let adaPutus = false;
  for (const [, indeks] of idKeIndeksVerif) {
    const semuaDibuang = indeks.every((i) => akanDibuang.has(i));
    const semuaSisa = indeks.every((i) => !akanDibuang.has(i));
    if (semuaDibuang || semuaSisa) continue; // konsisten
    indeks.forEach((i) => akanDibuang.delete(i)); // putus → kembalikan seluruhnya
    adaPutus = true;
  }
  if (adaPutus) {
    // Setelah pengembalian, kuota bisa jadi belum terpakai penuh. Biarkan —
    // integritas riwayat lebih penting daripada kuota persis. Pembuangan tetap
    // jauh lebih besar daripada sebelum jendela ada, dan tetap mengikat karena
    // sisa kandidat lama dibatasi kuota pada giliran berikutnya.
  }

  const jumlahDibuang = akanDibuang.size;
  if (jumlahDibuang === 0) return dipadatkan;

  const hasil = dipadatkan.filter((_, i) => !akanDibuang.has(i));
  // Beri tahu model bahwa ada riwayat yang diringkas — bukan seolah percakapan
  // baru dimulai. Penanda DITEMPELKAN ke pesan system pertama, bukan disisipkan
  // sebagai pesan system terpisah: dua pesan system berdampingan membuat model
  // ragu instruksi mana yang berlaku, dan API tertentu menolaknya.
  // PENTING: penanda ditempel ke SALINAN objek system, bukan ke objek asli.
  // Riwayat asli milik pemanggil dan dipakai lagi di giliran berikutnya; kalau
  // objeknya disentuh langsung, penanda akan menumpuk tiap giliran dan isi
  // sesi asli ikut rusak (terbukti di uji: "SESI ASLI: BERUBAH").
  const posSistem = hasil.findIndex((m) => m?.role === "system");
  if (posSistem >= 0) {
    hasil[posSistem] = {
      ...hasil[posSistem],
      content: `${hasil[posSistem].content || ""}\n\n`
        + `…[${jumlahDibuang} pesan lama dipadatkan karena konteks panjang. `
        + `Pakai tool untuk membaca ulang bila detail itu dibutuhkan.]`,
    };
  }
  return hasil;
}

/**
 * Proyeksi riwayat yang AMAN dikirim ke model.
 *
 * Sengaja dibuat sebagai salinan dangkal berisi objek baru untuk pesan yang
 * diubah — `sesi.messages` TIDAK pernah dimodifikasi, sehingga ringkasan,
 * arsip transkrip, dan pemuatan sesi lama tetap memakai data asli.
 */
export function riwayatUntukModel(messages, opsi = {}) {
  return padatkanRiwayat(messages, opsi);
}

/** Jalankan perintah shell dengan shell yang sudah terdeteksi Termux/Linux. */
async function jalankanShell(perintah, { cwd, timeoutDetik = 120 } = {}) {
  const timeout = Math.min(Math.max(Number(timeoutDetik) || 120, 1), 900) * 1000;
  return execAsync(perintah, {
    cwd,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    shell: SHELL_EKSEKUSI,
  });
}

/**
 * Bisa-tidaknya sebuah tool dinamis dijalankan oleh agent ini.
 * Tool dinamis punya hak yang sama dengan tool bawaan — memang tujuannya.
 * Bila opsi.izinkanToolDinamis === false, tool dinamis tidak dijalankan.
 */
export function buatEksekutor(cfg, opsi = {}) {
  const cwd = opsi.cwd || process.cwd();
  const izinkanHapus = opsi.izinkanHapus !== false;
  const izinkanToolDinamis = opsi.izinkanToolDinamis !== false;
  // Batas keluaran tool yang masuk konteks model (0 = tanpa batas).
  // Dibaca dari config agar bisa diubah tanpa menyentuh kode.
  const batasKonteksTool = Number(cfg?.batasOutputTool) || 0;

  // Wadah gambar terakhir yang berhasil dimuat oleh case "baca_gambar".
  // Diambil agen lewat jalankanTool.ambilGambarTerakhir().
  let gambarTerakhir = null;

  /** Perluas "~" tanpa melempar galat (dipakai ctx, bukan validasi input). */
  function kePathKasar(p) {
    const s = String(p ?? "");
    if (s === "~") return HOME;
    if (s.startsWith("~/")) return path.join(HOME, s.slice(2));
    return path.resolve(cwd, s);
  }

  /** Konteks yang diberikan ke kode tool dinamis. */
  const ctxTool = {
    cwd,
    home: HOME,
    cfg,
    // Pembungkus tipis supaya tool buatan agent tidak perlu impor child_process
    // sendiri — cukup ctx.eksekusi("perintah").
    eksekusi: (perintah, timeoutDetik) => jalankanShell(perintah, { cwd, timeoutDetik }),
    // Baca/tulis file juga sering dibutuhkan; disediakan agar tool dinamis ringkas.
    baca: (p) => fs.readFile(kePathKasar(p), "utf-8"),
    tulis: async (p, isi) => { const t = kePathKasar(p); await fs.mkdir(path.dirname(t), { recursive: true }); return fs.writeFile(t, isi); },
    jalankanShell: (perintah, timeoutDetik) => jalankanShell(perintah, { cwd, timeoutDetik }),
  };

  /**
   * Samakan penanganan path untuk SEMUA tool file.
   * Bug lama: path.resolve(cwd, "~/tes-ai/x.js") menghasilkan
   * "<cwd>/~/tes-ai/x.js" — folder aneh bernama "~" ikut dibuat dan file
   * "tidak ditemukan" padahal baru saja ditulis. Kini "~" diperluas ke HOME
   * dan path absolut tetap dihormati.
   */
  function kePath(nama) {
    const s = String(nama ?? "").trim();
    if (!s) throw new Error("nama file kosong");
    if (s === "~") return HOME;
    if (s.startsWith("~/")) return path.join(HOME, s.slice(2));
    return path.resolve(cwd, s);
  }

  /**
   * Latih berkas gambar menjadi pesan user multipart (format vision OpenAI).
   * Dipakai case "baca_gambar". Menyimpan hasilnya di closure supaya
   * agent.js bisa mengambilnya lewat `ambilGambarTerakhir()`.
   */
  async function siapkanGambar(nama, instruksi) {
    const p = kePath(nama);
    const mime = mimeGambar(p);
    if (!mime) {
      const ext = path.extname(p) || "(tanpa ekstensi)";
      throw new Error(`Ekstensi "${ext}" bukan gambar yang didukung (${Object.keys(EKSTENSI_GAMBAR).join(", ")}).`);
    }
    const stat = await fs.stat(p).catch(() => null);
    if (!stat || !stat.isFile()) throw new Error(`Berkas gambar tidak ditemukan: ${p}`);
    if (stat.size > BATAS_GAMBAR) {
      throw new Error(`Gambar terlalu besar (${(stat.size / 1048576).toFixed(1)} MB). Batas ${BATAS_GAMBAR / 1048576} MB.`);
    }
    const data64 = (await fs.readFile(p)).toString("base64");
    const tanya = String(instruksi || "").trim() || "Jelaskan isi gambar ini secara rinci. Bila ada teks, tuliskan apa adanya.";
    const pesan = {
      role: "user",
      content: [
        { type: "text", text: tanya },
        { type: "image_url", image_url: { url: `data:${mime};base64,${data64}` } },
      ],
    };
    gambarTerakhir = pesan;
    return { berkas: p, bytes: stat.size, mime, pesan };
  }

  /**
   * Ambil pesan gambar yang baru dilampirkan (satu kali pakai).
   * Agent memanggil ini setelah menjalankan tool: bila ada isinya, pesan itu
   * DISISIPKAN setelah hasil tool supaya model vision membacanya di giliran
   * yang sama — bukan menunggu user menjelaskan isi gambar.
   * (Properti ini dipasang SETELAH deklarasi jalankanTool — lihat bawah.)
   */
  function ambilGambarTerakhir() {
    const g = gambarTerakhir;
    gambarTerakhir = null;
    return g;
  }

  // CATATAN: jangan pakai `return async function jalankanTool` di sini —
  // itu mengakhiri buatEksekutor dan kode pemasangan properti di bawah
  // (jalankanTool.ambilGambarTerakhir) tidak akan pernah dieksekusi.
  const jalankanTool = async function (call) {
    let args = {};
    try {
      args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return { judul: "Argumen JSON rusak", detail: String(call.function?.arguments).slice(0, 300), raw: "Error: argumen bukan JSON valid. Ulangi dengan JSON benar.", ok: false };
    }

    const nama = call.function?.name;
    try {
      switch (nama) {
        case "baca_file": {
          const target = kePath(args.nama_file);
          const isi = await fs.readFile(target, "utf-8");
          return {
            judul: `Baca file → ${args.nama_file} (${isi.split("\n").length} baris)`,
            detail: singkat(isi, 500),
            // Dua lapis potong: 40 KB keras (keamanan), lalu batas konteks
            // dari config (hemat token). Yang ke model hanya versi terpotong;
            // user di layar tetap melihat cuplikan aslinya lewat `detail`.
            raw: potongUntukModel(isi.slice(0, BATAS_BACA_FILE), batasKonteksTool, `isi ${args.nama_file}`),
            ok: true,
          };
        }

        case "tulis_file": {
          const isi = args.isi_kode ?? "";
          const target = kePath(args.nama_file);
          await fs.mkdir(path.dirname(target), { recursive: true });
          let catatan = "";
          try {
            const lama = await fs.readFile(target, "utf-8");
            if (lama !== isi) {
              await pastikanDir();
              const arsip = path.join(DIR_BACKUP, `${path.basename(target)}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`);
              await fs.writeFile(arsip, lama);
              catatan = ` (backup: ${arsip})`;
            }
          } catch { /* file baru */ }
          await fs.writeFile(target, isi);
          const pesan = `Berhasil disimpan ${target} (${isi.length} karakter, ${isi.split("\n").length} baris).${catatan}`;
          return { judul: `Tulis file → ${args.nama_file}`, detail: pesan, raw: pesan, ok: true };
        }

        case "edit_file": {
          const target = kePath(args.nama_file);
          const isi = await fs.readFile(target, "utf-8");
          if (!isi.includes(args.cari)) {
            const pesan = `Gagal: teks yang dicari tidak ditemukan di ${args.nama_file}. Baca ulang file lalu pakai teks persis.`;
            return { judul: `Edit gagal → ${args.nama_file}`, detail: pesan, raw: pesan, ok: false };
          }
          const jumlah = isi.split(args.cari).length - 1;
          const baru = isi.split(args.cari).join(args.ganti);
          await pastikanDir();
          await fs.writeFile(path.join(DIR_BACKUP, `${path.basename(target)}.${Date.now()}.bak`), isi);
          await fs.writeFile(target, baru);
          const pesan = `Berhasil: ${jumlah} penggantian di ${args.nama_file}. Ukuran ${isi.length} → ${baru.length} karakter.`;
          return { judul: `Edit file → ${args.nama_file}`, detail: pesan, raw: pesan, ok: true };
        }

        case "hapus_file": {
          if (!izinkanHapus) return { judul: "Hapus diblokir", detail: "Mode aman aktif.", raw: "Error: penghapusan dinonaktifkan pada mode ini.", ok: false };
          await fs.rm(kePath(args.path), { recursive: true, force: true });
          const pesan = `Terhapus: ${args.path}`;
          return { judul: `Hapus → ${args.path}`, detail: pesan, raw: pesan, ok: true };
        }

        case "eksekusi_terminal": {
          const timeout = Math.min(Math.max(Number(args.timeout_detik) || 120, 1), 900) * 1000;
          try {
            const { stdout, stderr } = await execAsync(args.perintah, {
              cwd, timeout, maxBuffer: 20 * 1024 * 1024,
              shell: SHELL_EKSEKUSI, // deteksi otomatis Termux/Linux (dulu hardcode Termux)
            });
            const keluaran = [stdout, stderr].filter(Boolean).join("\n") || "(tidak ada output)";
            return {
              judul: `Terminal → ${args.perintah}`,
              // detail = yang dilihat USER di layar: tetap panjang (700 char)
              // supaya user tahu output sebenarnya, walau yang ke model dipotong.
              detail: singkat(keluaran, 700),
              raw: potongUntukModel(keluaran.slice(0, BATAS_OUTPUT_TERMINAL), batasKonteksTool, "output terminal"),
              ok: true,
            };
          } catch (e) {
            const keluaran = [e.stdout, e.stderr, `exit code: ${e.code ?? "?"}`, e.message].filter(Boolean).join("\n");
            return { judul: `Terminal gagal → ${args.perintah}`, detail: singkat(keluaran, 700), raw: potongUntukModel(keluaran, batasKonteksTool, "galat terminal"), ok: false };
          }
        }

        case "cek_folder": {
          const target = kePath(args.path_direktori || "./");
          const entri = await fs.readdir(target, { withFileTypes: true });
          const detail = [];
          for (const e of entri) {
            if (e.name === "node_modules" || e.name === ".git") { detail.push(`${e.name}/  (dilewati)`); continue; }
            let ukuran = 0;
            try { ukuran = (await fs.stat(path.join(target, e.name))).size; } catch { /* abaikan */ }
            detail.push(`${e.isDirectory() ? "📁" : "📄"} ${e.name}${e.isFile() ? `  ${(ukuran / 1024).toFixed(1)}K` : ""}`);
          }
          return {
            judul: `Folder → ${args.path_direktori || "./"}`,
            detail: detail.join("\n") || "(kosong)",
            raw: potongUntukModel(`Isi ${target}:\n` + detail.join("\n"), batasKonteksTool, "daftar folder"),
            ok: true,
          };
        }

        case "cari_teks": {
          // Samakan penanganan path dengan tool file lain: "~/x" harus jadi
          // $HOME/x, bukan "<cwd>/~/x" (folder hantu yang tidak pernah ada).
          const folderMentah = String(args.folder ?? "").trim() || "./";
          const folder = path.relative(cwd, kePath(folderMentah)) || ".";
          const pola = String(args.pola ?? "");
          // JANGAN memakai shell di sini. JSON.stringify hanya menambah kutip
          // ganda; di dalam shell, $(...) dan `...` di dalam kutip ganda TETAP
          // dieksekusi → celah injeksi perintah oleh model. Jalankan grep
          // langsung lewat execFile (tanpa shell) agar argumen diperlakukan
          // sebagai data murni.
          try {
            const { stdout } = await execFileAsync(
              "grep",
              ["-rnI", "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.npm", "-m", "5", "--", pola, folder],
              { cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
            );
            let hasil = stdout || "(tidak ditemukan)";
            const baris = hasil.split("\n");
            if (baris.length > 60) hasil = baris.slice(0, 60).join("\n") + `\n…(dipotong, total ${baris.length} baris)`;
            return { judul: `Cari "${pola}"`, detail: singkat(hasil, 600), raw: potongUntukModel(hasil, batasKonteksTool, "hasil grep"), ok: true };
          } catch (e) {
            // exit code 1 dari grep = tidak ada hasil (bukan galat nyata)
            if (e.code === 1) return { judul: `Cari "${pola}"`, detail: "(tidak ditemukan)", raw: "Tidak ada hasil cocok.", ok: true };
            return { judul: `Cari "${pola}" gagal`, detail: e.message, raw: `Error: ${e.message}`, ok: false };
          }
        }

        case "daftar_model": {
          // Katalog LENGKAP (aktif + nonaktif) dengan multiplier Re:Link —
          // multiplier = pengali token terhadap kuota, bukan dolar.
          const katalog = await ambilKatalogLengkap(cfg);
          const baris = katalog.map((m) => {
            const mult = m.multiplier != null ? ` | mult ${m.multiplier}x` : "";
            const status = m.aktif === false ? " | NONAKTIF" : "";
            return `${m.id} | ${m.nama} | ${m.vendor} | ${kapabilitasTampil(m).join(",")}${mult}${status}`;
          });
          const jumlahAktif = katalog.filter((m) => m.aktif !== false).length;
          return {
            judul: `Katalog model (${jumlahAktif} aktif dari ${katalog.length})`,
            detail: baris.slice(0, 12).join("\n") + (baris.length > 12 ? `\n… +${baris.length - 12} model lain` : ""),
            raw: baris.join("\n"),
            ok: true,
          };
        }

        case "ingat": {
          if (!args.fakta || !String(args.fakta).trim()) {
            return { judul: "Ingat", detail: "", raw: "Error: fakta kosong, tidak ada yang disimpan.", ok: false };
          }
          const bagian = args.bagian || "Fakta Penting";
          await tambahMemori(args.fakta, bagian); // satu-satunya implementasi (core/memori)
          return { judul: `Ingat → ${bagian}`, detail: String(args.fakta).slice(0, 200), raw: `Tersimpan di memori (${bagian}).`, ok: true };
        }

        case "baca_memori": {
          const memori = await muatMemori();
          return { judul: "Baca memori", detail: singkat(memori, 400), raw: memori, ok: true };
        }

        case "cari_web": {
          const kueri = encodeURIComponent(args.kueri);
          const res = await fetch(`https://html.duckduckgo.com/html/?q=${kueri}`, {
            headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" },
            signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined,
          });
          const html = await res.text();
          const hasil = [];
          const rx = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
          let m;
          while ((m = rx.exec(html)) && hasil.length < 6) {
            const bersih = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
            hasil.push(`${hasil.length + 1}. ${bersih(m[2])}\n   ${bersih(m[3])}\n   ${m[1]}`);
          }
          const teks = hasil.length ? hasil.join("\n\n") : "(tidak ada hasil — mesin pencari mungkin memblokir)";
          return { judul: `Web → ${args.kueri}`, detail: singkat(teks, 700), raw: teks, ok: true };
        }

        case "ambil_url": {
          const res = await fetch(args.url, {
            headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" },
            signal: AbortSignal.timeout ? AbortSignal.timeout(40000) : undefined,
          });
          const tipe = res.headers.get("content-type") || "";
          const maks = Math.min(Number(args.maks_karakter) || 20000, 60000);
          if (!tipe.includes("text") && !tipe.includes("json") && !tipe.includes("xml")) {
            const ukuran = (await res.arrayBuffer()).byteLength;
            const pesan = `Konten biner (${tipe}), ${ukuran} byte. Gunakan curl + file untuk mengunduh.`;
            return { judul: `URL → ${args.url}`, detail: pesan, raw: pesan, ok: true };
          }
          let teks = await res.text();
          if (tipe.includes("html")) {
            teks = teks.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
          }
          const potong = teks.slice(0, maks);
          return { judul: `URL → ${args.url} (HTTP ${res.status})`, detail: singkat(potong, 600), raw: potongUntukModel(potong, batasKonteksTool, `isi ${args.url}`), ok: true };
        }

        case "baca_gambar": {
          try {
            const siap = await siapkanGambar(args.nama_file, args.instruksi);
            // Sinyal ke agen: sisipkan pesan multipart ini SETELAH hasil tool.
            return {
              judul: `Gambar → ${path.basename(siap.berkas)} (${(siap.bytes / 1024).toFixed(0)} KB)`,
              detail: "Gambar siap dikirim ke model vision pada giliran berikutnya.",
              raw: `Gambar "${siap.berkas}" (${(siap.bytes / 1024).toFixed(0)} KB) berhasil dimuat dan dilampirkan sebagai pesan gambar. Baca isinya pada giliran ini juga — jangan minta user menjelaskan gambarnya.`,
              ok: true,
              // Dipakai agen untuk menyisipkan pesan multipart (bukan JSON).
              pesanGambar: siap.pesan,
            };
          } catch (e) {
            return { judul: "baca_gambar gagal", detail: e.message, raw: `Error: ${e.message}`, ok: false };
          }
        }

        // ── TOOL META: agent membangun & mengelola kemampuannya sendiri ────
        case "bikin_tool": {
          if (!izinkanToolDinamis) {
            return { judul: "bikin_tool diblokir", detail: "Tool dinamis dimatikan.", raw: "Error: pembuatan tool dinonaktifkan pada mode ini.", ok: false };
          }
          const hasil = await simpanTool({
            nama: args.nama,
            deskripsi: args.deskripsi,
            parameter: args.parameter,
            kode: args.kode,
            kategori: args.kategori,
          });
          if (!hasil.ok) {
            return { judul: `bikin_tool gagal → ${args.nama}`, detail: hasil.pesan, raw: `Error: ${hasil.pesan}`, ok: false };
          }
          const pesan = `${hasil.pesan} Tool langsung tersedia pada giliran berikutnya — panggil saja "${args.nama}" untuk mengujinya. Bila perlu perbaiki, gunakan lihat_tool lalu bikin_tool ulang dengan kode yang sama (nama sama = ditimpa).`;
          return { judul: `Tool baru → ${args.nama}`, detail: pesan, raw: pesan, ok: true };
        }

        case "hapus_tool": {
          const hasil = await hapusTool(args.nama);
          return {
            judul: hasil.ok ? `Hapus tool → ${args.nama}` : `Gagal hapus ${args.nama}`,
            detail: hasil.pesan,
            raw: hasil.ok ? hasil.pesan : `Error: ${hasil.pesan}`,
            ok: hasil.ok,
          };
        }

        case "lihat_tool": {
          if (!namaSah(args.nama)) return { judul: "lihat_tool", detail: "", raw: `Error: nama tool tidak sah: "${args.nama}".`, ok: false };
          if (NAMA_BAWAAN.has(args.nama)) {
            return { judul: `lihat_tool → ${args.nama}`, detail: `${args.nama} adalah tool BAWAAN (ada di src/tools/tools.js).`, raw: `${args.nama} adalah tool bawaan; sumbernya di src/tools/tools.js, bukan berkas tool dinamis.`, ok: true };
          }
          try {
            const berkas = path.join(DIR_TOOL, `${args.nama}.tool.js`);
            const isi = await fs.readFile(berkas, "utf-8");
            return { judul: `lihat_tool → ${args.nama}`, detail: singkat(isi, 500), raw: isi, ok: true };
          } catch {
            // Bukan tool dinamis — mungkin tool dinamis gagal dimuat; sebutkan galatnya.
            const galat = galatTool().filter((g) => g.includes(args.nama));
            const pesan = galat.length
              ? `Tool "${args.nama}" gagal dimuat:\n${galat.join("\n")}`
              : `Tool "${args.nama}" tidak ditemukan di ${DIR_TOOL}.`;
            return { judul: `lihat_tool → ${args.nama}`, detail: pesan, raw: `Error: ${pesan}`, ok: false };
          }
        }

        default: {
          // ── FALLBACK: tool dinamis buatan agent ─────────────────────────
          // Tool bawaan tidak dikenali di switch, coba cari di registry.
          if (izinkanToolDinamis && namaSah(nama) && !NAMA_BAWAAN.has(nama)) {
            const dinamis = await muatToolDinamis();
            const t = dinamis.find((x) => x.meta.nama === nama);
            if (t) {
              try {
                const keluaran = await t.jalankan(args, ctxTool);
                const b = keluaran && typeof keluaran === "object" ? keluaran : { raw: String(keluaran) };
                return {
                  judul: b.judul || `Tool dinamis → ${nama}`,
                  detail: b.detail ?? singkat(String(b.raw ?? ""), 500),
                  raw: b.raw ?? "",
                  ok: b.ok !== false,
                };
              } catch (e) {
                const pesan = `Tool dinamis "${nama}" gagal: ${e.message}. Perbaiki dengan lihat_tool lalu bikin_tool ulang.`;
                return { judul: `Tool dinamis gagal → ${nama}`, detail: e.message, raw: `Error: ${pesan}`, ok: false };
              }
            }
          }
          return { judul: `Tool tidak dikenal: ${nama}`, detail: "", raw: `Error: tool "${nama}" tidak dikenal.`, ok: false };
        }
      }
    } catch (e) {
      return { judul: `Tool gagal: ${nama}`, detail: e.message, raw: `Error: ${e.message}`, ok: false };
    }
  };

  // Dipasang setelah deklarasi fungsi (hoisting tidak berlaku untuk properti).
  jalankanTool.ambilGambarTerakhir = ambilGambarTerakhir;
  return jalankanTool;
}

export { HOME, DIR_TOOL, BATAS_GAMBAR };
// Re-ekspor supaya pemanggil lama (index.js) tetap bisa memakai jalur async
// tanpa harus tahu ada modul registry di baliknya.
export { daftarToolDinamis, galatTool };
