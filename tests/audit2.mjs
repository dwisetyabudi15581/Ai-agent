import { buatEksekutor } from "../src/tools/tools.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const cek = (nama, kondisi, info = "") => console.log(`${kondisi ? "OK  " : "BUG "} ${nama} ${info}`);

// Jalankan dari akar repo (hasil uji sementara di tmp-uji, di-gitignore).
const AKAR = fileURLToPath(new URL("..", import.meta.url));
const cfg = { baseUrl: "https://contoh.invalid/v1", apiKey: "x", model: "m" };
const run = buatEksekutor(cfg, { cwd: AKAR, izinkanHapus: false });

// 1) argumen JSON rusak
let r = await run({ function: { name: "baca_file", arguments: "{rusak" } });
cek("JSON rusak ditolak", r.ok === false, r.judul);
console.log("   raw:", r.raw);

// 2) tool tak dikenal
r = await run({ function: { name: "tidak_ada", arguments: "{}" } });
cek("tool tak dikenal", r.ok === false, r.judul);

// 3) hapus diblokir
r = await run({ function: { name: "hapus_file", arguments: JSON.stringify({ path: "audit1.mjs" }) } });
cek("hapus diblokir mode aman", r.ok === false, r.judul);

// 4) edit_file saat teks tidak ada
const berkasUji = path.join(AKAR, "tmp-uji", "uji-edit.txt");
await fs.mkdir(path.dirname(berkasUji), { recursive: true });
await fs.writeFile(berkasUji, "halo dunia\n");
r = await run({ function: { name: "edit_file", arguments: JSON.stringify({ nama_file: berkasUji, cari: "TIDAKADA", ganti: "x" }) } });
cek("edit gagal → ok:false", r.ok === false, r.judul);

// 5) edit_file sukses + backup
r = await run({ function: { name: "edit_file", arguments: JSON.stringify({ nama_file: berkasUji, cari: "dunia", ganti: "semesta" }) } });
cek("edit sukses", r.ok === true, r.detail);
console.log("   isi sekarang:", JSON.stringify(await fs.readFile(berkasUji, "utf-8")));

// 6) cari_teks dengan pola berisi tanda kutip & spasi (injeksi)
r = await run({ function: { name: "cari_teks", arguments: JSON.stringify({ pola: "import {", folder: "./" }) } });
cek("cari_teks pola khusus", r.ok === true, r.judul);
console.log("   hasil awal:", String(r.raw).split("\n").slice(0, 2).join(" | "));

// 7) cari_teks pola berbahaya (quote + ;) — folder bersih agar grep tidak
//    menemukan polanya di berkas uji ini sendiri (false positive lama).
r = await run({ function: { name: "cari_teks", arguments: JSON.stringify({ pola: "'; echo INJEKSI; '", folder: "./tmp-uji" }) } });
cek("cari_teks tidak eksekusi injeksi", r.ok === true && !String(r.raw).includes("INJEKSI"), JSON.stringify(r.raw).slice(0, 120));

// 8) tulis_file dengan nama_file absolut (path traversal)
r = await run({ function: { name: "tulis_file", arguments: JSON.stringify({ nama_file: "/tmp/keluar-uji.txt", isi_kode: "x" }) } });
console.log("   tulis absolut diizinkan?", r.ok, r.detail);

// 9) eksekusi_terminal timeout kecil
r = await run({ function: { name: "eksekusi_terminal", arguments: JSON.stringify({ perintah: "sleep 3", timeout_detik: 1 }) } });
cek("timeout dihormati", r.ok === false, r.judul);

// 10) cek_folder folder tidak ada
r = await run({ function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "./tidak-ada-xyz" }) } });
cek("cek_folder tidak ada → ok:false", r.ok === false, r.judul);

// 11) hapus argumen: args undefined pada ingat (fakta kosong)
r = await run({ function: { name: "ingat", arguments: "{}" } });
cek("ingat fakta kosong ditolak", r.ok === false, r.judul);

await fs.rm(berkasUji, { force: true });
