// Uji router dengan katalog bergaya Re:Link asli: multiplier token (bukan
// harga dolar), kapabilitas TIDAK dideklarasikan gateway (null), konteks
// tidak dipublikasikan (0). Regresi bug lama: router mensyaratkan
// kapabilitas "tools" sehingga TIDAK PERNAH memilih model apa pun di
// Re:Link — kini model tanpa deklarasi dianggap sanggup tool-calling.
import { pilihModel, nilaiKesulitan } from "../src/core/router.js";

// Potongan katalog Re:Link aktif (multiplier dari situs resmi, 2026-11-05)
const katalog = [
  { id: "auto", nama: "Auto", vendor: "Lainnya", kapabilitas: null, konteks: 0, multiplier: 1, harga: { input: 0, output: 0 } },
  { id: "kimi-k2.7-code", nama: "Kimi K2.7 Code", vendor: "Moonshot", kapabilitas: null, konteks: 0, multiplier: 1, harga: { input: 0, output: 0 } },
  { id: "deepseek-v4-pro", nama: "Deepseek V4 Pro", vendor: "DeepSeek", kapabilitas: null, konteks: 0, multiplier: 1.15, harga: { input: 0, output: 0 } },
  { id: "glm-5.2", nama: "GLM 5.2", vendor: "Zhipu AI", kapabilitas: null, konteks: 0, multiplier: 1.25, harga: { input: 0, output: 0 } },
  { id: "deepseek-v4-flash", nama: "Deepseek V4 Flash", vendor: "DeepSeek", kapabilitas: null, konteks: 0, multiplier: 2, harga: { input: 0, output: 0 } },
  { id: "glm-5.3-flash", nama: "GLM 5.3 Flash", vendor: "Zhipu AI", kapabilitas: null, konteks: 0, multiplier: 2, harga: { input: 0, output: 0 }, vision: true },
  { id: "deepseek-v4.1-flash", nama: "Deepseek V4.1 Flash", vendor: "DeepSeek", kapabilitas: null, konteks: 0, multiplier: 2.56, harga: { input: 0, output: 0 } },
  { id: "deepseek-v4-mod", nama: "Deepseek V4 Mod", vendor: "DeepSeek", kapabilitas: null, konteks: 0, multiplier: 3, harga: { input: 0, output: 0 } },
  { id: "glm-5.3-flash-mod", nama: "GLM 5.3 Flash Mod", vendor: "Zhipu AI", kapabilitas: null, konteks: 0, multiplier: 3.5, harga: { input: 0, output: 0 } },
  { id: "gpt-6-luna", nama: "GPT 6 Luna", vendor: "OpenAI", kapabilitas: null, konteks: 0, multiplier: 8, harga: { input: 0, output: 0 } },
  { id: "gpt-6-astra", nama: "GPT 6 Astra", vendor: "OpenAI", kapabilitas: null, konteks: 0, multiplier: 42, harga: { input: 0, output: 0 } },
  { id: "gemini-4-argon", nama: "Gemini 4 Argon", vendor: "Google", kapabilitas: null, konteks: 0, multiplier: 60, harga: { input: 0, output: 0 } },
];

let gagal = 0;
const cek = (nama, kondisi, info = "") => {
  console.log(`${kondisi ? "OK  " : "BUG "} ${nama} ${info}`);
  if (!kondisi) gagal++;
};

// 1) Obrolan ringan → termurah (multiplier 1x)
const ringan = pilihModel({ katalog, teks: "halo, apa kabar?", ukuranRiwayat: 1000 });
cek("ringan → termurah 1x", ringan?.id === "auto" || ringan?.id === "kimi-k2.7-code", `dapat ${ringan?.id} (${ringan?.tingkat})`);
cek("ringan bertingkat", ringan?.tingkat === "ringan");

// 2) Tugas teknis menengah → bukan kelas "gratisan" (mult ≤ 1.05) → deepseek-v4-pro 1.15x
const kode = pilihModel({ katalog, teks: "tolong buatkan skrip bash untuk backup folder", ukuranRiwayat: 5000 });
cek("kode → kelas menengah termurah", kode?.id === "deepseek-v4-pro", `dapat ${kode?.id} (${kode?.tingkat})`);
cek("kode bertingkat", kode?.tingkat === "kode");

// 3) Tugas berat → kelas kuat (kuartil termahal), bukan model 1x
const berat = pilihModel({ katalog, teks: "refaktor seluruh proyek ini jadi arsitektur modular", ukuranRiwayat: 5000 });
const biayaBerat = katalog.find((m) => m.id === berat?.id)?.multiplier ?? 0;
cek("berat → kelas kuat", berat?.tingkat === "berat" && biayaBerat >= 8, `dapat ${berat?.id} (mult ${biayaBerat}x)`);

// 4) Model aktif sudah kelas kuat → tidak diturunkan
const kuat = pilihModel({ katalog, teks: "analisis mendalam performa dan optimasi algoritma", ukuranRiwayat: 5000, cfg: { model: "gpt-6-astra" } });
cek("berat & aktif sudah kuat → tetap", kuat?.id === "gpt-6-astra", `dapat ${kuat?.id}`);

// 5) Model tanpa harga & multiplier disaring (bila ada yang lebih jelas)
const katalogAsing = [...katalog, { id: "tak-dikenal", kapabilitas: null, konteks: 0, multiplier: null, harga: {} }];
const asing = pilihModel({ katalog: katalogAsing, teks: "halo", ukuranRiwayat: 100 });
cek("model tanpa biaya disaring", asing?.id !== "tak-dikenal", `dapat ${asing?.id}`);

// 6) Konteks 0 (tidak dipublikasikan) tidak boleh menyingkirkan kandidat
//    Riwayat 40k karakter ≈ 10k token — dulu semua model Re:Link (konteks 0)
//    tersaring sehingga router bungkam.
const besar = pilihModel({ katalog, teks: "halo", ukuranRiwayat: 40000 });
cek("konteks tak diketahui tetap layak", besar != null && besar.tingkat === "ringan", `dapat ${besar?.id ?? "null"}`);

// 7) Kapabilitas null = sanggup tool (regresi bug utama)
const semuaNull = katalog.every((m) => m.kapabilitas === null);
const pilihanAda = pilihModel({ katalog, teks: "perbaiki bug di eksekusi_terminal", ukuranRiwayat: 1000 }) != null;
cek("kapabilitas null → router tetap memilih", semuaNull && pilihanAda);

// 8) Model eksplisit tanpa tools tetap disaring (perilaku lama dipertahankan)
const katalogDeklarasi = [
  { id: "murah-tanpa-tool", kapabilitas: ["chat"], konteks: 128000, multiplier: 1, harga: { input: 0, output: 0 } },
  { id: "keras-dengan-tool", kapabilitas: ["chat", "tools"], konteks: 128000, multiplier: 2, harga: { input: 0, output: 0 } },
];
const saring = pilihModel({ katalog: katalogDeklarasi, teks: "halo", ukuranRiwayat: 100 });
cek("deklarasi tanpa tools tetap disaring", saring?.id === "keras-dengan-tool", `dapat ${saring?.id}`);

// 9) Alasan keputusan menyebut multiplier (bukan dolar)
cek("alasan memakai multiplier", /mult 1(\.0)?x/.test(ringan?.alasan || ""), `alasan: ${ringan?.alasan}`);

console.log(`\n${gagal === 0 ? "LULUS ✓" : "GAGAL ✗"} (${gagal} kegagalan)`);
process.exit(gagal === 0 ? 0 : 1);
