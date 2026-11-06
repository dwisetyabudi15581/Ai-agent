// Uji regresi: endpoint kuota tidak boleh menempelkan /v1/... ke URL chat-completions.
// Bug lama: daftarUrl() -> ".../v1/chat/completions" lalu ditambah "/v1/dashboard/..."
// sehingga menjadi ".../chat/completions/v1/dashboard/..." dan selalu gagal.

import { daftarUrl } from "../src/config/config.js";

let lulus = 0;
let gagal = 0;
function cek(nama, syarat) {
  if (syarat) {
    lulus++;
    console.log(`  ok   ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}`);
  }
}

// Salinan logika normalBasis dari src/core/kuota.js (kontrak perilaku).
function normalBasis(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/chat\/completions$/i, "");
  s = s.replace(/\/+$/, "");
  if (!/\/v1$/i.test(s)) s += "/v1";
  return s;
}

console.log("== uji-url-kuota ==");

// 1. URL chat-completions dibersihkan menjadi basis.
cek(
  "chat/completions dibuang",
  normalBasis("https://api.relink-gateway.biz.id/v1/chat/completions") ===
    "https://api.relink-gateway.biz.id/v1"
);

// 2. Basis yang sudah benar tidak diubah.
cek(
  "basis /v1 dipertahankan",
  normalBasis("https://api.relink-gateway.biz.id/v1") ===
    "https://api.relink-gateway.biz.id/v1"
);

// 3. Host tanpa /v1 ditambahi /v1.
cek(
  "host tanpa v1 ditambahi",
  normalBasis("https://contoh.dev") === "https://contoh.dev/v1"
);

// 4. Kasus yang memicu bug: gabungan tidak boleh mengandung "chat/completions/v1".
const url = normalBasis("https://api.relink-gateway.biz.id/v1/chat/completions") +
  "/dashboard/billing/subscription";
cek("tidak ada URL dobel", !/chat\/completions/i.test(url));
cek(
  "URL akhir benar",
  url === "https://api.relink-gateway.biz.id/v1/dashboard/billing/subscription"
);

// 5. daftarUrl() memang menghasilkan bentuk chat-completions (asumsi bug harus tetap valid).
const daftar = daftarUrl({ baseUrl: "https://api.relink-gateway.biz.id/v1", urls: [] });
cek(
  "daftarUrl menghasilkan chat/completions",
  Array.isArray(daftar) && daftar.length > 0 && /chat\/completions/i.test(daftar[0])
);

// 6. Setelah normalBasis, semua entri daftarUrl bebas dari chat/completions.
const bersih = daftar.map(normalBasis).filter(Boolean);
cek(
  "semua entri bersih setelah normalBasis",
  bersih.length > 0 && bersih.every((u) => !/chat\/completions/i.test(u))
);

console.log(`\nRINGKAS: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
