// Uji INJEKSI SHELL sungguhan pada cari_teks
import { buatEksekutor } from "../src/tools/tools.js";
import fs from "fs/promises";

const cfg = { baseUrl: "https://contoh.invalid/v1", apiKey: "x" };
const run = buatEksekutor(cfg, { cwd: process.cwd(), izinkanHapus: false });

await fs.rm("BUKTI-INJEKSI.txt", { force: true });

// Pola berbahaya: kutip tunggal + perintah shell
const pola = "'; touch BUKTI-INJEKSI.txt; '";
const r = await run({ function: { name: "cari_teks", arguments: JSON.stringify({ pola, folder: "./" }) } });
console.log("hasil:", r.judul, "| ok:", r.ok);

let ada = false;
try { await fs.access("BUKTI-INJEKSI.txt"); ada = true; } catch {}

console.log(ada ? "BUG: INJEKSI SHELL BERHASIL — file dibuat!" : "AMAN: tidak ada file dibuat");

// Uji tambahan: pola dengan $() dan backtick
await fs.rm("BUKTI2.txt", { force: true });
const pola2 = "$(touch BUKTI2.txt)";
await run({ function: { name: "cari_teks", arguments: JSON.stringify({ pola: pola2, folder: "./" }) } });
let ada2 = false;
try { await fs.access("BUKTI2.txt"); ada2 = true; } catch {}
console.log(ada2 ? "BUG: INJEKSI $() BERHASIL" : "AMAN: $() tidak dieksekusi");

await fs.rm("BUKTI-INJEKSI.txt", { force: true });
await fs.rm("BUKTI2.txt", { force: true });
