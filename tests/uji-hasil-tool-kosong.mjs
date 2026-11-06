/**
 * Uji regresi: isi pesan `role: "tool"` tidak boleh kosong.
 *
 * Bug asal: `content: keluar.raw ?? keluar.detail ?? ""` — operator ?? hanya
 * menangkap null/undefined, jadi raw = "" (string kosong) LOLOS dan mengirim
 * content kosong ke model. Model membaca "tool selesai tanpa hasil", lalu
 * memanggil tool yang sama lagi sampai batas eksekusi tercapai (gejala:
 * "batas 50 eksekusi tool tercapai" padahal tool memang berhasil).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..");
const sumber = fs.readFileSync(path.join(ROOT, "src/core/agen.js"), "utf8");

let lulus = 0;
let gagal = 0;
function cek(nama, kondisi, info = "") {
  if (kondisi) {
    lulus++;
    console.log(`  ✓ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✗ ${nama}${info ? " — " + info : ""}`);
  }
}

// --- 1. Pola lama tidak boleh muncul lagi di penulisan pesan tool ---
const polaBug = /content:\s*keluar\.raw\s*\?\?\s*keluar\.detail/;
cek("pola `raw ?? detail` sudah tidak dipakai", !polaBug.test(sumber));

// --- 2. Logika pemilihan isi direplikasi & diuji perilakunya ---
function pilihIsi(keluar) {
  const isiMentah = typeof keluar.raw === "string" ? keluar.raw.trim() : "";
  const isiCadangan = [
    keluar.detail,
    keluar.judul,
    keluar.ok === false ? "Error: tool gagal tanpa detail." : "",
  ].find((s) => typeof s === "string" && s.trim());
  return isiMentah || isiCadangan || "(tool selesai tanpa keluaran teks)";
}

const kasus = [
  ["raw kosong, detail ada → pakai detail", { raw: "", detail: "68 files" }, "68 files"],
  ["raw kosong tanpa spasi → pakai detail", { raw: "   \n\t", detail: "isi" }, "isi"],
  ["raw null → pakai detail", { raw: null, detail: "isi" }, "isi"],
  ["raw undefined → pakai judul", { judul: "daftar folder" }, "daftar folder"],
  ["raw berisi → raw dipakai apa adanya", { raw: "out", detail: "detail" }, "out"],
  [
    "semua kosong + ok=false → pesan galat eksplisit",
    { raw: "", detail: "", ok: false },
    "Error: tool gagal tanpa detail.",
  ],
  [
    "benar-benar kosong → placeholder aman",
    { raw: "" },
    "(tool selesai tanpa keluaran teks)",
  ],
];

for (const [nama, input, harap] of kasus) {
  const hasil = pilihIsi(input);
  cek(nama, hasil === harap, `dapat ${JSON.stringify(hasil)}`);
}

// --- 3. Tidak ada content kosong untuk bentuk apa pun ---
const semuaKosong = [
  { raw: "" },
  { raw: " ", detail: " " },
  { raw: null, detail: null },
  {},
].map(pilihIsi);
cek(
  "semua kombinasi kosong menghasilkan string tak kosong",
  semuaKosong.every((s) => typeof s === "string" && s.trim().length > 0),
);

console.log(`\n${lulus} lulus / ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
