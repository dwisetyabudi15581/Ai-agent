// Uji tool baca_gambar (vision) end-to-end: mimeGambar, kebutuhanTool,
// pemasangan ambilGambarTerakhir, pembentukan multipart data-uri, jalur galat.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buatEksekutor, mimeGambar, kebutuhanTool, daftarTools } from "../src/tools/tools.js";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const akar = path.resolve(cwd, "..");
const ok = [], gagal = [];
const cek = (nama, kondisi, info = "") =>
  (kondisi ? ok : gagal).push(`${kondisi ? "LULUS" : "GAGAL"} | ${nama}${info ? " → " + info : ""}`);

// 1. mimeGambar — ekstensi harus diekstrak dari nama file, bukan dicocokkan mentah
cek("mimeGambar a.PNG", mimeGambar("a.PNG") === "image/png", mimeGambar("a.PNG"));
cek("mimeGambar x.webp", mimeGambar("x.webp") === "image/webp");
cek("mimeGambar a.jpg", mimeGambar("a.jpg") === "image/jpeg");
cek("mimeGambar a.jpeg", mimeGambar("a.jpeg") === "image/jpeg");
cek("mimeGambar a.gif", mimeGambar("a.gif") === "image/gif");
cek("mimeGambar path dalam", mimeGambar("foto/lama/a.png") === "image/png");
cek("mimeGambar nope.txt null", mimeGambar("nope.txt") === null);
cek("mimeGambar tanpa ekstensi null", mimeGambar("namafile") === null);
cek("mimeGambar kosong null", mimeGambar("") === null);
cek("mimeGambar null null", mimeGambar(null) === null);

// 2. kebutuhanTool — baca_gambar harus menandai kebutuhan model vision
cek("kebutuhanTool baca_gambar", kebutuhanTool("baca_gambar") === "vision");
cek("kebutuhanTool baca_file null", kebutuhanTool("baca_file") === null);
cek("kebutuhanTool kosong null", kebutuhanTool("") === null);

// 3. properti ambilGambarTerakhir terpasang pada eksekutor
const jalankan = buatEksekutor({}, { cwd: akar });
cek("tipe ambilGambarTerakhir", typeof jalankan.ambilGambarTerakhir === "function", typeof jalankan.ambilGambarTerakhir);
cek("ambilGambarTerakhir() awal null", jalankan.ambilGambarTerakhir() === null);

// 4. gambar nyata (PNG 1x1 piksel)
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const tmpPng = path.join(akar, "tmp-uji-1x1.png");
fs.writeFileSync(tmpPng, png);

const r = await jalankan({
  function: {
    name: "baca_gambar",
    arguments: JSON.stringify({ nama_file: "tmp-uji-1x1.png", instruksi: "baca teksnya" }),
  },
});
cek("baca_gambar sukses", r.ok === true, r.judul);
cek("pesanGambar multipart", r.pesanGambar?.role === "user" && r.pesanGambar?.content?.length === 2);
cek("data-uri prefix", String(r.pesanGambar?.content?.[1]?.image_url?.url).startsWith("data:image/png;base64,"));
cek("teks instruksi ikut", String(r.pesanGambar?.content?.[0]?.text).includes("baca teksnya"));

const g = jalankan.ambilGambarTerakhir();
cek("ambilGambarTerakhir isi", g !== null && g.content?.length === 2);
cek("sekali pakai (habis)", jalankan.ambilGambarTerakhir() === null);

// 5. jalur galat
const r2 = await jalankan({
  function: { name: "baca_gambar", arguments: JSON.stringify({ nama_file: "catatan.txt" }) },
});
cek("tolak ekstensi non-gambar", r2.ok === false && /bukan gambar/.test(r2.raw), r2.raw.slice(0, 45));

const r3 = await jalankan({
  function: { name: "baca_gambar", arguments: JSON.stringify({ nama_file: "hantu.png" }) },
});
cek("tolak file hilang", r3.ok === false && /tidak ditemukan/.test(r3.raw));

// 6. tool bawaan lain tetap sehat
const r4 = await jalankan({
  function: { name: "eksekusi_terminal", arguments: JSON.stringify({ perintah: "echo halo-quasar" }) },
});
cek("eksekusi_terminal", r4.ok && r4.raw.includes("halo-quasar"));

const r5 = await jalankan({
  function: { name: "lihat_tool", arguments: JSON.stringify({ nama: "baca_file" }) },
});
cek("lihat_tool bawaan", r5.ok === true && /tool bawaan/i.test(r5.raw), r5.raw.slice(0, 40));

const r6 = await jalankan({
  function: { name: "bikin_tool", arguments: JSON.stringify({ nama: "baca_file", deskripsi: "coba timpa" }) },
});
// Cek LEMAH sebelumnya: `typeof r6.ok === "boolean"` selalu true → bug "shadow
// baca_file.tool.js ditulis ke home asli" lolos dari suite selama ini.
// Sekarang diverifikasi sungguhan: harus DITOLAK dan tidak boleh ada berkas.
cek("bikin_tool tolak nama bawaan", r6.ok === false, r6.judul);
cek("bikin_tool pesan jelas soal bawaan", /bawaan/i.test(String(r6.raw || "")), String(r6.raw).slice(0, 60));
cek(
  "tidak ada berkas shadow baca_file.tool.js",
  !fs.existsSync(path.join(process.env.HOME || "", ".agent-termux", "tools", "baca_file.tool.js")),
  "berkas shadow tidak boleh ditulis"
);

// 7. daftar tool tidak duplikat
const tl = daftarTools().map((t) => t.function.name);
cek("baca_gambar unik", tl.filter((n) => n === "baca_gambar").length === 1, `total ${tl.length} tool`);
cek("tool wajib ada", ["baca_file", "tulis_file", "eksekusi_terminal", "baca_gambar"].every((n) => tl.includes(n)));

fs.unlinkSync(tmpPng);
console.log([...ok, ...gagal].join("\n"));
console.log(`\nRINGKAS: ${ok.length} lulus, ${gagal.length} gagal`);
process.exit(gagal.length ? 1 : 0);
