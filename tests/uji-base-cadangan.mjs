// Uji: BASE_CADANGAN / BASE_URL_CADANGAN benar-benar sampai ke cfg.baseCadangan
// dan dipakai daftarUrl() sebagai URL kedua.
//
// Catatan penting: daftarUrl() mengembalikan URL PENUH ".../chat/completions"
// (bukan basis), jadi ekspektasi harus memakai bentuk penuh itu.
//
// PENTING: paths.js menghitung DIR_DATA dari $HOME saat impor; HOME diganti dulu.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// RELINK_* ikut disimpan/dibersihkan: nama lama itu masih dibaca sebagai alias,
// jadi kalau dibiarkan di env asli ia akan mengalahkan nilai uji di sini.
const KUNCI = [
  "API_KEY", "BASE_URL", "BASE_CADANGAN", "BASE_URL_CADANGAN", "MODEL",
  "RELINK_API_KEY", "RELINK_BASE_URL", "RELINK_BASE_CADANGAN", "RELINK_BASE_URL_CADANGAN",
];
const asli = { HOME: process.env.HOME };
for (const k of KUNCI) asli[k] = process.env[k];
const cwdAsli = process.cwd();
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-cadangan-"));
process.chdir(tmp);
process.env.HOME = tmp;
process.env.API_KEY = "sk-uji";
process.env.BASE_URL = "https://utama.example.com/v1";
for (const k of ["BASE_CADANGAN", "BASE_URL_CADANGAN", "MODEL", "RELINK_API_KEY", "RELINK_BASE_URL", "RELINK_BASE_CADANGAN", "RELINK_BASE_URL_CADANGAN"]) delete process.env[k];

const { muatConfig, daftarUrl } = await import("../src/config/config.js");

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  ok ? lulus++ : gagal++;
  console.log(`${ok ? "OK   " : "GAGAL"} ${nama}: ${JSON.stringify(dapat)}` + (ok ? "" : ` | harusnya ${JSON.stringify(harus)}`));
};
const U = (b) => `${b}/chat/completions`;

try {
  // 1) tanpa cadangan
  let cfg = await muatConfig();
  cek("tanpa cadangan: baseCadangan kosong", cfg.baseCadangan || "", "");
  cek("tanpa cadangan: daftarUrl 1 URL", daftarUrl(cfg), [U("https://utama.example.com/v1")]);

  // 2) nama generik BASE_CADANGAN (akiran /chat/completions & garis miring dibersihkan)
  process.env.BASE_CADANGAN = "https://cadangan.example.com/v1/chat/completions";
  cfg = await muatConfig();
  cek("BASE_CADANGAN terbaca apa adanya", cfg.baseCadangan, "https://cadangan.example.com/v1/chat/completions");
  cek("daftarUrl memuat 2 URL bersih", daftarUrl(cfg), [
    U("https://utama.example.com/v1"),
    U("https://cadangan.example.com/v1"),
  ]);

  // 3) urutan non-stream: cadangan didahulukan
  cek("daftarUrl non-stream cadangan dulu", daftarUrl(cfg, { stream: false }), [
    U("https://cadangan.example.com/v1"),
    U("https://utama.example.com/v1"),
  ]);

  // 4) alias lama BASE_URL_CADANGAN
  delete process.env.BASE_CADANGAN;
  process.env.BASE_URL_CADANGAN = "https://lama.example.com/v1";
  cfg = await muatConfig();
  cek("alias lama BASE_URL_CADANGAN terbaca", cfg.baseCadangan, "https://lama.example.com/v1");

  // 5) nama generik menang atas alias lama
  //    Alias lama WAJIB dihapus dulu: kalau masih ada, ambilEnv() membacanya
  //    dan uji ini jadi salah sasaran (bukan menguji prioritas).
  delete process.env.BASE_URL_CADANGAN;
  process.env.BASE_CADANGAN = "https://baru.example.com/v1";
  cfg = await muatConfig();
  cek("nama generik menang", cfg.baseCadangan, "https://baru.example.com/v1");

  // 6) cadangan identik dengan utama tidak diduplikasi
  process.env.BASE_CADANGAN = "https://utama.example.com/v1/";
  cfg = await muatConfig();
  cek("cadangan identik tidak diduplikasi", daftarUrl(cfg), [U("https://utama.example.com/v1")]);

  // 7) config.json tidak boleh membawa baseCadangan basi (samakan dgn baseUrl/apiKey)
  process.env.BASE_CADANGAN = "https://env.example.com/v1";
  cfg = await muatConfig();
  await fs.mkdir(path.join(tmp, ".config", "agent-termux"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, ".config", "agent-termux", "config.json"),
    JSON.stringify({ baseCadangan: "https://basi.example.com/v1" })
  );
  delete process.env.BASE_CADANGAN;
  cfg = await muatConfig();
  cek("baseCadangan basi di config.json diabaikan", cfg.baseCadangan || "", "");
} finally {
  process.chdir(cwdAsli);
  process.env.HOME = asli.HOME;
  for (const k of KUNCI) {
    if (asli[k] === undefined) delete process.env[k]; else process.env[k] = asli[k];
  }
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\nHASIL: ${gagal === 0 ? "LULUS" : "GAGAL"} — lulus ${lulus}, gagal ${gagal}`);
process.exit(gagal === 0 ? 0 : 1);
