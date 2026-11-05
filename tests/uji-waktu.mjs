// Uji batas waktu rantai fallback lib_api.panggilChat.
// Server tiruan lokal yang SELALU lambat (tidak pernah membalas) dipakai
// sebagai baseUrl & baseCadangan. Ekspektasi:
//   - detikTimeout=2, detikTotal bawaan (32) → total ≈ 2 dtk? Tidak:
//     tiap percobaan makan 2 dtk, tapi anggaran total 32 dtk.
//     Untuk uji ringkas kita set detikTotal eksplisit.
import http from "http";
import os from "os";
import fs from "fs";
import path from "path";

// HOME sementara supaya cache/katalog tidak menyentuh data asli
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uji-waktu-"));
process.env.HOME = TMP;
process.env.NO_COLOR = "1";

const hitung = {};
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  hitung[base] = (hitung[base] || 0) + 1;
  // sengaja tidak pernah menjawab → memicu timeout di klien
  // (koneksi dibiarkan menggantung sampai klien abort)
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/v1`;

const { panggilChat } = await import(new URL("../src/api/klien.js", import.meta.url).href);

const cfg = {
  apiKey: "uji",
  baseUrl: BASE,
  baseCadangan: BASE,        // host sama → 1 URL per tahap
  model: "model-uji",
  modelCadangan: "model-cadangan-uji",
  maxTokens: 16,
  suhu: 0,
  streamDefault: true,
};

async function jalankan(nama, opsi) {
  const t0 = Date.now();
  let pesan = "";
  try {
    await panggilChat(cfg, [{ role: "user", content: "halo" }], null, opsi);
    pesan = "(tidak error?)";
  } catch (e) {
    pesan = e.message.slice(0, 70);
  }
  const ms = Date.now() - t0;
  console.log(`${nama}: ${ms} ms → ${pesan}`);
  return ms;
}

const hasil = {};

// 1) Anggaran total kecil: 3 dtk, batas per percobaan 5 dtk → harus berhenti ~3 dtk
hitung[BASE] = 0;
hasil.totalKecil = await jalankan("anggaranTotal=3s, timeout/percobaan=5s", { detikTimeout: 5, detikTotal: 3 });

// 2) detikTimeout=2, detikTotal=2 → satu percobaan saja, berhenti ~2 dtk
hasil.timeoutKecil = await jalankan("detikTimeout=2, detikTotal=2", { detikTimeout: 2, detikTotal: 2 });

// 3) default detikTimeout kecil (2) tanpa detikTotal → bawaan detikTotal=32,
//    tapi harus selesai jauh sebelum 40 menit (kasus bug lama)
hasil.bawaan = await jalankan("detikTimeout=2 (detikTotal bawaan)", { detikTimeout: 2 });

server.close();

const ok1 = hasil.totalKecil >= 2500 && hasil.totalKecil < 4500;
const ok2 = hasil.timeoutKecil >= 1800 && hasil.timeoutKecil < 3200;
const ok3 = hasil.bawaan < 40000;
console.log(`\nanggaran total dipatuhi: ${ok1 ? "✅" : "❌"}`);
console.log(`detikTimeout konsisten (~2 dtk): ${ok2 ? "✅" : "❌"}`);
console.log(`tidak melebar berlipat (bawaan < 40 dtk): ${ok3 ? "✅" : "❌"}`);
process.exit(ok1 && ok2 && ok3 ? 0 : 1);
