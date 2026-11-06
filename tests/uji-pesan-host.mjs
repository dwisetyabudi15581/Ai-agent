// ============ UJI REGRESI: PESAN GALAT MENYEBUT HOST NYATA ============
// Asal: pesan galat hardcoded "Gagal memanggil API Re:Link" tetap muncul
// walau baseUrl menunjuk host lain. Log harus jujur menyebut tujuan sungguhan.

import { panggilChat } from "../src/api/klien.js";

let lulus = 0, gagal = 0;
const cek = (nama, syarat) => {
  if (syarat) { lulus++; console.log(`  ✓ ${nama}`); }
  else { gagal++; console.log(`  ✗ ${nama}`); }
};

const pesan = [{ role: "user", content: "hi" }];

const ambilGalat = async (cfg, opsi) => {
  try {
    await panggilChat(cfg, pesan, [], opsi);
    return null;
  } catch (e) { return e.message || ""; }
};

// 1) baseUrl kosong -> pesan jelas, tidak menyebut Re:Link
const m1 = await ambilGalat(
  { apiKey: "x", baseUrl: "", model: "glm-5.3", maxTokens: 4, suhu: 0 },
  { stream: false, detikTimeout: 5, detikTotal: 5 }
);
cek("baseUrl kosong menghasilkan galat", m1 !== null);
cek("pesan menyebut base URL tidak dikonfigurasi", /tidak dikonfigurasi|kosong/i.test(m1 || ""));
cek("pesan tidak menyebut 'Re:Link'", !/re:?\s*link/i.test(m1 || ""));

// 2) Tidak ada URL sama sekali (daftarUrl kosong) + anggaran negatif
//    -> jalur "tidak ada percobaan" tercapai, pesan sebut diagnostik.
const m2 = await ambilGalat(
  { apiKey: "x", baseUrl: "", baseCadangan: "", model: "glm-5.3", maxTokens: 4, suhu: 0 },
  { stream: true, detikTimeout: 30, detikTotal: -5 }
);
cek("detikTotal=-5 tetap menghasilkan galat", m2 !== null);
cek("pesan menyebut base URL tidak dikonfigurasi", /tidak dikonfigurasi|kosong/i.test(m2 || ""));
cek("pesan tidak menyebut 'Re:Link'", !/re:?\s*link/i.test(m2 || ""));
cek("pesan memuat detikTotal", /detikTotal=/i.test(m2 || ""));
cek("pesan memuat totalDetikAman", /totalDetikAman=/i.test(m2 || ""));

// 3) Host asing dipanggil sungguhan -> galat jaringan asli harus
//    menyebut host itu (bukan nama produk lain).
const m3 = await ambilGalat(
  { apiKey: "x", baseUrl: "https://api.gateway-lain.example/v1", model: "glm-5.3", maxTokens: 4, suhu: 0 },
  { stream: false, detikTimeout: 3, detikTotal: 3 }
);
cek("host asing menghasilkan galat", m3 !== null);
cek("pesan tidak menyebut 'Re:Link'", !/re:?\s*link/i.test(m3 || ""));
console.log(`  · pesan galat host asing: ${m3}`);

console.log(`\nRINGKAS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
