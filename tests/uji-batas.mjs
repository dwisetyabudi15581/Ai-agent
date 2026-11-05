// Uji: batas putaran yang DISET EKSPLISIT harus dihormati, dan hasil kerja
// tidak boleh dibuang saat batas tercapai.
//
// Latar: sebelumnya uji ini mengunci angka mati 20 (perilaku lama). Sejak
// maksPutaran 0 = TANPA BATAS jadi bawaan, uji harus menyetel batas sendiri —
// kalau tidak, loop memang sengaja berjalan tanpa henti dan uji akan
// menggantung bukan karena bug.
import fs from "fs/promises";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const AKAR = fileURLToPath(new URL("..", import.meta.url));
const SRC_AGEN = path.join(AKAR, "src", "core", "agen.js");

const catat = [];
const ok = (s) => catat.push(["LULUS", s]);
const gagal = (s) => catat.push(["GAGAL", s]);

// Tiruan panggilChat: model bandel yang SELALU minta tool, tanpa kemajuan.
// Satu-satunya jalan keluar adalah batas putaran yang diset uji.
async function muatAgenTiruan() {
  let src = await fs.readFile(SRC_AGEN, "utf8");
  src = src.replace(/import \{ panggilChat \} from [^;]+;/,
    `const panggilChat = async () => ({ pesan: { role: "assistant", content: "mengerjakan langkah",
      tool_calls: [{ id: "x" + Math.random(), function: { name: "cek", arguments: "{}" } }] },
      model: "tiruan", usage: { prompt_tokens: 1, completion_tokens: 1 } });`);
  // Impor relatif lain → URL absolut (berkas tiruan ditulis di akar repo,
  // sedangkan impor agen dihitung dari lokasi asalinya di src/core/).
  src = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (semua, rel) =>
    `from ${JSON.stringify(pathToFileURL(path.join(AKAR, "src", "core", rel)).href)}`);
  const f = path.join(AKAR, ".agen-uji2.mjs");
  await fs.writeFile(f, src);
  const mod = await import(pathToFileURL(f).href + "?t=" + Date.now());
  return { mod, f };
}

function cfgUji(maksPutaran, maksTool = 0) {
  return {
    model: "tiruan", verbose: false, autoCompact: false, batasKonteks: 1e9,
    routingOtomatis: false, maksPutaran, maksTool,
  };
}

const { mod, f } = await muatAgenTiruan();

// ── Skenario 1: batas 20 dihormati, hasil tidak dibuang ───────────────────
{
  const sesi = { id: "uji-batas-20", messages: [{ role: "user", content: "kerjakan" }] };
  const agen = await mod.buatAgen({
    cfg: cfgUji(20), tools: [], eksekusiTool: async () => ({ raw: "ok" }), sesi,
  });
  const hasil = await agen.giliran("auto");
  const n = sesi.messages.filter((m) => m.role === "assistant").length;
  console.log("\n=== UJI BATAS (eksplisit 20) ===");
  console.log("hasil   :", JSON.stringify(hasil));
  console.log("putaran :", n, "| pesan:", sesi.messages.length);

  if (n === 20) ok(`batas 20 dihormati (putaran assistant = ${n})`);
  else gagal(`batas 20 TIDAK dihormati → ${n} putaran`);

  if (hasil.mentok === true) ok("mentok=true saat batas tercapai");
  else gagal(`mentok bukan true → ${JSON.stringify(hasil)}`);

  if (hasil.selesai === true) ok("selesai=true: konteks tidak dibuang saat batas kena");
  else gagal(`selesai seharusnya true (ada teks) → ${JSON.stringify(hasil)}`);

  const balasan = sesi.messages.filter((m) => m.role === "tool").length;
  if (balasan === 20) ok(`20 tool_call dibalas lengkap (balasan=${balasan})`);
  else gagal(`balasan tool = ${balasan}, harusnya 20`);
}

// ── Skenario 2: batas 3 (bukan angka mati) — bukti nilai cfg dipakai ──────
{
  const sesi = { id: "uji-batas-3", messages: [{ role: "user", content: "kerjakan" }] };
  const agen = await mod.buatAgen({
    cfg: cfgUji(3), tools: [], eksekusiTool: async () => ({ raw: "ok" }), sesi,
  });
  const hasil = await agen.giliran("auto");
  const n = sesi.messages.filter((m) => m.role === "assistant").length;

  if (n === 3) ok(`batas 3 dihormati (bukan konstanta mati 20) → ${n} putaran`);
  else gagal(`batas 3 tidak dihormati → ${n} putaran`);

  if (hasil.mentok === true) ok("mentok=true pada batas 3");
  else gagal(`mentok bukan true → ${JSON.stringify(hasil)}`);
}

// ── Skenario 3: batas 0 = TANPA BATAS, tapi rem mentok memutus loop ───────
// Model bandel di sini TIDAK memakai kalimat pemicu mentok, jadi rem (b) tidak
// kena. Yang diuji: pastikan loop TIDAK berhenti di 20 (bukti batas benar-benar
// dilepas). Loop diputus dari luar lewat maksTool sebagai rem deterministik.
{
  const sesi = { id: "uji-batas-0", messages: [{ role: "user", content: "kerjakan" }] };
  const agen = await mod.buatAgen({
    cfg: cfgUji(0, 35), tools: [], eksekusiTool: async () => ({ raw: "ok" }), sesi,
  });
  const t0 = Date.now();
  const hasil = await agen.giliran("auto");
  const ms = Date.now() - t0;
  const n = sesi.messages.filter((m) => m.role === "assistant").length;

  if (n > 20) ok(`batas 0 melewati ambang lama 20 → ${n} putaran (bukti tanpa batas)`);
  else gagal(`batas 0 terhenti di ${n} putaran (seharusnya melewati 20)`);

  if (ms < 5000) ok(`loop tidak menggantung (${ms}ms, rem maksTool=35)`);
  else gagal(`loop terlalu lama → ${ms}ms`);

  if (hasil.mentok === true) ok("mentok=true saat rem maksTool menahan");
  else gagal(`harusnya mentok=true → ${JSON.stringify(hasil)}`);
}

await fs.unlink(f).catch(() => {});

console.log("\n=== RINGKASAN UJI BATAS ===");
for (const [s, t] of catat) console.log(`${s === "LULUS" ? "✅" : "❌"} ${s}: ${t}`);
const jumlahGagal = catat.filter(([s]) => s === "GAGAL").length;
console.log(`\n${catat.length - jumlahGagal}/${catat.length} lulus`);
console.log(jumlahGagal ? "HASIL: GAGAL ❌" : "HASIL: LULUS ✅");
process.exit(jumlahGagal ? 1 : 0);
