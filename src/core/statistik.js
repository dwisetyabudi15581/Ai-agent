// ============ STATISTIK TOKEN & PENGHEMATAN ============
//
// Semua angka di sini berasal dari DUA sumber yang bisa diverifikasi:
//   1. `usage` dari API (angka PASTI — inilah yang ditagih penyedia)
//   2. pengukuran panjang riwayat SEBELUM vs SESUDAH pemadatan (angka NYATA
//      dari fungsi produksi, bukan tebakan) → dipakai menghitung penghematan.
//
// Prinsip: jangan mengarang. Kalau API tidak mengirim `usage` (mis. beberapa
// gateway menghilangkannya saat streaming), tandai sebagai "tidak tersedia"
// dan jangan tampilkan angka palsu hasil estimasi karakter.

/** Perkiraan kasar 1 token ≈ 4 karakter (hanya dipakai bila usage tidak ada). */
const CHAR_PER_TOKEN = 4;

/** Peringkat model hemat→mahal dari multiplier katalog (1x = paling murah). */
function kelasHarga(mult) {
  if (mult == null) return "?";
  if (mult <= 1) return "termurah";
  if (mult <= 3) return "murah";
  if (mult <= 10) return "menengah";
  if (mult <= 30) return "mahal";
  return "termahal";
}

/**
 * Pencatat pemakaian token untuk satu sesi.
 *
 * Dibuat sebagai objek (bukan variabel lepas) supaya bisa dibaca kapan saja
 * oleh UI (/token) tanpa mengubah alur agen.
 */
export function buatPencatatToken() {
  const catatan = {
    panggilan: 0,          // jumlah request ke API
    masuk: 0,              // prompt_tokens total (angka pasti dari API)
    keluar: 0,             // completion_tokens total
    reasoning: 0,          // token penalaran (ikut ditagih, tidak terlihat)
    cacheHemat: 0,         // prompt_tokens_details.cached_tokens
    perModel: new Map(),   // id model → { panggilan, masuk, keluar, reasoning, mult, kuota }
    // Kuota dijumlah PER REQUEST lalu dibulatkan masing-masing, sesuai
    // dokumentasi Re:Link: "(prompt + completion) × multiplier. Hasilnya
    // dibulatkan dan dikurangi dari quota." — pembulatan terjadi pada tiap
    // response API, BUKAN pada total gabungan beberapa request.
    tanpaUsage: 0,         // berapa request yang tidak menyertakan usage
    // ── penghematan pemadatan riwayat ──
    kirim: 0,              // total karakter riwayat yang BENAR-BENAR dikirim
    mentah: 0,             // total karakter riwayat bila TANPA pemadatan
    giliranDiukur: 0,
    mulai: Date.now(),
  };

  /** Catat satu respons API. `usage` boleh kosong. */
  function catatPanggilan(usage, model, mult = null) {
    catatan.panggilan++;
    const u = usage || {};
    const masuk = Number(u.prompt_tokens) || 0;
    const keluar = Number(u.completion_tokens) || 0;
    const reason = Number(u.completion_tokens_details?.reasoning_tokens) || 0;
    const cache = Number(u.prompt_tokens_details?.cached_tokens) || 0;

    if (!usage || (!masuk && !keluar)) catatan.tanpaUsage++;
    else {
      catatan.masuk += masuk;
      catatan.keluar += keluar;
      catatan.reasoning += reason;
      catatan.cacheHemat += cache;
    }

    const id = model || "?";
    const mEff = mult != null ? mult : catatan.perModel.get(id)?.mult;
    const k = catatan.perModel.get(id) || { panggilan: 0, masuk: 0, keluar: 0, reasoning: 0, mult: mEff, kuota: 0 };
    k.panggilan++;
    k.masuk += masuk;
    k.keluar += keluar;
    k.reasoning += reason;
    if (mult != null) k.mult = mult;
    // Kuota ditagih per response: (masuk + keluar) × multiplier, DIBULATKAN
    // pada request ini (docs Re:Link) lalu diakumulasi. Ini bukan pembulatan
    // total gabungan — beda 1 token pun bisa muncul kalau salah cara.
    k.kuota = (Number(k.kuota) || 0) + Math.round((masuk + keluar) * (Number(k.mult) || 1));
    catatan.perModel.set(id, k);
  }

  /**
   * Catat penghematan SATU pengiriman riwayat.
   * @param {Array}  mentah  riwayat sebelum dipadatkan
   * @param {Array}  kirim   riwayat yang benar-benar dikirim ke model
   */
  function catatPemadatan(mentah, kirim) {
    const a = ukuran(mentah);
    const b = ukuran(kirim);
    // Kalau tidak ada pemadatan sama sekali, perbandingannya tidak bermakna —
    // tetap dihitung supaya rata-rata mencerminkan kenyataan.
    catatan.mentah += a;
    catatan.kirim += b;
    catatan.giliranDiukur++;
  }

  function ukuran(msgs) {
    if (!Array.isArray(msgs)) return 0;
    let n = 0;
    for (const m of msgs) {
      n += String(m?.content ?? "").length;
      if (m?.tool_calls) n += JSON.stringify(m.tool_calls).length;
    }
    return n;
  }

  /** Persentase karakter yang dihemat pemadatan (0–100). */
  function persenHemat() {
    if (!catatan.mentah) return 0;
    return (1 - catatan.kirim / catatan.mentah) * 100;
  }

  /** Perkiraan token yang dihemat (dari karakter yang tidak pernah dikirim). */
  function tokenDihemat() {
    return Math.round((catatan.mentah - catatan.kirim) / CHAR_PER_TOKEN);
  }

  /**
   * Kuota terpotong = (masuk + keluar) × multiplier model, dihitung per model.
   * Model bisa berganti di tengah sesi (router), jadi multiplier dihitung
   * terpisah untuk tiap model — bukan satu multiplier untuk semuanya.
   *
   * Rumus ini disalin APA ADANYA dari dokumentasi Re:Link (tab Dokumentasi):
   *   "(prompt + completion) × multiplier. Hasilnya dibulatkan dan dikurangi
   *    dari quota." Contoh resmi: (800 + 1.200) × 1.5 = 3.000.
   * Karena dokumentasi membulatkan PER REQUEST, di sini pun tiap model
   * dibulatkan sendiri sebelum dijumlahkan — bukan total lalu dibulatkan.
   */
  function kuota() {
    let total = 0;
    for (const k of catatan.perModel.values()) {
      // k.kuota = akumulasi pembulatan PER REQUEST (lihat catatPanggilan).
      total += Number(k.kuota) || 0;
    }
    return total;
  }

  /** Snapshot siap-tampil (menyalin Map → array agar mudah dibaca UI). */
  function ringkas(multiplierAktif = null) {
    const totalToken = catatan.masuk + catatan.keluar;
    return {
      ...catatan,
      perModel: [...catatan.perModel.entries()].map(([id, k]) => ({ id, ...k })),
      totalToken,
      persenHemat: persenHemat(),
      tokenDihemat: tokenDihemat(),
      kuota: kuota(),
      kelasHarga: kelasHarga(multiplierAktif),
      detik: Math.round((Date.now() - catatan.mulai) / 1000),
      adaAngkaPalsu: catatan.tanpaUsage > 0,
    };
  }

  return { catatPanggilan, catatPemadatan, ringkas, mentah: catatan };
}

/** Format angka gaya Indonesia (1.234.567). */
export function nf(n) {
  return Math.round(Number(n) || 0).toLocaleString("id-ID");
}

/** Format persen satu desimal. */
export function persen(n) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}
