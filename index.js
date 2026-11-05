/**
 * INDEX.JS — Agent Termux v3.2
 * AI Agent otonom + teman ngobrol, powered by Re:Link Gateway.
 *
 * Jalankan:  node index.js
 * Flag:
 *   --teman           mode teman ngobrol (eksekusi perintah dibatasi)
 *   --model <id>      set model awal (mengunci — router tidak menimpanya)
 *   --router          paksa router model otomatis aktif (timpa kunci lama)
 *   --no-stream       non-streaming
 *   --verbose         tampilkan usage & reasoning
 *   --putaran <n>     batas putaran tool per giliran (0 = TANPA BATAS, default)
 *   --makstool <n>    batas total eksekusi tool per giliran (0 = TANPA BATAS, default)
 *   --max <n>         batas jumlah giliran user (otomatis/robot)
 *
 * Struktur kode ada di src/:
 *   src/config  — konfigurasi & daftar URL host
 *   src/api     — klien HTTP, katalog model, preset 42 model Re:Link
 *   src/core    — agen (loop tool-calling), router model, prompt, sesi, memori
 *   src/tools   — definisi + eksekusi tool untuk model
 *   src/ui      — tampilan terminal, input, penjaga keluar
 */
import { C, bubble, tulis } from "./src/ui/util.js";
import { muatConfig, simpanConfig } from "./src/config/config.js";
import { daftarTools, buatEksekutor } from "./src/tools/tools.js";
import { ambilKatalog, ambilKatalogLengkap, infoPreset } from "./src/api/katalog.js";
import { panaskanFetch } from "./src/api/klien.js";
import { buatAgen, arsipkanTranskrip } from "./src/core/agen.js";
import { idSesiBaru, daftarSesi, simpanSesi, muatSesi, ringkasRiwayat } from "./src/core/sesi.js";
import { muatMemori, simpanMemori, BERKAS_MEMORI, KERANGKA_MEMORI } from "./src/core/memori.js";
import { panel, pilihModel } from "./src/ui/tampilan.js";
import { mulaiInput, tanyaTeks, tutupInput } from "./src/ui/input.js";
import { siapkanKeluar, keluarAman } from "./src/ui/keluar.js";

// ===================== ARGUMEN =====================
const argv = process.argv.slice(2);
const flag = (nama) => argv.includes(`--${nama}`);
const nilai = (nama) => {
  const i = argv.indexOf(`--${nama}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

// ===================== SETUP =====================
const cfg = await muatConfig();
if (nilai("model")) {
  cfg.model = nilai("model");
  // Pilihan eksplisit = kunci: router otomatis tidak boleh menimpanya.
  cfg.modelTerkunci = true;
}
if (flag("router")) cfg.modelTerkunci = false; // paksa kembali otomatis
if (flag("no-stream")) cfg.streamDefault = false;
if (flag("verbose")) cfg.verbose = true;
// --putaran <n> / --makstool <n> : 0 = tanpa batas (default).
if (nilai("putaran") !== undefined) {
  const n = Number(nilai("putaran"));
  if (Number.isFinite(n) && n >= 0) cfg.maksPutaran = n === 0 ? 0 : Math.min(n, 10000);
}
if (nilai("makstool") !== undefined) {
  const n = Number(nilai("makstool"));
  if (Number.isFinite(n) && n >= 0) cfg.maksTool = n === 0 ? 0 : Math.min(n, 10000);
}
// --max <n> membatasi jumlah giliran user dalam satu sesi interaktif.
const batasGiliran = Number(nilai("max")) || Infinity;

if (!cfg.apiKey) {
  tulis(`${C.red}API key Re:Link belum ada.${C.reset}`);
  tulis(`${C.gray}Set: export RELINK_API_KEY=sk-...  atau isi ~/.agent-termux/config.json${C.reset}`);
  process.exit(1);
}

let mode = flag("teman") ? "teman" : "auto";

const sesi = { id: idSesiBaru(), judul: "", model: cfg.model, dibuat: new Date().toISOString(), messages: [] };

const tools = daftarTools();
const eksekusiTool = buatEksekutor(cfg, { cwd: process.cwd(), izinkanHapus: true });
const agen = await buatAgen({ cfg, tools, eksekusiTool, sesi });

// ===================== LAYAR =====================
function header() {
  const lebar = Math.min(process.stdout.columns || 80, 100) - 4;
  const garisAtas = "═".repeat(Math.max(lebar, 40));
  console.clear();
  tulis(`${C.cyan}${garisAtas}${C.reset}`);
  tulis(`${C.bold}${C.cyan}  🤖  AGENT TERMUX v3.2${C.reset}`);
  const router = cfg.modelTerkunci
    ? "manual (dikunci)"
    : cfg.routingOtomatis ? "otomatis" : "mati";
  tulis(`${C.gray}  model: ${C.reset}${C.bold}${cfg.model}${C.reset}${C.gray} · router: ${C.reset}${C.bold}${router}${C.reset}${C.gray} · mode: ${C.reset}${C.bold}${mode === "teman" ? "teman ngobrol" : "agen otonom"}${C.reset}${C.gray} · sesi: ${sesi.id}${C.reset}`);
  tulis(`${C.cyan}${garisAtas}${C.reset}`);
  tulis(`${C.gray}  /help daftar perintah · /model ganti model · /router setelan otomatis · /quit keluar${C.reset}`);
}

function bantuan() {
  panel("PERINTAH", [
    `${C.bold}/model${C.reset} ${C.gray}[semua|nomor|id|cari <kata>]${C.reset}  ganti model AI`,
    `${C.bold}/router${C.reset} ${C.gray}[on|off]${C.reset}   model dipilih otomatis per giliran`,
    `${C.bold}/tools${C.reset}            daftar kemampuan agent`,
    `${C.bold}/memori${C.reset}           lihat memori jangka panjang`,
    `${C.bold}/lupakan${C.reset}          hapus semua memori`,
    `${C.bold}/sesi${C.reset}             daftar sesi tersimpan`,
    `${C.bold}/lanjut <id>${C.reset}      buka sesi lama`,
    `${C.bold}/simpan${C.reset} ${C.gray}|${C.reset} ${C.bold}/baru${C.reset}     simpan / mulai sesi baru`,
    `${C.bold}/ringkas${C.reset}          ringkas riwayat sekarang`,
    `${C.bold}/teman${C.reset} ${C.gray}|${C.reset} ${C.bold}/agen${C.reset}     ganti mode`,
    `${C.bold}/stream${C.reset} ${C.gray}|${C.reset} ${C.bold}/nostream${C.reset}  mode balasan`,
    `${C.bold}/suhu <0-2>${C.reset}      kreativitas`,
    `${C.bold}/maxtoken <n>${C.reset}    batas panjang jawaban`,
    `${C.bold}/putaran <n|0>${C.reset}    batas putaran/giliran (0 = tanpa batas)`,
    `${C.bold}/maksTool <n|0>${C.reset}    batas total tool/giliran (0 = tanpa batas)`,
    `${C.bold}/verbose${C.reset}          info token & reasoning`,
    `${C.bold}/biaya${C.reset}            estimasi kuota token sesi ini`,
    `${C.bold}/clear${C.reset} ${C.gray}|${C.reset} ${C.bold}/quit${C.reset}       bersihkan layar / keluar`,
  ]);
}

// ===================== PERINTAH =====================
async function tanganiPerintah(input) {
  const [perintah, ...sisa] = input.slice(1).trim().split(/\s+/);
  const arg = sisa.join(" ").trim();

  switch ((perintah || "").toLowerCase()) {
    case "help": case "bantuan": case "?":
      bantuan();
      return true;

    case "model": {
      let katalog;
      try {
        katalog = await ambilKatalogLengkap(cfg);
      } catch (e) {
        bubble("error", `Tidak bisa ambil katalog: ${e.message}`);
        return true;
      }
      const jumlahAktif = katalog.filter((m) => m.aktif !== false).length;

      const pasang = async (m) => {
        cfg.model = m.id;
        sesi.model = m.id;
        cfg.modelTerkunci = true; // pilihan eksplisit → router menyerah
        await simpanConfig(cfg);
        bubble("sukses", `Model aktif → ${m.id}${m.multiplier != null ? ` (mult ${m.multiplier}x)` : ""} — dikunci; /router on untuk otomatis lagi.`);
        header();
      };

      // `/model semua [cari kata]` → tampilkan seluruh 42 model (nonaktif ditandai ✗)
      const kata = arg.split(/\s+/).filter(Boolean);
      const modeSemua = kata[0]?.toLowerCase() === "semua";
      if (modeSemua) kata.shift();
      const sisaArg = kata.join(" ").trim();

      if (sisaArg && !/^cari\b/i.test(sisaArg)) {
        if (/^\d+$/.test(sisaArg)) {
          // nomor mengikuti penomoran daftar AKTIF (sama seperti menu default)
          const aktif = katalog.filter((m) => m.aktif !== false);
          const m = aktif[Number(sisaArg) - 1];
          if (m) { await pasang(m); return true; }
          bubble("error", `Nomor ${sisaArg} tidak ada di daftar model aktif.`);
          return true;
        }
        const cocok = katalog.find((m) => m.id === sisaArg || (m.nama || "").toLowerCase() === sisaArg.toLowerCase());
        if (!cocok) { bubble("error", `Model "${sisaArg}" tidak ada di katalog (${jumlahAktif} aktif dari ${katalog.length}).`); return true; }
        if (cocok.aktif === false) { bubble("error", `Model "${cocok.id}" sedang NONAKTIF di gateway — tidak bisa dipilih.`); return true; }
        await pasang(cocok);
        return true;
      }

      // dasar = daftar untuk ditampilkan: semua model, atau aktif saja
      const dasar = modeSemua ? katalog : katalog.filter((m) => m.aktif !== false);
      const carian = /^cari\b/i.test(sisaArg)
        ? dasar.filter((m) => (m.id + " " + m.nama + " " + m.vendor).toLowerCase().includes(sisaArg.replace(/^cari\s*/i, "").toLowerCase()))
        : dasar;
      const info = modeSemua
        ? { jumlahAktif, jumlahTotal: katalog.length }
        : katalog.length === jumlahAktif ? { jumlahAktif } : { jumlahAktif, jumlahTotal: katalog.length };

      const pilih = await pilihModel(carian.length ? carian : dasar, cfg.model, info);
      if (pilih) await pasang(pilih);
      else header();
      return true;
    }

    case "router": {
      const sub = (arg || "").toLowerCase();
      if (sub === "on" || sub === "aktif" || sub === "ya") {
        cfg.routingOtomatis = true;
        cfg.modelTerkunci = false;
        await simpanConfig(cfg);
        bubble("sukses", "Router otomatis AKTIF — model dipilih per giliran sesuai kesulitan tugas.");
      } else if (sub === "off" || sub === "mati" || sub === "no") {
        cfg.routingOtomatis = false;
        await simpanConfig(cfg);
        bubble("info", "Router otomatis MATI — semua giliran memakai model aktif.");
      } else {
        panel("ROUTER MODEL OTOMATIS", [
          `${C.gray}status${C.reset} ${cfg.modelTerkunci ? "manual — model dikunci user" : cfg.routingOtomatis ? "aktif — model dipilih per giliran" : "mati"}`,
          `${C.gray}cara kerja${C.reset} obrolan ringan → model termurah; tugas teknis → kelas menengah; tugas berat → kelas kuat`,
          `${C.gray}biaya${C.reset} diperingkat lewat multiplier token tiap model (katalog Re:Link)`,
          `${C.gray}atur${C.reset} ${C.bold}/router on${C.reset} aktifkan · ${C.bold}/router off${C.reset} matikan`,
          `${C.gray}catatan${C.reset} /model <pilih> selalu mengunci model; /router on membuka kunci`,
        ]);
      }
      return true;
    }

    case "tools":
      panel("KEMAMPUAN AGENT", tools.map((t) => `${C.cyan}•${C.reset} ${C.bold}${t.function.name}${C.reset} ${C.gray}— ${t.function.description}${C.reset}`));
      return true;

    case "memori": {
      const m = await muatMemori();
      panel(`MEMORI · ${BERKAS_MEMORI}`, m.split("\n"));
      return true;
    }

    case "lupakan": {
      await simpanMemori(KERANGKA_MEMORI);
      bubble("sukses", "Memori dihapus.");
      return true;
    }

    case "sesi": {
      const daftar = await daftarSesi();
      if (!daftar.length) { bubble("info", "Belum ada sesi tersimpan."); return true; }
      panel("SESI TERSIMPAN", daftar.map((s) => `${C.cyan}${s.id}${C.reset} ${C.gray}│ ${s.pesan} pesan │ ${(s.judul || "-").slice(0, 36)} │ ${s.model}${C.reset}`));
      return true;
    }

    case "lanjut": {
      if (!arg) { bubble("error", "Pakai: /lanjut <id-sesi>"); return true; }
      try {
        const lama = await muatSesi(arg);
        Object.assign(sesi, { id: lama.id, judul: lama.judul, dibuat: lama.dibuat, messages: lama.messages || [] });
        if (lama.model) { cfg.model = lama.model; sesi.model = lama.model; }
        bubble("sukses", `Sesi ${sesi.id} dimuat (${sesi.messages.filter((m) => m.role === "user").length} pesan user).`);
        header();
      } catch {
        bubble("error", `Sesi "${arg}" tidak ditemukan.`);
      }
      return true;
    }

    case "simpan":
      await simpanSesi(sesi);
      bubble("sukses", `Sesi disimpan: ${sesi.id}`);
      return true;

    case "baru":
      await simpanSesi(sesi);
      Object.assign(sesi, { id: idSesiBaru(), judul: "", dibuat: new Date().toISOString(), messages: [] });
      header();
      bubble("sukses", "Sesi baru dimulai.");
      return true;

    case "ringkas": {
      const sebelum = sesi.messages.length;
      sesi.messages = await ringkasRiwayat(cfg, sesi.messages, { simpan: 8 });
      bubble("sukses", `Riwayat diringkas: ${sebelum} → ${sesi.messages.length} pesan.`);
      return true;
    }

    case "teman": case "agen":
      mode = perintah.toLowerCase() === "teman" ? "teman" : "auto";
      bubble("sukses", `Mode: ${mode === "teman" ? "teman ngobrol" : "agen otonom"}`);
      return true;

    case "stream":
      cfg.streamDefault = true;
      bubble("sukses", "Streaming aktif.");
      return true;

    case "nostream":
      cfg.streamDefault = false;
      bubble("info", "Non-streaming aktif (aman untuk model berat).");
      return true;

    case "suhu": {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0 || n > 2) { bubble("error", "Suhu harus 0–2."); return true; }
      cfg.suhu = n;
      await simpanConfig(cfg);
      bubble("sukses", `Suhu = ${n}`);
      return true;
    }

    case "maxtoken": {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 64) { bubble("error", "minimal 64."); return true; }
      cfg.maxTokens = Math.min(n, 131072);
      await simpanConfig(cfg);
      bubble("sukses", `max_tokens = ${cfg.maxTokens}`);
      return true;
    }

    // 0 = tanpa batas. Selain itu dibatasi 1..10000 sebagai rem pengaman.
    case "putaran": {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0) { bubble("error", "Pakai angka ≥ 0 (0 = tanpa batas)."); return true; }
      const nilai = n === 0 ? 0 : Math.min(n, 10000);
      cfg.maksPutaran = nilai;
      await simpanConfig(cfg);
      bubble("sukses", nilai === 0 ? "Putaran: TANPA BATAS (berhenti saat tugas selesai)." : `Putaran per giliran = ${nilai}`);
      return true;
    }

    case "makstool": {
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 0) { bubble("error", "Pakai angka ≥ 0 (0 = tanpa batas)."); return true; }
      const nilai = n === 0 ? 0 : Math.min(n, 10000);
      cfg.maksTool = nilai;
      await simpanConfig(cfg);
      bubble("sukses", nilai === 0 ? "Total tool: TANPA BATAS." : `Total tool per giliran = ${nilai}`);
      return true;
    }

    case "batas": {
      const p = cfg.maksPutaran === 0 ? "tanpa batas" : cfg.maksPutaran;
      const t = cfg.maksTool === 0 ? "tanpa batas" : cfg.maksTool;
      bubble("info", `Putaran per giliran: ${p} · Total tool per giliran: ${t}`);
      return true;
    }

    case "verbose":
      cfg.verbose = !cfg.verbose;
      bubble("sukses", `Verbose: ${cfg.verbose ? "aktif" : "mati"}`);
      return true;

    case "biaya": {
      try {
        const katalog = await ambilKatalog(cfg);
        const m = katalog.find((x) => x.id === cfg.model);
        const teks = sesi.messages.map((x) => String(x.content || "")).join(" ");
        const masuk = teks.length / 4;
        const keluar = sesi.messages.filter((x) => x.role === "assistant").reduce((n, x) => n + String(x.content || "").length / 4, 0);
        const mult = m?.multiplier ?? 1;
        const kuota = (masuk + keluar) * mult;
        const baris = [
          `${C.gray}model${C.reset} ${cfg.model}${m?.multiplier != null ? ` (multiplier ${m.multiplier}x)` : ""}`,
          `${C.gray}token (perkiraan)${C.reset} masuk ${masuk.toFixed(0)} · keluar ${keluar.toFixed(0)}`,
          `${C.gray}kuota terpotong${C.reset} (masuk + keluar) × ${mult}x ≈ ${Math.round(kuota).toLocaleString("id-ID")} token`,
        ];
        // Penyedia lain (baseCadangan) mungkin memakai harga dolar per juta token.
        if (m && (m.harga.input > 0 || m.harga.output > 0)) {
          baris.push(`${C.gray}estimasi dolar${C.reset} $${(((m.harga.input || 0) * masuk + (m.harga.output || 0) * keluar) / 1e6).toFixed(4)}`);
        }
        baris.push(`${C.gray}catatan${C.reset} Re:Link memakai token prabayar × multiplier — cek dashboard untuk angka pasti`);
        panel("ESTIMASI PEMAKAIAN SESI", baris);
      } catch (e) { bubble("error", e.message); }
      return true;
    }

    case "clear": case "cls":
      header();
      return true;

    case "quit": case "exit": case "keluar":
      tutupInput();
      await keluarAman("quit", 0); // simpan + arsip + pesan perpisahan sekaligus
      return true;

    default:
      bubble("error", `Perintah "/${perintah}" tidak dikenal. Ketik /help.`);
      return true;
  }
}

// ===================== LOOP UTAMA =====================
async function main() {
  // Panaskan fetch selagi user membaca header/mengetik: fetch pertama di
  // Termux butuh ~1 detik, dan itu tidak boleh terasa di pesan pertama.
  panaskanFetch();
  mulaiInput();
  header();
  // Info preset singkat saat offline (katalog live gagal → fallback snapshot).
  try {
    const katalog = await ambilKatalogLengkap(cfg);
    if (katalog.length && katalog.every((m) => m.dariPreset)) {
      const { tanggal } = infoPreset();
      bubble("info", `Gateway tidak bisa dihubungi — memakai katalog preset ${tanggal} (${katalog.filter((m) => m.aktif !== false).length} model aktif).`);
    }
  } catch { /* abaikan: hanya info */ }
  let giliran = 0;

  while (true) {
    const input = await tanyaTeks(`\n${C.bold}${C.green}👤 ${cfg.namaUser}${C.reset} ${C.gray}›${C.reset} `);
    if (input === null) { // EOF / Ctrl+D
      tutupInput();
      await keluarAman("Ctrl+D", 0);
      return;
    }

    const teks = input.trim();
    if (!teks) continue;

    if (teks.startsWith("/")) {
      await tanganiPerintah(teks);
      continue;
    }

    if (giliran >= batasGiliran) {
      tulis(`${C.yellow}Batas ${batasGiliran} giliran tercapai.${C.reset}`);
      break;
    }

    if (!sesi.judul) sesi.judul = teks.slice(0, 60);
    sesi.messages.push({ role: "user", content: teks });
    bubble("user", teks);

    const hasilGiliran = await agen.giliran(mode);
    if (hasilGiliran?.mentok) {
      // Riwayat tetap disimpan; user bisa langsung minta lanjutan tanpa kehilangan konteks.
      bubble("info", "Ketik instruksi lanjutan untuk meneruskan pekerjaan ini.");
    }
    giliran++;
    await simpanSesi(sesi);
  }

  tutupInput();
  await keluarAman("batas giliran", 0);
}

// Daftarkan sesi ke penjaga keluar SEBELUM loop jalan, supaya Ctrl+C pada
// giliran mana pun (termasuk saat model sedang menjawab) tetap tersimpan.
siapkanKeluar(sesi, arsipkanTranskrip);

main().catch(async (e) => {
  tulis(`${C.red}Fatal: ${e?.stack || e?.message || e}${C.reset}`);
  tutupInput();
  await keluarAman("galat fatal", 1);
});
