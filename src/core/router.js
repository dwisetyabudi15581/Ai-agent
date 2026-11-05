// ============ ROUTER MODEL OTOMATIS ============
// Memilih model berdasarkan kebutuhan giliran: biaya, kemampuan tool-calling,
// panjang konteks, dan sinyal tugas. Tujuannya menghemat kuota tanpa
// mengorbankan tugas yang memang butuh model kuat.
//
// Prinsip desain:
//  1. KEPUTUSAN HARUS BISA DIJELASKAN. Setiap pilihan menyertakan `alasan`
//     supaya user tidak merasa model berganti secara misterius.
//  2. KATALOG ADALAH SUMBER KEBENARAN. Biaya & konteks dibaca dari katalog
//     gateway, bukan ditulis mati di kode (harga bisa berubah). Di Re:Link,
//     metrik biayanya adalah MULTIPLIER token (lihat api/preset-model.js),
//     bukan dolar per juta token.
//  3. GAGAL AMAN. Bila katalog tidak tersedia atau tidak ada model yang cocok,
//     kembalikan null dan pemanggil memakai cfg.model seperti biasa.
//  4. TIDAK MEMAKSA. Fitur bisa dimatikan (cfg.routingOtomatis = false) dan
//     user selalu bisa mengunci model via /model atau --model
//     (cfg.modelTerkunci = true).

// ---------- Klasifikasi tugas ----------
// Bobot = tingkat kesulitan. Ambang ditentukan di pilihModel().
const POLA_TUGAS = [
  // Tugas berat: penalaran/arsitektur/multi-langkah panjang
  { nama: "berat", bobot: 3, pola: [
    /\brefaktor\b|\brefactor\b/i,
    /\barstitektur\b|\barchitecture\b/i,
    /\bdebug\b.*\bkenapa\b|\bcari (akar|penyebab)\b/i,
    /\banalis(a|is)\b.*\bmendalam\b/i,
    /\brencana\b.*\b(proyek|migrasi|besar)\b/i,
    /\boptimasi\b.*\b(performa|algoritma)\b/i,
    /\bproof\b|\bbuktikan\b|\bturunkan rumus\b/i,
    /\bmulti-?file\b|\bseluruh proyek\b|\bsemua file\b/i,
    /\b(u|uni)t(e?s)?t integrasi\b/i,
  ]},
  // Tugas menengah: menulis kode nyata, skrip, perbaikan
  { nama: "kode", bobot: 2, pola: [
    /\btulis(file)?\b|\bbuatkan\b|\bbuat\b.*\b(skrip|script|fungsi|program|modul)\b/i,
    /\bperbaiki\b|\bfix\b|\bbug\b|\berror\b|\bgalat\b/i,
    /\buji\b|\btest\b|\bunit test\b/i,
    /\bsh\b|\bbash\b|\bnode\b|\bpython\b|\bscript\b/i,
    /\bimplementasi\b|\bimplement\b/i,
    /```/,
    /\bfungsi\b.*\b(kembalikan|return)/i,
  ]},
  // Ringan: obrolan, tanya jawab singkat, ringkasan kecil
  { nama: "ringan", bobot: 1, pola: [
    /^(halo|hai|hi|pagi|siang|malam|sore)\b/i,
    /\bterima ?kasih\b|\bmakasih\b|\bthanks\b/i,
    /\bapa kabar\b|\bsiapa kamu\b|\bkamu siapa\b/i,
    /^(ya|ok|oke|sip|mantap|lanjut|gas)\b/i,
    /\bringkas(kan)?\b.*\b(singkat|pendek)\b/i,
  ]},
];

/**
 * Nilai tingkat kesulitan teks (0 = ringan, makin besar makin berat).
 * Panjang teks ikut menaikkan skor: instruksi 400+ karakter biasanya
 * bukan obrolan ringan.
 */
export function nilaiKesulitan(teks = "") {
  const t = String(teks);
  let skor = 0;
  const cocok = [];

  for (const kategori of POLA_TUGAS) {
    for (const p of kategori.pola) {
      if (p.test(t)) {
        // Kategori "berat" tidak boleh diturunkan oleh kata sapaan yang
        // kebetulan muncul di kalimat yang sama.
        if (kategori.nama === "ringan" && skor >= 2) continue;
        skor += kategori.bobot;
        cocok.push(kategori.nama);
        break; // satu pola per kategori cukup
      }
    }
  }

  // Panjang instruksi: penanda kuat pekerjaan nyata. Ambang ini sengaja
  // rendah karena instruksi panjang hampir selalu berarti tugas nyata,
  // dan biaya salah-tebak ke arah "model kuat" jauh lebih kecil daripada
  // salah-tebak ke arah "model murah" (pekerjaan salah lalu diulang).
  if (t.length > 1200) skor += 3;
  else if (t.length > 600) skor += 2;
  else if (t.length > 400) skor += 1;

  // Banyak baris perintah / langkah bernomor → kemungkinan besar tugas teknis.
  const jumlahBaris = (t.match(/\n/g) || []).length;
  if (jumlahBaris >= 6) skor += 1;

  // Blok kode di dalam pesan = tugas teknis yang pasti.
  if (/```/.test(t)) skor += 1;

  return { skor, kategori: cocok };
}

// ---------- Utilitas katalog ----------

/**
 * True bila model mendukung tool-calling.
 * Katalog Re:Link TIDAK mendeklarasikan kapabilitas (null) — gateway
 * kompatibel OpenAI sehingga semua model chat dianggap sanggup.
 * Hanya model yang EKSPLISIT dideklarasikan tanpa "tools" yang disaring.
 */
const punyaTool = (m) => {
  const kap = m.kapabilitas;
  if (kap == null) return true; // tidak diketahui → asumsi sanggup
  return kap.includes("tools");
};

/**
 * Biaya gabungan untuk memeringkat kandidat.
 * Di Re:Link: multiplier (pengali token terhadap kuota). Di penyedia lain
 * (baseCadangan): harga dolar input+output per juta token. 0 = gratis.
 */
function biaya(m) {
  if (m.multiplier != null) return Number(m.multiplier) || 0;
  const i = Number(m.harga?.input) || 0;
  const o = Number(m.harga?.output) || 0;
  return i + o;
}

/** Ringkas biaya model untuk pesan alasan. */
function ringkasBiaya(m) {
  if (m.multiplier != null) return `mult ${m.multiplier}x`;
  return `$${Number(m.harga?.input || 0).toFixed(2)}/M masuk`;
}

/**
 * Ciri model "sekadar murah": multiplier ≤ 1.05 (kelas kuota/eksperimen,
 * mis. `auto` 1x dan `kimi-k2.7-code` 1x) atau output digratiskan.
 * Model seperti ini hanya dipakai untuk tugas ringan, bukan pekerjaan teknis.
 */
function murahSaja(m) {
  if (m.multiplier != null) return m.multiplier <= 1.05;
  const o = Number(m.harga?.output) || 0;
  const kap = m.kapabilitas;
  return o === 0 || (kap != null && kap.length <= 1);
}

/** Konteks model cukup untuk kebutuhan? 0/null = tak dipublikasikan → anggap cukup. */
function konteksCukup(m, minimum) {
  if (!minimum) return true;
  if (!m.konteks) return true; // tidak diketahui → jangan disaring
  return m.konteks >= minimum;
}

/** Biaya model diketahui (multiplier atau harga eksplisit, termasuk gratis). */
function hargaDiketahui(m) {
  if (m.multiplier != null) return true;
  const h = m.harga;
  return !!h && (h.input != null || h.output != null);
}

/**
 * Saring kandidat yang layak: punya tool-calling (agent butuh ini), harga
 * diketahui, dan konteks cukup untuk kebutuhan giliran.
 */
function kandidatLayak(katalog, { perluTool = true, konteksMinimum = 0 } = {}) {
  return katalog.filter((m) => {
    if (perluTool && !punyaTool(m)) return false;
    if (!hargaDiketahui(m) && katalog.some(hargaDiketahui)) return false;
    if (!konteksCukup(m, konteksMinimum)) return false;
    return true;
  });
}

/**
 * Pilih model untuk satu giliran.
 * @param {object} opsi
 * @param {Array}  opsi.katalog        hasil ambilKatalog()
 * @param {string} opsi.teks           pesan user giliran ini
 * @param {number} opsi.ukuranRiwayat  panjang riwayat (karakter) saat ini
 * @param {object} opsi.cfg            konfigurasi (model, modelCepat, modelCadangan)
 * @returns {{id:string, alasan:string, tingkat:string, hemat:boolean}|null}
 */
export function pilihModel({ katalog, teks = "", ukuranRiwayat = 0, cfg = {}, paksaModel = null }) {
  if (!Array.isArray(katalog) || !katalog.length) return null;
  if (paksaModel) return null; // user mengunci model → jangan diganggu

  const { skor, kategori } = nilaiKesulitan(teks);

  // Perkiraan token dari ukuran riwayat (≈4 karakter/token) → butuh konteks.
  const tokenRiwayat = Math.ceil(ukuranRiwayat / 4);
  // Sisakan ruang untuk jawaban; konteks minimal = riwayat + 25% margin.
  const konteksMinimum = Math.ceil(tokenRiwayat * 1.25);

  const semua = kandidatLayak(katalog, { perluTool: true, konteksMinimum });
  const dasar = kandidatLayak(katalog, { perluTool: true, konteksMinimum: 0 });
  const daftar = semua.length ? semua : dasar;
  if (!daftar.length) return null;

  const urutMurah = [...daftar].sort((a, b) => biaya(a) - biaya(b));
  const termurah = urutMurah[0];
  const termahal = urutMurah[urutMurah.length - 1];

  // Model yang sedang dipakai user: kalau harganya sudah mahal, jangan
  // naik-turun tanpa alasan kuat.
  const modelSekarang = katalog.find((m) => m.id === cfg.model);

  // ── Tugas berat: pakai model kuat yang tersedia & muat konteks ──────────
  if (skor >= 3) {
    // "Kuat" = 25% termahal dari kandidat, tapi tetap hormati konteks.
    const ambangKuat = urutMurah[Math.floor(urutMurah.length * 0.75)] || termahal;
    if (modelSekarang && biaya(modelSekarang) >= biaya(ambangKuat) && semua.includes(modelSekarang)) {
      return { id: modelSekarang.id, tingkat: "berat", hemat: false,
        alasan: `tugas berat (${kategori.join(",")}) — model aktif sudah kelas kuat` };
    }
    // Pilih yang paling murah DI ANTARA kelas kuat — kualitas sudah terjamin
    // oleh ambang, jadi tidak perlu membayar lebih hanya untuk konteks besar
    // bila konteksMinimum sudah terpenuhi.
    const pilih = [...daftar]
      .filter((m) => biaya(m) >= biaya(ambangKuat) && konteksCukup(m, konteksMinimum))
      .sort((a, b) => biaya(a) - biaya(b))[0] || termahal;
    return { id: pilih.id, tingkat: "berat", hemat: biaya(pilih) - biaya(termurah) > 0,
      alasan: `tugas berat (${kategori.join(",") || "panjang/multi-langkah"}) → butuh model kuat (${ringkasBiaya(pilih)})` };
  }

  // ── Tugas menengah: murah, tapi BUKAN model "gratisan" tanpa jaminan ────
  if (skor >= 2) {
    const layakTeknis = urutMurah.filter((m) => !murahSaja(m) && konteksCukup(m, Math.max(konteksMinimum, 100000)));
    // Bila semua kandidat bertanda murahSaja, tetap pakai yang terbaik dari
    // yang ada — jangan sampai router gagal memilih hanya karena katalog
    // seluruhnya berisi model murah.
    const pilih = layakTeknis[0]
      || urutMurah.find((m) => konteksCukup(m, Math.max(konteksMinimum, 100000)))
      || urutMurah[0];
    const catatan = murahSaja(pilih) ? " — catatan: satu-satunya kandidat murah, kualitas belum tentu setara" : "";
    return { id: pilih.id, tingkat: "kode", hemat: true,
      alasan: `tugas teknis menengah (${kategori.join(",")}) → ${pilih.id} (${ringkasBiaya(pilih)})${catatan}` };
  }

  // ── Ringan: termurah yang layak (boleh model gratisan) ────────────────
  return { id: termurah.id, tingkat: "ringan", hemat: true,
    alasan: `percakapan ringan → termurah ${termurah.id} (${ringkasBiaya(termurah)})` };
}
