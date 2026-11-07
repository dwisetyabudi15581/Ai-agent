// Uji: BASE_CADANGAN / BASE_URL_CADANGAN dari env benar-benar sampai ke
// cfg.baseCadangan, dan daftarUrl() memakainya sebagai host kedua (failover).
//
// PENTING: src/paths.js menghitung DIR_DATA dari $HOME saat impor, jadi HOME
// harus diganti SEBELUM impor dinamis. muatConfig juga membaca ./.env di cwd,
// maka cwd wajib diisolasi (process.chdir) sebelum impor.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOME_ASLI = process.env.HOME;
const CWD_ASLI = process.cwd();

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-uji-cadangan-"));
process.env.HOME = tmp;
process.chdir(tmp); // isolasi dari ./.env repo

// Path TEMPAT_CONFIG juga dihitung dari $HOME saat impor → ambil dari modul,
// jangan menebak lokasinya.
const { muatConfig, simpanConfig, daftarUrl, BERKAS_CONFIG } =
  await import(path.join(ROOT, "src/config/config.js")
    .replace(/\\/g, "/")).then(async (m) => m);

let lulus = 0;
let gagal = 0;
function cek(nama, kondisi, info = "") {
  if (kondisi) {
    lulus++;
    console.log(`  ✓ ${nama}`);
  } else {
    gagal++;
    console.log(`  ✗ ${nama} ${info}`);
  }
}

function setEnv(env) {
  for (const k of ["BASE_URL", "API_KEY", "BASE_CADANGAN", "BASE_URL_CADANGAN"]) delete process.env[k];
  Object.assign(process.env, env);
}

// 1. BASE_CADANGAN nama lama terbaca
setEnv({ BASE_URL: "https://utama.example.com/v1", BASE_CADANGAN: "https://cadangan.example.net/v1" });
let cfg = await muatConfig();
cek("BASE_CADANGAN (nama lama) masuk ke cfg.baseCadangan",
  cfg.baseCadangan === "https://cadangan.example.net/v1",
  `→ ${JSON.stringify(cfg.baseCadangan)}`);

// 2. Nama baru BASE_URL_CADANGAN menang bila keduanya diisi
setEnv({
  BASE_URL: "https://utama.example.com/v1",
  BASE_CADANGAN: "https://lama.example.org/v1",
  BASE_URL_CADANGAN: "https://baru.example.io/v1",
});
cfg = await muatConfig();
cek("BASE_URL_CADANGAN (nama baru) diutamakan",
  cfg.baseCadangan === "https://baru.example.io/v1",
  `→ ${JSON.stringify(cfg.baseCadangan)}`);

// 3. daftarUrl: stream = utama dulu, non-stream = cadangan dulu
setEnv({ BASE_URL: "https://utama.example.com/v1", BASE_CADANGAN: "https://cadangan.example.net/v1" });
cfg = await muatConfig();
const urutStream = daftarUrl(cfg, { stream: true });
const urutBiasa = daftarUrl(cfg, { stream: false });
cek("daftarUrl stream: utama → cadangan",
  urutStream[0] === "https://utama.example.com/v1/chat/completions" &&
  urutStream[1] === "https://cadangan.example.net/v1/chat/completions",
  `→ ${JSON.stringify(urutStream)}`);
cek("daftarUrl non-stream: utama → cadangan",
  urutBiasa[0] === "https://utama.example.com/v1/chat/completions" &&
  urutBiasa[1] === "https://cadangan.example.net/v1/chat/completions",
  `→ ${JSON.stringify(urutBiasa)}`);

// 4. Tanpa cadangan hanya satu host
setEnv({ BASE_URL: "https://utama.example.com/v1" });
cfg = await muatConfig();
cek("tanpa cadangan, daftarUrl hanya satu host",
  daftarUrl(cfg).length === 1,
  `→ ${JSON.stringify(daftarUrl(cfg))}`);

// 5. Endpoint lengkap /v1/chat/completions dinormalkan, tidak dobel
setEnv({
  BASE_URL: "https://utama.example.com/v1",
  BASE_CADANGAN: "https://cadangan.example.net/v1/chat/completions",
});
cfg = await muatConfig();
const dinorm = daftarUrl(cfg, { stream: true });
cek("cadangan berakhiran /chat/completions tidak jadi dobel",
  dinorm[1] === "https://cadangan.example.net/v1/chat/completions",
  `→ ${JSON.stringify(dinorm)}`);

// 6. baseUrl & baseCadangan tidak pernah ditulis ke config.json
setEnv({ BASE_URL: "https://utama.example.com/v1", BASE_CADANGAN: "https://cadangan.example.net/v1" });
cfg = await muatConfig();
await simpanConfig(cfg);
cek("BERKAS_CONFIG berada di dalam HOME sementara",
  BERKAS_CONFIG.startsWith(tmp),
  `→ ${BERKAS_CONFIG}`);
const mentah = JSON.parse(await fs.readFile(BERKAS_CONFIG, "utf-8"));
cek("baseUrl & baseCadangan tidak tersimpan ke disk",
  !("baseUrl" in mentah) && !("baseCadangan" in mentah),
  `→ kunci: ${Object.keys(mentah).join(",")}`);

process.chdir(CWD_ASLI);
if (HOME_ASLI !== undefined) process.env.HOME = HOME_ASLI;
await fs.rm(tmp, { recursive: true, force: true });

console.log(`\nHasil: ${lulus} lulus / ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
