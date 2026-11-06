// UJI SINKRONISASI DOKUMENTASI RE:LINK
// Dokumentasi https://relink-gateway.biz.id/#docs menyebut:
//   • "Multiplier adalah pengali konsumsi token untuk setiap model" (1:1 pada 1x)
//   • "(prompt + completion) × multiplier. Hasilnya dibulatkan dan dikurangi
//      dari quota." Contoh resmi: (800 + 1.200) × 1.5 = 3.000
//   • Simbol "×" di UI gateway SELALU berarti multiplier.
//
// Uji ini memastikan kode TIDAK bentrok dengan ketiga aturan itu, tanpa
// memanggil jaringan (murni baca sumber + hitung).
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buatPencatatToken } from "../src/core/statistik.js";
import { PRESET_RELINK } from "../src/api/preset-model.js";

const akar = join(dirname(fileURLToPath(import.meta.url)), "..");
const idx = fs.readFileSync(join(akar, "index.js"), "utf8");
const stat = fs.readFileSync(join(akar, "src/core/statistik.js"), "utf8");

let lulus = 0, gagal = 0;
const cek = (nama, syarat, info = "") => {
  if (syarat) { lulus++; console.log("  ✓", nama); }
  else { gagal++; console.log("  ✗", nama, info); }
};

console.log("--- SINKRON DOKUMENTASI RE:LINK ---");

// 1. Rumus kuota = (prompt + completion) × multiplier, dibulatkan per model.
{
  const t = buatPencatatToken();
  // contoh resmi dokumentasi: 800 prompt + 1.200 completion pada model 1.5x
  t.catatPanggilan({ prompt_tokens: 800, completion_tokens: 1200 }, "contoh-1.5x", 1.5);
  const s = t.ringkas(1.5);
  cek("contoh resmi (800+1.200)×1.5 = 3.000", s.kuota === 3000, `dapat ${s.kuota}`);
}

// 2. Pembulatan dilakukan PER REQUEST (dokumentasi: "hasilnya dibulatkan"),
//    di sini diuji lewat dua panggilan yang masing-masing berpecahan.
{
  const t = buatPencatatToken();
  t.catatPanggilan({ prompt_tokens: 10, completion_tokens: 3 }, "x", 1.5); // 13×1.5=19.5 → 20
  t.catatPanggilan({ prompt_tokens: 10, completion_tokens: 3 }, "x", 1.5); // 13×1.5=19.5 → 20
  const s = t.ringkas(1.5);
  // kalau dibulatkan SETELAH dijumlah: 26×1.5 = 39 → berbeda dari 40
  cek("dibulatkan per model (bukan total akhir)", s.kuota === 40, `dapat ${s.kuota} (harus 40, bukan 39)`);
}

// 3. Multiplier 1 = 1:1 terhadap quota (pernyataan eksplisit dokumentasi).
{
  const t = buatPencatatToken();
  t.catatPanggilan({ prompt_tokens: 1000, completion_tokens: 0 }, "auto", 1);
  cek("multiplier 1 → 1:1 (1.000 token = 1.000 kuota)", t.ringkas(1).kuota === 1000);
}

// 4. BENTROK SIMBOL: "×" di UI gateway hanya untuk multiplier → jumlah panggilan
//    tidak boleh ditulis dengan pola "<n>x" / "<n>×" di panel /token.
{
  const adaPanggilanX = /panggilan\}\\s*\\$\\{C\\.samar\\}\\$\\{m\\.panggilan\\}x/.test(idx);
  const polaNx = /\$\{m\.panggilan\}x/.test(idx);
  cek("jumlah panggilan TIDAK ditulis 'nx' (bentrok × docs)", !polaNx && !adaPanggilanX);
  cek("jumlah panggilan ditulis 'n panggilan'", /\$\{m\.panggilan\} panggilan/.test(idx));
}

// 5. Setiap kemunculan "×" pada baris kuota harus berdampingan dengan multiplier.
{
  const barisKuota = idx.split("\n").filter((l) => /kuota terpotong|multiplier \$\{mm\}/i.test(l));
  const semuaMult = barisKuota.every((l) => !/×/.test(l) || /multiplier|×\$\{/.test(l));
  cek("setiap '×' pada baris kuota menyertakan kata multiplier", semuaMult, barisKuota.length + " baris diperiksa");
}

// 6. Preset memakai istilah & tipe yang sama: multiplier angka, 1 = termurah.
{
  const semuaAngka = PRESET_RELINK.every((m) => typeof m.multiplier === "number" && m.multiplier > 0);
  const adaSatu = PRESET_RELINK.some((m) => m.multiplier === 1);
  cek("preset: multiplier selalu angka > 0", semuaAngka);
  cek("preset: ada model multiplier 1 (default 1:1 docs)", adaSatu);
  cek("preset: id 'auto' = Multiplier 1× (sesuai kartu docs)", PRESET_RELINK.find((m) => m.id === "auto")?.multiplier === 1);
  cek("preset: glm-5.3-flash mult 2 (sesuai kartu docs)", PRESET_RELINK.find((m) => m.id === "glm-5.3-flash")?.multiplier === 2);
  cek("preset: claude-opus-5 mult 20 (sesuai kartu docs)", PRESET_RELINK.find((m) => m.id === "claude-opus-5")?.multiplier === 20);
}

// 7. Komentar sumber menyebut rujukan dokumentasi (jejak agar tidak hilang).
{
  cek("statistik.js merujuk docs Re:Link", /dokumentasi Re:Link/i.test(stat));
  cek("index.js menyebut aturan simbol × docs", /×.*HANYA untuk multiplier/i.test(idx));
}

console.log(`\n${lulus} lulus · ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
