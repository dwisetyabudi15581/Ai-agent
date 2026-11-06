// ============ UJI REGRESI: ANGGARAN WAKTU TIDAK WAJAR ============
// Bug asal: `throw galatTerakhir || new Error("Gagal memanggil API Re:Link")`
// muncul saat detikTotal <= 0, karena tenggat sudah lewat -> semua `break`
// sebelum `fetch` -> galatTerakhir undefined -> pesan generik tanpa sebab.
// Perbaikan: detikTotal tak wajar dinormalkan, dan pesan galat menjelaskan sebab.

import { panggilChat } from "../src/api/klien.js";

let lulus = 0, gagal = 0;
const cek = (nama, syarat) => {
  if (syarat) { lulus++; console.log(`  ✓ ${nama}`); }
  else { gagal++; console.log(`  ✗ ${nama}`); }
};

const apiKey = process.env.API_KEY || process.env.RELINK_API_KEY || "";
const baseUrl = process.env.BASE_URL || process.env.RELINK_BASE_URL || "";

if (!apiKey || !baseUrl) {
  console.log("  ! lewati: API_KEY / BASE_URL kosong");
  console.log(`\nRINGKAS: ${lulus} lulus, ${gagal} gagal (dilewati)`);
  process.exit(gagal ? 1 : 0);
}

const cfg = { apiKey, baseUrl, model: "glm-5.3", maxTokens: 8, suhu: 0 };
const pesan = [{ role: "user", content: "hi" }];

// 1) detikTotal tidak wajar -> harus tetap mencoba, bukan melempar pesan generik
for (const dt of [0, -5, -60]) {
  let sukses = false, err = null;
  try {
    const r = await panggilChat(cfg, pesan, [], { stream: false, detikTimeout: 30, detikTotal: dt });
    sukses = Boolean(r && (r.teks !== undefined || r.pesan));
  } catch (e) { err = e; }
  cek(`detikTotal=${dt} tidak membunuh rantai sebelum percobaan (sukses=${sukses})`, sukses);
  cek(`detikTotal=${dt} tidak melempar galat`, err === null);
}

// 2) detikTotal NaN / undefined -> tetap jalan
for (const dt of [NaN, undefined]) {
  let sukses = false;
  try {
    const r = await panggilChat(cfg, pesan, [], { stream: false, detikTimeout: 30, detikTotal: dt });
    sukses = Boolean(r && (r.teks !== undefined || r.pesan));
  } catch { sukses = false; }
  cek(`detikTotal=${String(dt)} tetap dijalankan`, sukses);
}

// 3) Bila benar-benar tidak ada base URL, pesan galat harus menjelaskan sebabnya
try {
  await panggilChat({ ...cfg, baseUrl: "" }, pesan, [], { stream: false, detikTimeout: 5, detikTotal: 5 });
  cek("baseUrl kosong melempar galat", false);
} catch (e) {
  const m = e.message || "";
  cek("baseUrl kosong melempar galat yang jelas (bukan pesan generik kosong)", m.length > 0);
  cek("pesan galat tidak sekadar 'Gagal memanggil API Re:Link'", m !== "Gagal memanggil API Re:Link");
}

console.log(`\nRINGKAS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
