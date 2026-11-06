#!/usr/bin/env node
/**
 * Uji regresi: penanda gaya internal (\\u0001..\\u0008, \\u000e) tidak boleh
 * dihitung sebagai lebar visual oleh lebarTeks(). Bug lama: setiap penanda
 * dihitung 1 kolom sehingga bungkus() memotong baris yang sebenarnya masih
 * pendek, dan bubble() tampak terpotong acak.
 */
import { lebarTeks, bungkus, terapkanGaya, bubble } from "../src/ui/util.js";

let lulus = 0;
let gagal = 0;
const cek = (nama, dapat, harap) => {
  const ok = dapat === harap;
  ok ? lulus++ : gagal++;
  console.log(`${ok ? "✓" : "✗"} ${nama}: dapat=${JSON.stringify(dapat)} harap=${JSON.stringify(harap)}`);
};

// 1. Penanda gaya tidak menambah lebar.
cek("bullet \\u0005 diabaikan", lebarTeks("\u0005teks bullet"), 11);
cek("tebal \\u0001/\\u0007 diabaikan", lebarTeks("\u0001ini tebal\u0007 biasa"), 15);
cek("kode + tebal bertumpuk", lebarTeks("\u0002kode\u0007 dan \u0001tebal\u0007"), 14);
cek("blok buka/tutup", lebarTeks("\u0006x\u000e"), 1);

// 2. ANSI tetap diabaikan.
cek("ANSI diabaikan", lebarTeks("\x1b[1mabc\x1b[0m"), 3);

// 3. Emoji / wide char tetap 2 kolom.
cek("emoji 2 kolom", lebarTeks("a😀"), 3);

// 4. bungkus() tidak pernah melebihi batas, dan tidak memotong dini.
const asli = Object.getOwnPropertyDescriptor(process.stdout, "columns");
process.stdout.columns = 40;
const batas = 40;
const teks = "kata ".repeat(30).trim();
const baris = bungkus(teks, batas, 2);
cek("tidak ada baris melebihi batas", baris.filter((b) => lebarTeks(b) > batas).length, 0);
cek("teks utuh setelah dibungkus", baris.join(" ").replace(/\s+/g, " ").trim(), teks);
cek("jumlah baris wajar (>1)", baris.length > 1, true);

// 5. Baris bergaya yang muat TIDAK boleh dipotong.
const pendek = "\u0001" + "kata ".repeat(5).trim() + "\u0007";
cek("baris bergaya pendek tidak dipotong", bungkus(pendek, 40).length, 1);

// 6. bubble() membuang semua penanda gaya dari output.
const tulis = process.stdout.write.bind(process.stdout);
let keluar = "";
process.stdout.write = (s) => {
  keluar += s;
  return true;
};
bubble("user", "pertanyaan");
bubble("agent", "jawaban \u0001tebal\u0007 \u0002kode\u0007");
process.stdout.write = tulis;
const bersih = keluar.replace(/\x1b\[[0-9;]*m/g, "");
cek("bubble tanpa penanda sisa", (bersih.match(/[\u0000-\u0008\u000e]/g) || []).length, 0);
cek("bubble memuat isi", bersih.includes("pertanyaan") && bersih.includes("jawaban"), true);
cek("terapkanGaya mengubah penanda", terapkanGaya("\u0001x\u0007").includes("x"), true);

if (asli) Object.defineProperty(process.stdout, "columns", asli);

console.log(`\nRINGKAS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
