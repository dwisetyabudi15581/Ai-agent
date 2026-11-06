// Uji registry tool dinamis: bikin → muat → jalankan → dipakai eksekutor → hapus.
import fs from "fs/promises";
import { simpanTool, muatToolDinamis, segarkanCache, hapusTool, berkasTool, namaSah } from "../src/tools/registry.js";
import { buatEksekutor, daftarToolsLengkap } from "../src/tools/tools.js";

const hasil = [];
const cek = (nama, lulus, info = "") => { hasil.push({ nama, lulus, info }); };

// ---------- 1. nama tidak sah harus ditolak ----------
for (const buruk of ["../jahat", "HURUF_BESAR", "9awal", "ada-tanda", "x"]) {
  const r = await simpanTool({ nama: buruk, deskripsi: "uji" });
  cek(`tolak nama "${buruk}"`, r.ok === false, r.pesan);
}
cek("namaSah benar", namaSah("cek_baterai") === true && namaSah("../x") === false);

// ---------- 2. deskripsi kosong ditolak ----------
cek("tolak deskripsi kosong", (await simpanTool({ nama: "tanpa_desc", deskripsi: "  " })).ok === false);

// ---------- 3. tool sah tersimpan & termuat ----------
const kode = "  const { stdout } = await ctx.eksekusi(args.perintah, 10);\n  const bersih = String(stdout).trim();\n  return { judul: `putar → ${bersih}`, detail: bersih, raw: `hasil: ${bersih}`, ok: true };";
const buat = await simpanTool({
  nama: "uji_echo",
  deskripsi: "Mengembalikan output sebuah perintah shell.",
  parameter: { type: "object", properties: { perintah: { type: "string" } }, required: ["perintah"] },
  kode,
  kategori: "uji",
});
cek("simpan tool sah", buat.ok === true, buat.pesan);

const daftar = await muatToolDinamis({ paksa: true });
cek("tool termuat dari disk", daftar.some((t) => t.meta.nama === "uji_echo"), `jumlah=${daftar.length}`);

// ---------- 4. tool muncul di skema yang dilihat model ----------
const skema = await daftarToolsLengkap();
const punyaBawaan = skema.some((t) => t.function.name === "baca_file");
const punyaDinamis = skema.some((t) => t.function.name === "uji_echo");
const punyaMeta = ["bikin_tool", "hapus_tool", "lihat_tool"].every((n) => skema.some((t) => t.function.name === n));
cek("skema memuat tool bawaan", punyaBawaan);
cek("skema memuat tool dinamis", punyaDinamis, `total=${skema.length}`);
cek("skema memuat tool meta", punyaMeta);

// ---------- 5. eksekutor benar-benar menjalankan tool dinamis ----------
const eksekusi = buatEksekutor({ model: "uji" }, { cwd: process.cwd() });
const panggil = (name, args) => eksekusi({ id: "c1", function: { name, arguments: JSON.stringify(args) } });

const rJalan = await panggil("uji_echo", { perintah: "echo halo-dari-tool-dinamis" });
cek("eksekutor menjalankan tool dinamis", rJalan.ok === true && rJalan.raw.includes("halo-dari-tool-dinamis"), rJalan.raw);

// ---------- 6. ctx.eksekusi menolak perintah jelek dengan rapi (tidak crash) ----------
const rGagal = await panggil("uji_echo", { perintah: "exit 3" });
cek("galat shell ditangani", rGagal.ok === false, `ok=${rGagal.ok}`);

// ---------- 7. tool dinamis TIDAK boleh menimpa tool bawaan ----------
// Guard ada di DALAM simpanTool (registry), jadi penolakan harus terjadi di
// sini — bukan di bikin_tool saja. Berkasnya pun tidak boleh menyentuh disk:
// dulu bentrok ini "diterima", meninggalkan baca_file.tool.js mati yang
// membuat lihat_tool ambigu. Pertahanan tidak boleh bergantung pemanggil.
const bentrok = await simpanTool({ nama: "baca_file", deskripsi: "mencoba menimpa tool bawaan", kode: "  return {raw:'bajakan', ok:true};" });
cek("simpanTool tolak nama bawaan", bentrok.ok === false, bentrok.pesan);
cek("pesan penolakan menyebut bawaan", /bawaan/i.test(String(bentrok.pesan || "")), bentrok.pesan);
const adaShadow = await fs.access(berkasTool("baca_file")).then(() => true, () => false);
cek("tidak ada berkas shadow baca_file.tool.js", adaShadow === false);
const skema2 = await daftarToolsLengkap();
const jumlahBaca = skema2.filter((t) => t.function.name === "baca_file").length;
cek("bawaan tidak tertimpa di skema", jumlahBaca === 1, `jumlah=${jumlahBaca}`);
const rBaca = await panggil("baca_file", { nama_file: "./package.json" });
cek("eksekutor tetap pakai versi bawaan", rBaca.raw.includes("agent-termux") || rBaca.raw.includes("\"name\""), rBaca.raw.slice(0, 60));
await hapusTool("baca_file");

// ---------- 8. tool rusak tidak mematikan pemuatan ----------
const rusak = berkasTool("tool_rusak");
await fs.writeFile(rusak, "export const meta = { nama: 'tool_rusak' };\nexport async function jalankan( { ini sintaks rusak");
segarkanCache();
const daftar2 = await muatToolDinamis({ paksa: true });
cek("tool rusak dilewati, sisanya tetap termuat", daftar2.some((t) => t.meta.nama === "uji_echo") && !daftar2.some((t) => t.meta.nama === "tool_rusak"), `jumlah=${daftar2.length}`);
await fs.unlink(rusak);

// ---------- 9. tool yang jalankan-nya error ditangani eksekutor ----------
await simpanTool({ nama: "uji_ledak", deskripsi: "selalu melempar galat", kode: "  throw new Error('meledak disengaja');" });
segarkanCache();
await muatToolDinamis({ paksa: true });
const rLedak = await panggil("uji_ledak", {});
cek("tool yang melempar ditangkap rapi", rLedak.ok === false && String(rLedak.raw).includes("meledak disengaja"), rLedak.raw);

// ---------- 10. hapus tool ----------
const hapus = await hapusTool("uji_echo");
const daftar3 = await muatToolDinamis({ paksa: true });
cek("hapus tool dinamis", hapus.ok === true && !daftar3.some((t) => t.meta.nama === "uji_echo"));
cek("hapus tool tak ada → pesan jelas", (await hapusTool("tidak_ada_tool")).ok === false);

// ---------- bersihkan ----------
for (const n of ["uji_echo", "uji_ledak"]) await hapusTool(n);

// ---------- laporan ----------
console.log("\n=== UJI REGISTRY TOOL DINAMIS ===");
let gagal = 0;
for (const h of hasil) {
  if (!h.lulus) gagal++;
  console.log(`${h.lulus ? "✓" : "✗"} ${h.nama}${h.lulus ? "" : `  → ${h.info}`}`);
}
console.log(`\n${hasil.length - gagal}/${hasil.length} lulus`);
process.exit(gagal ? 1 : 0);
