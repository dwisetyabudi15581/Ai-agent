// Uji unit penjaga keluar (Ctrl+C aman).
// Skenario: simpanSesi async MENGGANTUNG + arsip transkrip lambat (5 dtk).
// Ekspektasi: keluar < 5 dtk, berkas sesi tetap ditulis (jalur sinkron),
// arsip TIDAK ditunggu, dan pesan "Sampai jumpa" tercetak tepat sekali.
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "uji-keluar-"));

// --- Intersepsi BEFORE lib_util dimuat: blokir keyakinan import.meta di lib_sesi
// dengan memasang process.exit tiruan lebih dulu.
const exitAsli = process.exit;
let keluarDipanggil = 0;
let kodeKeluar = null;
let t0 = Date.now();
let sudahCek = false;
process.exit = (kode = 0) => {
  if (sudahCek) return;
  sudahCek = true;
  keluarDipanggil++;
  kodeKeluar = kode;
  const ms = Date.now() - t0;
  const d = process.env.__DIR_SESI;
  const berkas = path.join(d, "ujikeluar.json");
  const ada = fs.existsSync(berkas);
  const pesan = ada ? (JSON.parse(fs.readFileSync(berkas, "utf8")).messages || []).length : 0;
  const hasil = { kode, ms, berkasAda: ada, jumlahPesan: pesan, arsipDitunggu: globalThis.__arsipSelesai === true };
  console.log(JSON.stringify(hasil));
  const lulus = kode === 0 && ms < 5000 && ada && pesan === 1 && hasil.arsipDitunggu === false;
  console.log(lulus ? "HASIL: LULUS ✅" : "HASIL: GAGAL ❌");
  exitAsli(lulus ? 0 : 1);
};

// HOME sementara harus di-set sebelum lib_util dievaluasi.
process.env.HOME = TMP;
process.env.NO_COLOR = "1";

const util = await import(fileURLToPath(new URL("../src/paths.js", import.meta.url)));
process.env.__DIR_SESI = util.DIR_SESI;
await fs.promises.mkdir(util.DIR_SESI, { recursive: true });

// Bikin simpanSesi async menggantung: ganti named export di modul lib_sesi.
const sesiMod = await import(fileURLToPath(new URL("../src/core/sesi.js", import.meta.url)));
if (typeof sesiMod.simpanSesi === "function") {
  try { sesiMod.simpanSesi = async () => new Promise(() => {}); } catch {}
}
const keluarMod = await import(fileURLToPath(new URL("../src/ui/keluar.js", import.meta.url)));

const sesi = { id: "ujikeluar", judul: "uji", messages: [{ role: "user", content: "halo" }] };
keluarMod.siapkanKeluar(sesi, async () => {
  await new Promise((r) => setTimeout(r, 5000));
  globalThis.__arsipSelesai = true;
});

t0 = Date.now();
keluarMod.keluarAman("Ctrl+C", 0);          // panggilan pertama
setTimeout(() => keluarMod.keluarAman("ganda", 1), 10); // panggilan kedua: harus dedup

// Jaring pengaman: kalau 12 dtk tidak keluar, uji dianggap gagal.
setTimeout(() => {
  console.log("HASIL: GAGAL ❌ (tidak keluar dalam 12 dtk)");
  exitAsli(1);
}, 12000).unref?.();
