// ============ INTI AGEN: LOOP TOOL-CALLING ============
import fs from "fs/promises";
import path from "path";
import { C, bubble, mulaiMengetik } from "../ui/util.js";
import { DIR_DATA } from "../paths.js";
import { panggilChat } from "../api/klien.js";
import { ambilKatalog } from "../api/katalog.js";
import { systemPrompt } from "./prompt.js";
import { muatMemori, sisipkanMemori } from "./memori.js";
import { ringkasRiwayat, ukuranRiwayat } from "./sesi.js";
import { pilihModel } from "./router.js";
import { PenulisStream } from "../ui/tampilan.js";

// Tool yang menyentuh satu file/folder tertentu → perlu kunci agar tidak saling menimpa.
const TOOL_KE_FILE = ["baca_file", "tulis_file", "edit_file", "hapus_file", "cek_folder"];

/**
 * Tebak apakah model hanya memutar jawaban (tidak ada kemajuan).
 * Dipakai agar agent berhenti lebih awal bila jelas mentok, bukan hanya
 * karena hitungan putaran habis.
 */
function terlihatMentok(pesan) {
  const teks = String(pesan?.content || "").toLowerCase();
  if (!teks) return false;
  const pola = [
    /sepertinya (saya )?(tidak|belum|masih)/,
    /tidak ada (perubahan|kemajuan|yang berubah)/,
    /saya (masih|kembali) (mencoba|memeriksa|mengulang)/,
    /percobaan (ke|ulang)/,
    /mohon bersabar/,
  ];
  return pola.some((p) => p.test(teks));
}

export async function buatAgen({ cfg, tools, eksekusiTool, sesi }) {
  // Batas putaran/tool kini dari konfigurasi (dulu konstanta mati 20/50
  // sehingga cfg.maksPutaran & cfg.maksTool tidak berpengaruh).
  // 0 = TANPA BATAS → Infinity. Loop tetap punya rem pengaman:
  //  (a) selesai saat model berhenti memanggil tool,
  //  (b) berhenti saat terlihatMentok() dua putaran beruntun,
  //  (c) dibatalkan user via Ctrl-C (SIGINT ditangani index.js).
  const batasPutaran =
    Number(cfg.maksPutaran) === 0 ? Infinity : Number(cfg.maksPutaran) || Infinity;
  const batasTotalTool =
    Number(cfg.maksTool) === 0 ? Infinity : Number(cfg.maksTool) || Infinity;

  // System prompt disusun ulang tiap giliran agar memori & waktu tetap segar
  async function siapkanMessages(mode) {
    const memori = await muatMemori();
    const sys = { role: "system", content: sisipkanMemori(systemPrompt(cfg, mode), memori) };
    const riwayat = sesi.messages.filter((m) => m.role !== "system");
    sesi.messages = [sys, ...riwayat];
  }

  async function autoCompact() {
    if (!cfg.autoCompact) return;
    const ukuran = ukuranRiwayat(sesi.messages);
    if (ukuran <= cfg.batasKonteks) return;
    const stop = mulaiMengetik("Meringkas riwayat lama");
    try {
      sesi.messages = await ringkasRiwayat(cfg, sesi.messages, { simpan: 8 });
      bubble("info", `Riwayat diringkas otomatis (${ukuran} → ${ukuranRiwayat(sesi.messages)} karakter).`);
    } catch {
      /* gagal meringkas: biarkan apa adanya */
    } finally {
      stop();
    }
  }

  /**
   * Pilih model untuk giliran ini.
   *
   * Aturan penting: model ditentukan SEKALI di awal giliran, lalu dipakai
   * untuk semua putaran tool-calling di dalam giliran itu. Alasannya, putaran
   * lanjutan masih menyelesaikan satu tugas yang sama — berganti model di
   * tengah jalan justru membuang konteks gaya/format jawaban.
   *
   * Return: id model (atau null bila router tidak dipakai).
   */
  async function tentukanModel(teksUser) {
    if (cfg.routingOtomatis === false) return null;   // fitur dimatikan user
    if (cfg.modelTerkunci) return null;               // user memilih eksplisit (/model, --model)
    try {
      const katalog = await ambilKatalog(cfg);
      const pilihan = pilihModel({
        katalog,
        teks: teksUser,
        ukuranRiwayat: ukuranRiwayat(sesi.messages),
        cfg,
      });
      if (!pilihan) return null;
      // Tidak perlu lapor bila modelnya sama dengan yang sudah aktif.
      if (pilihan.id !== cfg.model) {
        const tanda = pilihan.hemat ? "hemat" : "kuat";
        bubble("info", `Router → ${pilihan.id} [${pilihan.tingkat}/${tanda}] ${pilihan.alasan}`);
      }
      return pilihan.id;
    } catch {
      return null; // katalog gagal → pakai cfg.model seperti biasa
    }
  }

  /** Satu giliran user: panggil model → jalankan tool → ulangi sampai selesai. */
  async function giliran(mode = "auto", teksUser = "") {
    await siapkanMessages(mode);
    await autoCompact();

    // Model untuk seluruh giliran ini (null = pakai cfg.model apa adanya).
    const modelGiliran = (await tentukanModel(teksUser)) || cfg.model;

    let putaran = 0;
    let totalTool = 0;
    let tokenMasuk = 0;
    let tokenKeluar = 0;

    let jawabanTerakhir = "";
    let mentokBeruntun = 0;

    while (putaran++ < batasPutaran) {
      const penulis = new PenulisStream();
      const stop = mulaiMengetik(putaran === 1 ? "Agent berpikir" : `Lanjut · putaran ${putaran}`);
      let sudahTulis = false;
      const mulaiTulis = () => {
        if (!sudahTulis) { stop(); sudahTulis = true; }
      };

      let hasil;
      try {
        hasil = await panggilChat(cfg, sesi.messages, tools, {
          stream: cfg.streamDefault !== false,
          model: modelGiliran,
          maxTokens: cfg.maxTokens,
          suhu: cfg.suhu,
          onToken: (k) => { mulaiTulis(); penulis.tulis(k); },
          onReasoning: cfg.verbose ? (r) => process.stdout.write(`${C.gray}${C.dim}${r}${C.reset}`) : null,
        });
        mulaiTulis();
      } catch (e) {
        stop();
        penulis.akhiri();
        bubble("error", e.message);
        return { gagal: true };
      }
      // Non-stream: teks tidak pernah lewat onToken — tulis lewat penulis
      // yang sama agar format markdown tetap konsisten dengan mode streaming.
      if (hasil.stream === false && String(hasil.pesan?.content || "")) {
        penulis.tulis(String(hasil.pesan.content));
      }
      penulis.akhiri();

      if (hasil.model && hasil.model !== modelGiliran) {
        bubble("info", `Model ${modelGiliran} sedang tidak merespons — jawaban ini dari ${hasil.model}.`);
      }

      if (hasil.usage) {
        tokenMasuk += hasil.usage.prompt_tokens || 0;
        tokenKeluar += hasil.usage.completion_tokens || 0;
      }

      const pesan = hasil.pesan;
      sesi.messages.push(pesan);

      jawabanTerakhir = String(pesan.content || "").trim();

      if (!pesan.tool_calls?.length) {
        if (cfg.verbose) bubble("info", `selesai · ${tokenMasuk} token masuk / ${tokenKeluar} keluar · ${hasil.model || cfg.model}`);
        return { selesai: true };
      }

      // Deteksi putaran sia-sia: model berhenti memanggil tool, atau mengulang
      // pernyataan yang sama tanpa kemajuan.
      mentokBeruntun = terlihatMentok(pesan) ? mentokBeruntun + 1 : 0;
      if (mentokBeruntun >= 2) {
        bubble("info", "Agent berhenti: tidak ada kemajuan pada dua putaran terakhir. Beri arahan lebih spesifik atau pecah tugasnya.");
        return { selesai: jawabanTerakhir.length > 0 };
      }

      // ── JALANKAN TOOL SECARA PARALEL ──────────────────────────────────────
      // Model sering memanggil beberapa tool sekaligus (baca_file + cek_folder +
      // cari_teks). Dulu dijalankan satu per satu (for...of + await), padahal
      // panggilan itu saling bebas → total waktu = jumlah waktu tiap tool.
      // Sekarang dijalankan bersamaan; hasil tetap ditulis ke sesi.messages
      // SESUAI URUTAN tool_calls agar pasangan tool_call_id tidak tertukar.
      const daftarCall = pesan.tool_calls;
      const sisaSlot = Math.max(0, batasTotalTool - totalTool);
      const dijalankan = daftarCall.slice(0, sisaSlot);
      const ditolak = daftarCall.slice(sisaSlot);
      totalTool += dijalankan.length;

      // Beberapa tool menulis ke file yang sama → beri jeda bergiliran supaya
      // tidak saling menimpa (mis. tulis_file & edit_file pada file identik).
      const kunciFile = new Map(); // path absolut → Promise rilis
      const normalKunci = (t) => {
        try { return path.resolve(process.cwd(), String(t)); } catch { return String(t); }
      };
      const kunciDari = (call) => {
        let a = {};
        try { a = JSON.parse(call.function?.arguments || "{}") || {}; } catch { /* biarkan */ }
        const target = a.nama_file || a.path || a.path_direktori;
        if (!target) return null;
        const nama = call.function?.name;
        if (!TOOL_KE_FILE.includes(nama)) return null;
        return normalKunci(target);
      };
      // Mutex per path: panggilan kedua menunggu (await) rilis panggilan pertama.
      // Rantai sinkron: cek + pasang terjadi TANPA await di antaranya,
      // sehingga dua panggilan tidak mungkin sama-sama lolos.
      const ambilKunci = (kunci) => {
        const ekor = kunciFile.get(kunci) || Promise.resolve();
        let rilis;
        const giliran = new Promise((r) => { rilis = r; });
        kunciFile.set(kunci, giliran);
        return ekor.then(() => () => {
          rilis();
          if (kunciFile.get(kunci) === giliran) kunciFile.delete(kunci);
        });
      };

      const stopParalel = dijalankan.length > 1
        ? mulaiMengetik(`Menjalankan ${dijalankan.length} tool paralel`)
        : null;

      const hasilParalel = await Promise.all(
        dijalankan.map(async (call) => {
          const kunci = kunciDari(call);
          const rilis = kunci ? await ambilKunci(kunci) : null; // tunggu giliran bila file sedang dipakai
          try {
            return await eksekusiTool(call);
          } catch (e) {
            return { judul: `Tool gagal: ${call.function?.name}`, detail: e.message, raw: `Error: ${e.message}`, ok: false };
          } finally {
            if (rilis) rilis();
          }
        }),
      );
      if (stopParalel) stopParalel();

      // Tulis hasil berurutan sesuai urutan panggilan asli
      dijalankan.forEach((call, i) => {
        const keluar = hasilParalel[i] || { raw: "Error: hasil tool kosong." };
        bubble("tool", keluar);
        sesi.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content: keluar.raw ?? keluar.detail ?? "",
        });
      });

      for (const call of ditolak) {
        const berhenti = `Error: batas ${batasTotalTool} eksekusi tool tercapai dalam satu giliran. Pecah tugasnya.`;
        sesi.messages.push({ role: "tool", tool_call_id: call.id, name: call.function?.name, content: berhenti });
        bubble("error", berhenti);
      }

      // REM PENGAMAN: bila SEMUA panggilan putaran ini ditolak (kuota tool
      // sudah habis), tidak ada kemajuan yang mungkin terjadi. Putaran
      // berikutnya hanya akan meminta tool lagi dan ditolak lagi — bila
      // maksPutaran = 0 (tanpa batas), itu loop abadi yang membengkakkan
      // riwayat tanpa guna. Hentikan sekarang.
      if (dijalankan.length === 0 && ditolak.length > 0) {
        bubble("info", `Berhenti: kuota ${batasTotalTool} eksekusi tool per giliran sudah habis. Naikkan dengan /maksTool <n> (0 = tanpa batas) atau pecah tugasnya.`);
        return { selesai: jawabanTerakhir.length > 0, mentok: true };
      }
    }

    // Batas tercapai BUKAN kegagalan total: pekerjaan yang sudah dilakukan tetap
    // tersimpan di riwayat. Beri tahu user cara melanjutkan, jangan buang konteks.
    const label = batasPutaran === Infinity ? "Tak terbatas" : `Batas ${batasPutaran}`;
    bubble("info", `${label} putaran tercapai untuk satu giliran. Hasil sejauh ini tetap tersimpan — lanjutkan dengan meminta langkah berikutnya atau pecah tugasnya.`);
    return { selesai: jawabanTerakhir.length > 0, mentok: true };
  }

  return { giliran };
}

// Simpan transkrip penuh untuk audit
export async function arsipkanTranskrip(sesi) {
  try {
    const dir = path.join(DIR_DATA, "transkrip");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${sesi.id}.json`), JSON.stringify(sesi, null, 2));
  } catch { /* opsional */ }
}
