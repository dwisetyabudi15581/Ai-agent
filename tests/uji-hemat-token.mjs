// ============ UJI PENGHEMAT TOKEN ============
// Membuktikan tiga hal yang paling mudah rusak saat memadatkan riwayat:
//   1) Isi pesan tool lama BENAR-BENAR dipangkas (hemat nyata, bukan teori).
//   2) Pesan tool dari putaran TERAKHIR tetap UTUH (kualitas penalaran aman).
//   3) Pasangan tool_calls ↔ tool_call_id TIDAK PERNAH rusak (API tidak menolak).
//   4) sesi.messages ASLI tidak diubah (arsip/ringkasan tetap akurat).
import assert from "node:assert/strict";
import { riwayatUntukModel, padatkanRiwayat } from "../src/tools/tools.js";

let lulus = 0, gagal = 0;
const ok = (m) => { lulus++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const no = (m) => { gagal++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const cek = (syarat, m) => (syarat ? ok(m) : no(m));

// ---------- Bangun riwayat tiruan: 5 putaran tool, tiap output 4000 char ----------
const OUTPUT_PANJANG = "X".repeat(4000);
function buatRiwayat(putaran = 5) {
  const msgs = [
    { role: "system", content: "Kamu agent." },
    { role: "user", content: "Perbaiki bug di file A." },
  ];
  for (let i = 0; i < putaran; i++) {
    const id = `call_${i}`;
    msgs.push({
      role: "assistant",
      content: "",
      tool_calls: [{ id, type: "function", function: { name: "baca_file", arguments: `{"nama_file":"f${i}.js"}` } }],
    });
    msgs.push({ role: "tool", tool_call_id: id, name: "baca_file", content: `Isi f${i}.js:\n${OUTPUT_PANJANG}` });
  }
  msgs.push({ role: "user", content: "Lanjut." });
  return msgs;
}

const ukuran = (ms) => ms.reduce((n, m) => n + String(m.content || "").length, 0);

console.log("\n\x1b[1mUJI PENGHEMAT TOKEN\x1b[0m\n");

// ---------- 1. Pemadatan benar-benar mengurangi ukuran ----------
{
  const asli = buatRiwayat(5);
  const kirim = riwayatUntukModel(asli, { jagaToolTerakhir: 2, jagaTerakhir: 2 });
  const sebelum = ukuran(asli), sesudah = ukuran(kirim);
  cek(sesudah < sebelum, `ukuran turun: ${sebelum} → ${sesudah} char (${(100 - (sesudah / sebelum) * 100).toFixed(1)}% lebih kecil)`);
  cek(sesudah < sebelum * 0.5, "penghematan > 50% pada riwayat dengan output besar");
}

// ---------- 2. Pesan tool TERAKHIR tetap utuh ----------
{
  const asli = buatRiwayat(5);
  const kirim = riwayatUntukModel(asli, { jagaToolTerakhir: 1, jagaTerakhir: 10 });
  const toolTerakhirAsli = asli.filter((m) => m.role === "tool").at(-1);
  const toolTerakhirKirim = kirim.filter((m) => m.role === "tool").at(-1);
  cek(toolTerakhirKirim.content.length === toolTerakhirAsli.content.length,
    `pesan tool terakhir utuh (${toolTerakhirKirim.content.length} char, tidak dipotong)`);
}

// ---------- 3. Pasangan tool_call_id tidak pernah rusak ----------
{
  const asli = buatRiwayat(6);
  const kirim = riwayatUntukModel(asli, { jagaToolTerakhir: 2, jagaTerakhir: 3 });
  const idDariAssistant = kirim.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id));
  const idDariTool = kirim.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  cek(idDariAssistant.length === idDariTool.length,
    `jumlah tool_calls (${idDariAssistant.length}) == jumlah pesan tool (${idDariTool.length})`);
  cek(idDariAssistant.every((id, i) => id === idDariTool[i]), "urutan & isi tool_call_id tetap berpasangan");
  cek(kirim.filter((m) => m.role === "assistant" && m.tool_calls).length === asli.filter((m) => m.role === "assistant" && m.tool_calls).length,
    "tidak ada pesan assistant+tool_calls yang hilang");
}

// ---------- 4. sesi.messages ASLI tidak dimodifikasi ----------
{
  const asli = buatRiwayat(4);
  const salinan = JSON.parse(JSON.stringify(asli));
  riwayatUntukModel(asli, { jagaToolTerakhir: 2, jagaTerakhir: 2 });
  cek(JSON.stringify(asli) === JSON.stringify(salinan), "riwayat asli tidak berubah (immutable / aman untuk arsip)");
}

// ---------- 5. Riwayat pendek tidak disentuh ----------
{
  const pendek = buatRiwayat(1);
  const kirim = riwayatUntukModel(pendek, { jagaToolTerakhir: 1, jagaTerakhir: 10 });
  cek(ukuran(kirim) === ukuran(pendek), "riwayat pendek dibiarkan apa adanya (tidak ada biaya sia-sia)");
}

// ---------- 6. Mematikan fitur: semua tool dianggap "terakhir" ----------
// Bila jumlah tool yang dijaga >= jumlah tool di riwayat, tidak ada yang
// dipadatkan → perilaku lama. Ini juga jalur yang dipakai bila user ingin
// riwayat benar-benar utuh (mis. sedang menelusuri bug).
{
  const asli = buatRiwayat(5);
  const kirim = riwayatUntukModel(asli, { jagaToolTerakhir: 999 });
  cek(ukuran(kirim) === ukuran(asli), "jagaToolTerakhir > jumlah tool → tanpa pemadatan (perilaku lama)");
}

// ---------- 7. Pesan singkat tidak diberi penanda sampah ----------
{
  const msgs = [
    { role: "user", content: "halo" },
    ...Array.from({ length: 6 }, (_, i) => ({ role: "tool", tool_call_id: `c${i}`, name: "x", content: "hasil singkat" })),
    { role: "user", content: "oke" },
  ];
  const kirim = padatkanRiwayat(msgs, { jagaToolTerakhir: 2, jagaTerakhir: 1 });
  const dipadatkan = kirim.filter((m) => String(m.content).includes("[dipadatkan"));
  cek(dipadatkan.length === 0, "pesan yang sudah singkat tidak dibuang sia-sia");
}

// ---------- 8. Bertahan pada riwayat besar (tidak menggantung) ----------
{
  const besar = buatRiwayat(60);
  const t0 = Date.now();
  const kirim = riwayatUntukModel(besar, { jagaToolTerakhir: 5, jagaTerakhir: 10 });
  const ms = Date.now() - t0;
  cek(ms < 500, `riwayat 60 putaran diproses dalam ${ms}ms (tidak menggantung)`);
  // CATATAN SEMANTIK (jangan dikembalikan ke `=== 60`):
  // sejak jendela pemadatan aktif, pesan tool LAMA memang DIBUANG — itu
  // tujuannya, bukan kegagalan. Yang wajib dijamin adalah:
  //   (a) pesan tool TERBARU (`jagaToolTerakhir`) masih ada, dan
  //   (b) setiap id yang tersisa tetap berpasangan utuh (dicek di bawah).
  // Mengunci jumlahnya ke 60 = menguji perilaku pra-jendela, dan akan selalu
  // gagal begitu jendela bekerja.
  const toolTersisa = kirim.filter((m) => m.role === "tool").length;
  const toolTerjaga = kirim.slice(-10).filter((m) => m.role === "tool").length;
  cek(toolTersisa >= 5 && toolTersisa < 60,
    `pesan tool lama dibuang, sisanya terikat: ${toolTersisa} (dari 60, ≥5 terjaga)`);
  cek(toolTerjaga === 5, `5 tool di zona ekor tetap utuh (${toolTerjaga} ada)`);
}

// ---------- 9. Pesan user & system tidak pernah dipotong ----------
{
  const asli = buatRiwayat(5);
  const kirim = riwayatUntukModel(asli, { jagaToolTerakhir: 1, jagaTerakhir: 1 });
  const userKirim = kirim.filter((m) => m.role === "user").map((m) => m.content);
  cek(userKirim.includes("Perbaiki bug di file A.") && userKirim.includes("Lanjut."), "semua pesan user tetap utuh");
  cek(kirim[0].role === "system" && kirim[0].content === "Kamu agent.", "pesan system di awal tidak disentuh");
}

// ---------- 10. REGRESI: bug semantik terbalik ----------
// Versi lama mengartikan `padatkanToolLama` sebagai "pertahankan N tool
// terakhir". Dengan N=8 (bawaan) dan 5 tool dalam sesi, `5-8 <= 0` → TIDAK
// ADA pemadatan sama sekali, dan itu tidak terlihat di uji mana pun karena
// uji lain memakai N kecil (3) atau zona aman besar. Uji ini mengunci
// perilaku yang benar: `jagaToolTerakhir` KECIL = banyak yang dipadatkan.
{
  const asli = buatRiwayat(5);
  const sedikitDijaga = riwayatUntukModel(asli, { jagaToolTerakhir: 1, jagaTerakhir: 1 });
  const banyakDijaga = riwayatUntukModel(asli, { jagaToolTerakhir: 5, jagaTerakhir: 1 });
  cek(ukuran(sedikitDijaga) < ukuran(banyakDijaga),
    `jagaToolTerakhir kecil → lebih hemat (${ukuran(sedikitDijaga)} < ${ukuran(banyakDijaga)} char)`);
  // Bawaan fungsi (tanpa opsi apa pun) HARUS memadatkan, bukan mengembalikan utuh.
  const bawaan = riwayatUntukModel(asli);
  cek(ukuran(bawaan) < ukuran(asli), `bawaan memadatkan (${ukuran(asli)} → ${ukuran(bawaan)} char, tanpa opsi)`);
  // Alias lama tetap dihormati agar config tersimpan tidak diam-diam mati.
  const alias = riwayatUntukModel(asli, { padatkanToolLama: 1, jagaTerakhir: 1 });
  cek(ukuran(alias) === ukuran(sedikitDijaga), "alias padatkanToolLama tetap bekerja (kompatibilitas config lama)");
}

// ---------- 11. NARASI ASSISTANT JUGA DIPADATKAN (bukan cuma role tool) ----------
// Kebocoran yang lolos dari SEMUA uji sebelumnya: `padatkanRiwayat` hanya
// memangkas role `tool`. Pesan `assistant` murni (tanpa tool_calls) tumbuh
// tanpa batas — di sesi nyata ia memakan ~81% beban konteks. Uji ini
// mengunci kontraknya: narasi lama DIPANGKAS, narasi terbaru UTUH.
{
  const NARASI = "A".repeat(3000);
  const msgs = [
    { role: "system", content: "Kamu agent." },
    { role: "user", content: "Mulai." },
    ...Array.from({ length: 12 }, (_, i) => ({ role: "assistant", content: `${NARASI}#${i}` })),
    { role: "user", content: "Selesai?" },
    { role: "assistant", content: "NARASI TERAKHIR YANG HARUS UTUH" },
  ];
  const hasil = riwayatUntukModel(msgs, { jagaToolTerakhir: 3, jagaTerakhir: 1 });

  cek(ukuran(hasil) < ukuran(msgs) * 0.6,
    `narasi assistant dipangkas (${ukuran(msgs)} → ${ukuran(hasil)} char, hemat >40%)`);

  const asst = hasil.filter((m) => m.role === "assistant");
  cek(asst[asst.length - 1].content === "NARASI TERAKHIR YANG HARUS UTUH",
    "narasi assistant TERAKHIR tetap utuh (kualitas penalaran aman)");
  cek(asst.some((m) => m.content !== "NARASI TERAKHIR YANG HARUS UTUH" && m.content.length < 3000),
    "narasi assistant LAMA benar-benar terpangkas (bukan cuma dibiarkan)");

  // Riwayat ASLI tidak boleh berubah — arsip & ringkasan membaca dari sana.
  // Narasi ke-0 = "AAA...#0" → 3000 char "A" + "#0" = 3002, bukan 3003.
  const asliPertama = msgs.filter((m) => m.role === "assistant")[0].content;
  cek(asliPertama === `${NARASI}#0`,
    `sesi.messages ASLI tidak diubah (narasi ke-0 utuh ${asliPertama.length} char)`);
  cek(msgs.every((m) => m.role !== "assistant" || !m.content.includes("dipadatkan")),
    "tidak ada penanda pemadatan bocor ke sesi.messages ASLI");
}

// ---------- 12. BLOK tool_calls TIDAK BOLEH DIPANGKAS ----------
// Pesan assistant yang memuat tool_calls wajib lewat UTUH: memangkas/menghapus
// blok ini memutus pasangan dengan role `tool` → API menolak 400. Ini pernah
// jadi risiko nyata saat menambahkan pemadatan narasi assistant.
{
  const id = "call_abc123";
  const msgs = [
    { role: "system", content: "Kamu agent." },
    { role: "user", content: "Baca file." },
    {
      role: "assistant",
      content: "Baik, saya baca sekarang.",
      tool_calls: [{ id, type: "function", function: { name: "baca_file", arguments: '{"nama_file":"a.txt"}' } }],
    },
    { role: "tool", tool_call_id: id, content: "isi file " + "Z".repeat(5000) },
  ];
  const hasil = riwayatUntukModel(msgs, { jagaToolTerakhir: 0, jagaTerakhir: 0 });

  const pembawa = hasil.find((m) => m.tool_calls);
  cek(!!pembawa, "pesan assistant pembawa tool_calls tetap ada (tidak dihapus)");
  cek(pembawa?.tool_calls?.[0]?.id === id, "id tool_calls utuh (pasangan tidak putus)");

  const idTool = new Set(hasil.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  const idCall = new Set(hasil.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id)));
  const yatim = [...idTool].filter((x) => !idCall.has(x));
  const nganggur = [...idCall].filter((x) => !idTool.has(x));
  cek(yatim.length === 0 && nganggur.length === 0,
    `0 tool_call_id yatim & 0 tool_calls nganggur (yatim=${yatim.length}, nganggur=${nganggur.length})`);
}

// ---------- 13. PERTUMBUHAN TIDAK DATAR (pemadatan benar-benar bekerja) ----------
// Kalau pemadatan mati, ukuran proyeksi naik linear selamanya. Uji ini
// mensimulasikan 48 putaran campuran dan memastikan proyeksi TIDAK melewati
// plafon wajar — inilah bukti "hemat nyata" pada skala sesi panjang.
{
  const NARASI = "B".repeat(800);
  const BACAAN = "C".repeat(2000);
  const putaran = (n) => {
    const msgs = [
      { role: "system", content: "Kamu agent." },
      { role: "user", content: "Kerjakan tugas panjang." },
    ];
    for (let i = 0; i < n; i++) {
      const id = `call_${i}`;
      msgs.push({ role: "assistant", content: `${NARASI} langkah ${i}`, tool_calls: [{ id, type: "function", function: { name: "baca_file", arguments: "{}" } }] });
      msgs.push({ role: "tool", tool_call_id: id, content: BACAAN });
      if (i % 3 === 0) msgs.push({ role: "assistant", content: `${NARASI} analisis ${i}` });
    }
    return msgs;
  };
  const proyeksi = (n) => ukuran(riwayatUntukModel(putaran(n), { jagaToolTerakhir: 2, jagaTerakhir: 1 }));
  const u16 = proyeksi(16), u32 = proyeksi(32), u48 = proyeksi(48);
  const mentah48 = ukuran(putaran(48));

  cek(u48 < mentah48 * 0.5, `48 putaran terpangkas >50% (${mentah48} → ${u48} char)`);
  cek(u32 < u16 * 2.5 && u48 < u16 * 3.5,
    `pertumbuhan sub-linear, bukan 1:1 (16→${u16}, 32→${u32}, 48→${u48})`);

  const proy48 = riwayatUntukModel(putaran(48), { jagaToolTerakhir: 2, jagaTerakhir: 1 });
  const idTool = proy48.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  const idCall = new Set(proy48.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((c) => c.id)));
  cek(idTool.every((x) => idCall.has(x)) && idTool.length === idCall.size,
    `integritas utuh pada 48 putaran (${idTool.length} pasangan)`);
}

// ---------- Ringkasan ----------
console.log(`\n${gagal === 0 ? "\x1b[32m" : "\x1b[31m"}LULUS ${lulus} · GAGAL ${gagal}\x1b[0m\n`);
process.exit(gagal === 0 ? 0 : 1);
