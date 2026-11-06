// Menguji skenario BASE_URL tidak diisi sama sekali di .env / config.json.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const asli = process.env.HOME;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agentbase-"));
const dirData = path.join(tmp, ".agent-termux");
await fs.mkdir(dirData, { recursive: true });

process.env.HOME = tmp;
process.env.API_KEY = "sk-uji";
delete process.env.BASE_URL;
delete process.env.BASE_URL_CADANGAN;
// cwd terisolasi: .env di repo tidak boleh bocor
process.chdir(tmp);

let lulus = 0, gagal = 0;
const cek = (nama, dapat, harus) => {
  const ok = dapat === harus;
  ok ? lulus++ : gagal++;
  console.log(`${ok ? "OK   " : "GAGAL"} ${nama}: ${JSON.stringify(dapat)}` +
    (ok ? "" : ` (harusnya ${JSON.stringify(harus)})`));
};

// PENTING: resolusi path modul dilakukan SEBELUM HOME diganti.
const ROOT = "/data/data/com.termux/files/home/Ai-agent";
const cfgMod = await import("file://" + path.join(ROOT, "src/config/config.js"));

const cfg = await cfgMod.muatConfig();
cek("baseUrl kosong", cfg.baseUrl, "");
cek("baseCadangan kosong", cfg.baseCadangan, "");
cek("daftarUrl tanpa baseUrl", JSON.stringify(cfgMod.daftarUrl(cfg, { stream: false })), "[]");

console.log(`\nRINGKASAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
