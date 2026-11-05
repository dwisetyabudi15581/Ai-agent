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
          const potong = isi.length > BATAS_BACA_FILE;
          return {
            judul: `Baca file → ${args.nama_file} (${isi.split("\n").length} baris)`,
            detail: singkat(isi, 500),
            raw: potong ? isi.slice(0, BATAS_BACA_FILE) + `\n…(dipotong, total ${isi.length} karakter)` : isi,
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
              detail: singkat(keluaran, 700),
              raw: keluaran.length > BATAS_OUTPUT_TERMINAL ? keluaran.slice(0, BATAS_OUTPUT_TERMINAL) + `\n…(dipotong, total ${keluaran.length} karakter)` : keluaran,
              ok: true,
            };
          } catch (e) {
            const keluaran = [e.stdout, e.stderr, `exit code: ${e.code ?? "?"}`, e.message].filter(Boolean).join("\n");
            return { judul: `Terminal gagal → ${args.perintah}`, detail: singkat(keluaran, 700), raw: keluaran.slice(0, BATAS_OUTPUT_TERMINAL), ok: false };
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
            raw: `Isi ${target}:\n` + detail.join("\n"),
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
            return { judul: `Cari "${pola}"`, detail: singkat(hasil, 600), raw: hasil, ok: true };
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
          return { judul: `URL → ${args.url} (HTTP ${res.status})`, detail: singkat(potong, 600), raw: potong, ok: true };
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
