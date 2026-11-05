// Uji router model: katalog tiruan lengkap (harga, konteks, kapabilitas).
// Katalog nyata Re:Link tidak memuat harga/kapabilitas, jadi keputusan router
// diuji pada struktur katalog yang menyediakan data tersebut — hasilnya uji
// ini berjalan offline tanpa API key.
import { pilihModel, nilaiKesulitan } from "../src/core/router.js";

const katalog = [
  { id: "hemat-flash", nama: "Hemat Flash", kapabilitas: ["chat"], konteks: 128000, harga: { input: 0.1, output: 0.2 } },
  { id: "gratis-eksperimen", nama: "Gratis Eksperimen", kapabilitas: ["chat"], konteks: 64000, harga: { input: 0, output: 0 } },
  { id: "kerja-tangguh", nama: "Kerja Tangguh", kapabilitas: ["chat", "tools"], konteks: 1000000, harga: { input: 0.6, output: 1.2 } },
  { id: "keras-pro", nama: "Keras Pro", kapabilitas: ["chat", "tools"], konteks: 200000, harga: { input: 1.2, output: 2.4 } },
  { id: "keras-max", nama: "Keras Max", kapabilitas: ["chat", "tools"], konteks: 1000000, harga: { input: 4, output: 8 } },
];

const kasus = [
  { teks: "halo", harap: "ringan" },
  { teks: "makasih ya", harap: "ringan" },
  { teks: "oke lanjut", harap: "ringan" },
  { teks: "apa kabar?", harap: "ringan" },
  { teks: "tolong buatkan skrip bash untuk backup folder", harap: "kode" },
  { teks: "perbaiki bug di src/api/klien.js bagian bacaStream", harap: "kode" },
  { teks: "tulis fungsi python untuk parsing CSV", harap: "kode" },
  { teks: "refaktor seluruh proyek ini jadi arsitektur modular", harap: "berat" },
  { teks: "cari akar penyebab kenapa proses ini menggantung", harap: "berat" },
  { teks: "analisis mendalam performa dan optimasi algoritma sorting", harap: "berat" },
  { teks: "buktikan teorema ini secara formal", harap: "berat" },
  { teks: "a".repeat(1500), harap: "berat" },
];

let gagal = 0;
const baris = [];
for (const k of kasus) {
  const skor = nilaiKesulitan(k.teks);
  const p = pilihModel({ katalog, teks: k.teks, ukuranRiwayat: 5000 });
  const ok = p && p.tingkat === k.harap;
  if (!ok) gagal++;
  baris.push({
    teks: k.teks.length > 42 ? k.teks.slice(0, 39) + "…" : k.teks,
    skor: skor.skor,
    harap: k.harap,
    dapat: p ? p.tingkat : "-",
    model: p ? p.id : "-",
    ok: ok ? "✓" : "✗",
  });
}

console.log("=== KLASIFIKASI TUGAS ===");
for (const b of baris) {
  console.log(`${b.ok} ${b.teks.padEnd(44)} skor=${String(b.skor).padStart(2)} ${b.harap.padEnd(7)}→${b.dapat.padEnd(7)} ${b.model}`);
}

// ---- Uji penghematan biaya ----
console.log("\n=== PEMILIHAN MODEL PER TINGKAT (dari katalog tiruan) ===");
for (const teks of ["halo", "buatkan skrip bash", "refaktor seluruh proyek"]) {
  const p = pilihModel({ katalog, teks, ukuranRiwayat: 5000 });
  const m = katalog.find((x) => x.id === p.id);
  console.log(`${p.tingkat.padEnd(7)} → ${p.id.padEnd(38)} in $${m.harga.input}/M out $${m.harga.output}/M`);
  console.log(`         alasan: ${p.alasan}`);
}

// ---- Uji konteks: riwayat besar harus tetap muat di model terpilih ----
console.log("\n=== KONTEKS BESAR ===");
const riwayatBesar = 900000 * 4; // ≈900k token
const pBesar = pilihModel({ katalog, teks: "halo", ukuranRiwayat: riwayatBesar });
const mBesar = pBesar ? katalog.find((x) => x.id === pBesar.id) : null;
console.log(`riwayat ${(riwayatBesar / 4 / 1000).toFixed(0)}k token → ${pBesar?.id || "-"} (konteks ${mBesar?.konteks || 0})`);
if (!mBesar || (mBesar.konteks || 0) < 900000) { console.log("✗ model terpilih tidak muat konteks"); gagal++; }
else console.log("✓ model terpilih muat konteks besar");

// ---- Uji kunci model (paksaModel) ----
console.log("\n=== MODEL DIKUNCI USER ===");
const pk = pilihModel({ katalog, teks: "halo", ukuranRiwayat: 1000, paksaModel: "keras-pro" });
console.log(pk === null ? "✓ router menyerah (pakai model pilihan user)" : `✗ router tetap memilih ${pk.id}`);
if (pk !== null) gagal++;

// ---- Uji katalog kosong ----
console.log("\n=== KATALOG TIDAK TERSEDIA ===");
const pn = pilihModel({ katalog: null, teks: "halo" });
console.log(pn === null ? "✓ gagal aman (null)" : "✗ seharusnya null");
if (pn !== null) gagal++;

// ---- Uji model tanpa tool-calling disaring ----
console.log("\n=== SARING MODEL TANPA TOOL ===");
const katalogPalsu = [
  { id: "murah-tanpa-tool", kapabilitas: ["chat"], konteks: 1000000, harga: { input: 0.001, output: 0.001 } },
  { id: "mahal-dengan-tool", kapabilitas: ["chat", "tools"], konteks: 1000000, harga: { input: 1, output: 1 } },
];
const pt = pilihModel({ katalog: katalogPalsu, teks: "halo", ukuranRiwayat: 100 });
console.log(`terpilih: ${pt?.id}`);
if (pt?.id !== "mahal-dengan-tool") { console.log("✗ model tanpa tool seharusnya disaring"); gagal++; }
else console.log("✓ model tanpa tool-calling disaring keluar");

console.log(`\n${gagal === 0 ? "LULUS ✓" : "GAGAL ✗"} (${gagal} kegagalan)`);
process.exit(gagal === 0 ? 0 : 1);
