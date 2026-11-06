// Uji RUNTIME perintah /token: ekstrak blok case "token" APA ADANYA dari
// index.js, lalu jalankan dengan data pencatat nyata + cek tidak ada crash,
// tidak ada "undefined"/"NaN", dan peringatan usage tidak-lengkap muncul jujur.
import fs from "fs";
import { panel } from "../src/ui/tampilan.js";
import { C, bubble } from "../src/ui/util.js";
import { buatPencatatToken, nf, persen } from "../src/core/statistik.js";

const src = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const TANDA = 'case "token": {';
const i = src.indexOf(TANDA);
const j = src.indexOf('case "biaya"');
if (i < 0 || j < 0) {
  console.error("GAGAL: blok case token/biaya tidak ditemukan (i=" + i + ", j=" + j + ")");
  process.exit(1);
}
// dari "case" sampai tepat sebelum case biaya (buang komentar di atasnya)
const blok = src.slice(i, j);

const t = buatPencatatToken();
t.catatPanggilan(
  {
    prompt_tokens: 525,
    completion_tokens: 512,
    completion_tokens_details: { reasoning_tokens: 340 },
    prompt_tokens_details: { cached_tokens: 400 },
  },
  "glm-5.3-flash",
  5,
);
t.catatPanggilan({ prompt_tokens: 111932, completion_tokens: 120 }, "deepseek-v4-pro", 10);
t.catatPanggilan(null, "deepseek-v4-pro", 10); // usage kosong → wajib diperingatkan
t.catatPemadatan(
  [{ role: "user", content: "x".repeat(279812) }],
  [{ role: "user", content: "x".repeat(16905) }],
);

const cfg = { model: "glm-5.3-flash" };
const agen = { ringkasToken: () => t.ringkas() };

// new Function biasa TIDAK boleh memuat await (blok case /token memakai await ambilKatalog).
// Pakai konstruktor AsyncFunction agar blok bisa diekstrak APA ADANYA tanpa dimodifikasi.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fn = new AsyncFunction(
  "perintah", "panel", "C", "bubble", "nf", "persen", "agen", "cfg", "ambilKatalog",
  "switch(perintah){ " + blok + " default: return false; }",
);

let out = [];
const orig = process.stdout.write.bind(process.stdout);
process.stdout.write = (s) => { out.push(String(s)); return true; };
let ok = true, err = null, ret;
try {
  ret = await fn("token", panel, C, bubble, nf, persen, agen, cfg, async () => {
    throw new Error("katalog offline"); // uji jalur katalog gagal → kelas harga "?"
  });
} catch (e) { ok = false; err = e; }
await Promise.resolve(ret); // case async: pastikan promise-nya selesai sebelum dibaca
process.stdout.write = orig;

const bersih = out.join("").replace(/\x1b\[[0-9;]*m/g, "").replace(/\u0000/g, "");
console.log("--- HASIL /token (ANSI dibersihkan) ---");
console.log(bersih || "(KOSONG)");

let lulus = 0, gagal = 0;
const cek = (nama, syarat, info = "") => {
  if (syarat) { lulus++; console.log("  ✓", nama); }
  else { gagal++; console.log("  ✗", nama, info); }
};

console.log("--- VERIFIKASI ---");
cek("blok ter-ekstrak dari index.js", blok.length > 500, `panjang ${blok.length}`);
cek("tidak exception", ok, err ? err.message : "");
cek("return true (perintah ditangani)", ret === true, `dapat ${ret}`);
cek("tidak ada 'undefined' di layar", !/undefined/.test(bersih));
cek("tidak ada 'NaN' di layar", !/NaN/.test(bersih));
cek("bagian PENGHEMATAN muncul", /PENGHEMATAN PEMADATAN RIWAYAT/.test(bersih));
cek("persen hemat 94.0% ditampilkan", /HEMAT\s*94\.0%/.test(bersih), bersih.match(/HEMAT[^\n]*/)?.[0] || "-");
cek("kuota dibagi per model", /glm-5\.3-flash/.test(bersih) && /deepseek-v4-pro/.test(bersih));
cek("kuota awal 5.185 (=1037×5) benar", /5\.185/.test(bersih), "cek perkalian multiplier");
cek("peringatan usage muncul", /tidak mengirim data usage/.test(bersih));
cek("format angka Indonesia (titik)", /111\.932/.test(bersih));

console.log(`\n${lulus} lulus · ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
