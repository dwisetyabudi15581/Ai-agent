// Runner suite uji: TEMUKAN sendiri semua berkas uji, jangan pakai daftar manual.
//
// MENGAPA: daftar manual di package.json pernah "kehilangan" 9 suite — termasuk
// uji-tool-dinamis.mjs, yang justru GAGAL (guard nama bawaan) tanpa ada yang
// tahu karena `npm test` tetap exit 0. Daftar manual = suite baru bisa lahir
// tapi tidak pernah dijalankan. Penemuan otomatis menutup celah itu.
//
// KONTRAK berkas uji: exit code 0 = lulus, selain 0 = gagal.
// KECUALIKAN: berkas yang butuh dijalankan oleh induk (menerima UJI_PORT dari
// server mock) tidak boleh dijalankan sendiri — didaftarkan di INDUK.

import { readdir } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Dijalankan oleh induk (uji-server-mock.mjs) lewat env UJI_ANAK — bukan suite. */
const INDUK = new Set(["uji-paralel-jalan.mjs", "uji-timing-api.mjs"]);
/** Runner itu sendiri — bukan suite. */
const BUKAN_SUITE = new Set(["jalankan-semua.mjs"]);

// FILTER HANYA BERBASIS DAFTAR DI ATAS — jangan tambah aturan "awalan _ berarti
// lewati". Aturan seperti itu adalah lubang: berkas uji apa pun yang kebetulan
// diawali "_" (atau yang ingin disembunyikan) akan dijalankan... maksudnya,
// TIDAK dijalankan, dan runner tetap melaporkan SEMUA SUITE LULUS.
// Sudah dibuktikan: tests/_sengaja-rusak.mjs (exit 3) tetap memberi exit 0.
const berkas = (await readdir(DIR))
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => !INDUK.has(f) && !BUKAN_SUITE.has(f))
  .sort();

const lewat = process.argv[2]; // opsional: filter nama (mis. "tool" → uji-tool-dinamis)
const daftar = lewat ? berkas.filter((f) => f.includes(lewat)) : berkas;

if (!daftar.length) {
  console.error(`Tidak ada berkas uji yang cocok dengan filter "${lewat}".`);
  process.exit(1);
}

/** Jalankan satu suite, kembalikan {berkas, kode, detik, keluaran}. */
function jalankanSatu(f) {
  return new Promise((selesai) => {
    const mulai = Date.now();
    const anak = spawn(process.execPath, [path.join(DIR, f)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let keluaran = "";
    anak.stdout.on("data", (d) => { keluaran += d; if (process.env.UJI_VERBOSE) process.stdout.write(d); });
    anak.stderr.on("data", (d) => { keluaran += d; if (process.env.UJI_VERBOSE) process.stderr.write(d); });
    anak.on("close", (kode) => selesai({ berkas: f, kode: kode ?? 1, detik: ((Date.now() - mulai) / 1000).toFixed(1), keluaran }));
    anak.on("error", (e) => selesai({ berkas: f, kode: 1, detik: "0.0", keluaran: String(e) }));
  });
}

const hasil = [];
for (const f of daftar) {
  process.stdout.write(`  ${f.padEnd(28)} `);
  const h = await jalankanSatu(f);
  hasil.push(h);
  const ringkas = h.keluaran
    .split("\n")
    .map((b) => b.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter(Boolean)
    .pop() || "";
  console.log(`${h.kode === 0 ? "LULUS" : "GAGAL"} (${h.detik}s) ${ringkas.slice(0, 62)}`);
  if (h.kode !== 0) {
    // Tampilkan baris gagal supaya tidak perlu menjalankan ulang manual.
    const galat = h.keluaran
      .split("\n")
      .map((b) => b.replace(/\u001b\[[0-9;]*m/g, ""))
      .filter((b) => /✗|GAGAL|gagal|Error|error/i.test(b))
      .slice(0, 8);
    for (const g of galat) console.log(`      │ ${g.trim().slice(0, 100)}`);
  }
}

const gagal = hasil.filter((h) => h.kode !== 0);
const totalDetik = hasil.reduce((t, h) => t + Number(h.detik), 0).toFixed(1);

console.log("\n" + "─".repeat(58));
console.log(`SUITE: ${hasil.length} dijalankan · ${hasil.length - gagal.length} lulus · ${gagal.length} gagal · ${totalDetik}s`);
if (gagal.length) {
  console.log("GAGAL: " + gagal.map((h) => h.berkas).join(", "));
  console.log("─".repeat(58));
  process.exit(1);
}
console.log("SEMUA SUITE LULUS");
console.log("─".repeat(58));
