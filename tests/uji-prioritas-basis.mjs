// Uji: prioritas sumber BASE_URL vs BASE_URL_CADANGAN dan perlakuan
// nilai kosong di .env.
//
// Konteks: FIELD_DISIMPAN tidak memuat baseUrl/baseCadangan, jadi setelah
// simpanConfig() field itu HILANG dari config.json. Akibatnya urutan baca
// tidak boleh bergantung pada config.json untuk dua field ini — .env /
// process.env adalah satu-satunya sumber.
//
// Yang diuji:
//  1. .env berisi BASE_URL + BASE_URL_CADANGAN, process.env kosong
//     -> keduanya terpakai, base URL utama yang dipakai daftarUrl[0].
//  2. process.env menimpa .env (process.env menang).
//  3. BASE_CADANGAN (nama lama) tetap dibaca saat BASE_URL_CADANGAN kosong.
//  4. Nilai kosong ("") di .env tidak dianggap "ada" -> baseCadangan kosong,
//     daftarUrl hanya 1 URL (tidak ada URL kosong nyasar).
//  5. Urutan: URL utama SELALU index 0, cadangan index 1 (tidak terbalik)
//     meski cadangan ditulis lebih dulu di .env.
//
// PENTING: paths.js menghitung DIR_DATA dari $HOME saat impor; HOME diganti
// lebih dulu, dan ROOT repo diresolusi SEBELUM chdir.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KUNCI = [
  "API_KEY",
  "BASE_URL",
  "BASE_CADANGAN",
  "BASE_URL_CADANGAN",
  "MODEL",
];
const asli = { HOME: process.env.HOME };
for (const k of KUNCI) asli[k] = process.env[k];

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-prioritas-"));
process.chdir(tmp);
process.env.HOME = tmp;
for (const k of KUNCI) delete process.env[k];

let lulus = 0;
let gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = JSON.stringify(dapat) === JSON.stringify(harus);
  ok ? lulus++ : gagal++;
  console.log(
    `${ok ? "OK   " : "GAGAL"} ${nama}: ${JSON.stringify(dapat)}` +
      (ok ? "" : ` | harusnya ${JSON.stringify(harus)}`),
  );
};
const U = (b) => `${b}/chat/completions`;

const { muatConfig, daftarUrl } = await import(
  path.join(ROOT, "src/config/config.js")
);

const tulisEnv = async (isi) => {
  await fs.writeFile(path.join(tmp, ".env"), isi, "utf8");
  await fs.mkdir(path.join(tmp, ".agent-termux"), { recursive: true });
  await fs.writeFile(path.join(tmp, ".agent-termux", "config.json"), "{}", "utf8");
};

try {
  // --- 1) hanya dari .env ---
  await tulisEnv(
    [
      "API_KEY=sk-uji",
      "BASE_URL=https://utama.example.com/v1",
      "BASE_URL_CADANGAN=https://cadangan.example.com/v1",
      "",
    ].join("\n"),
  );
  let cfg = await muatConfig();
  cek("1 utama dari .env", cfg.baseUrl, "https://utama.example.com/v1");
  cek("1 cadangan dari .env", cfg.baseCadangan, "https://cadangan.example.com/v1");
  cek("1 daftarUrl berurutan", daftarUrl(cfg), [
    U("https://utama.example.com/v1"),
    U("https://cadangan.example.com/v1"),
  ]);

  // --- 2) process.env menang atas .env ---
  process.env.BASE_URL = "https://env-menang.example.com/v1";
  cfg = await muatConfig();
  cek("2 env menang (utama)", cfg.baseUrl, "https://env-menang.example.com/v1");
  cek("2 cadangan tetap dari .env", cfg.baseCadangan, "https://cadangan.example.com/v1");
  delete process.env.BASE_URL;

  // --- 3) alias lama BASE_CADANGAN ---
  await tulisEnv(
    [
      "API_KEY=sk-uji",
      "BASE_URL=https://utama.example.com/v1",
      "BASE_CADANGAN=https://alias.example.com/v1",
      "",
    ].join("\n"),
  );
  cfg = await muatConfig();
  cek("3 alias BASE_CADANGAN terbaca", cfg.baseCadangan, "https://alias.example.com/v1");
  cek("3 daftarUrl 2 URL", daftarUrl(cfg).length, 2);

  // --- 4) nilai kosong di .env ---
  await tulisEnv(
    [
      "API_KEY=sk-uji",
      "BASE_URL=https://utama.example.com/v1",
      "BASE_URL_CADANGAN=",
      "BASE_CADANGAN=",
      "",
    ].join("\n"),
  );
  cfg = await muatConfig();
  cek("4 cadangan kosong", cfg.baseCadangan || "", "");
  cek("4 daftarUrl hanya 1 URL", daftarUrl(cfg), [
    U("https://utama.example.com/v1"),
  ]);
  cek(
    "4 tak ada URL kosong",
    daftarUrl(cfg).some((u) => u.trim() === ""),
    false,
  );

  // --- 5) urutan tak terpengaruh urutan tulis di .env ---
  await tulisEnv(
    [
      "BASE_URL_CADANGAN=https://cadangan.example.com/v1",
      "BASE_URL=https://utama.example.com/v1",
      "API_KEY=sk-uji",
      "",
    ].join("\n"),
  );
  cfg = await muatConfig();
  const urls = daftarUrl(cfg);
  cek("5 index 0 = utama", urls[0], U("https://utama.example.com/v1"));
  cek("5 index 1 = cadangan", urls[1], U("https://cadangan.example.com/v1"));
} finally {
  process.chdir(tmp);
  for (const k of KUNCI) {
    if (asli[k] === undefined) delete process.env[k];
    else process.env[k] = asli[k];
  }
  process.env.HOME = asli.HOME;
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${lulus} lulus / ${gagal} gagal`);
if (gagal > 0) process.exitCode = 1;
