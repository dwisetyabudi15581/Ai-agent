// ============ KUOTA: CEK SISA TOKEN AKUN GATEWAY ============
// Memakai endpoint OpenAI-compatible /v1/dashboard/billing/subscription &
// /v1/dashboard/billing/usage bila tersedia, lalu jatuh ke beberapa endpoint
// alternatif gaya gateway (me/akun/kuota). Tidak pernah melempar — selalu
// mengembalikan objek { ok, status, data | galat }.

import { daftarUrl, muatConfig } from "../config/config.js";

const BATAS_MS = 20000;

function angka(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ambilKunci(obj, ...kunci) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of kunci) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    // dukung snake_case / camelCase otomatis
    const alt = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (obj[alt] !== undefined && obj[alt] !== null) return obj[alt];
    const alt2 = k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
    if (obj[alt2] !== undefined && obj[alt2] !== null) return obj[alt2];
  }
  return null;
}

function cariAngkaDalam(obj, daftarNama, kedalaman = 0) {
  if (!obj || typeof obj !== "object" || kedalaman > 4) return null;
  for (const nama of daftarNama) {
    const v = ambilKunci(obj, nama);
    const n = angka(v);
    if (n !== null) return n;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hasil = cariAngkaDalam(v, daftarNama, kedalaman + 1);
      if (hasil !== null) return hasil;
    }
  }
  return null;
}

function cariStringDalam(obj, daftarNama, kedalaman = 0) {
  if (!obj || typeof obj !== "object" || kedalaman > 4) return null;
  for (const nama of daftarNama) {
    const v = ambilKunci(obj, nama);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hasil = cariStringDalam(v, daftarNama, kedalaman + 1);
      if (hasil) return hasil;
    }
  }
  return null;
}

/** Normalisasi respons mentah jadi ringkasan seragam. */
export function ringkasKuota(data) {
  if (!data || typeof data !== "object") return null;
  const d = data.data && typeof data.data === "object" ? data.data : data;
  const akun = d.user && typeof d.user === "object" ? d.user : d;

  const tokenTotal = cariAngkaDalam(d, ["total_tokens", "totalTokens", "token_used", "tokens_used", "used_tokens", "usage", "used"]);
  const tokenPrompt = cariAngkaDalam(d, ["prompt_tokens", "input_tokens", "tokens_input"]);
  const tokenCompletion = cariAngkaDalam(d, ["completion_tokens", "output_tokens", "tokens_output"]);
  const tokenCache = cariAngkaDalam(d, ["cached_tokens", "cache_tokens", "cached"]);
  const maks = cariAngkaDalam(d, ["hard_limit_usd", "hard_limit", "token_limit", "tokens_limit", "total_tokens_limit", "quota", "limit", "max_tokens", "credit_limit", "total"]);
  let sisa = cariAngkaDalam(d, ["sisa_token", "remaining_tokens", "tokens_remaining", "sisa", "remaining", "saldo", "balance", "credit_remaining"]);
  const pakaiLangsung = cariAngkaDalam(d, ["token_terpakai", "tokens_used_total", "tokensUsed", "terpakai"]);
  const pakai = pakaiLangsung !== null ? pakaiLangsung : tokenTotal;

  // Endpoint OpenAI billing: hard_limit_usd + total_usage (dalam sen/unit)
  if (sisa === null && maks !== null && pakai !== null) sisa = maks - pakai;
  if (maks === null && sisa !== null && pakai !== null) {
    // tidak bisa ditentukan; biarkan null
  }

  const permintaan = cariAngkaDalam(d, ["total_requests", "requests", "request_count", "jumlah_permintaan", "calls"]);
  const nama = cariStringDalam(akun, ["nama", "name", "username", "email", "nama_akun", "account"]);
  const status = cariStringDalam(akun, ["status", "plan", "tier", "role", "paket"]);
  const kedaluwarsa = cariStringDalam(d, ["kedaluwarsa", "expires_at", "expired_at", "expiresAt", "masa_berlaku", "valid_until", "access_until", "berlaku_sampai"]);
  const penaltiSampai = cariStringDalam(d, ["penalti_sampai", "penalty_until", "penaltyUntil", "banned_until"]);
  const alasanPenalti = cariStringDalam(d, ["alasan_penalti", "penalty_reason", "ban_reason"]);
  const dilarang = cariStringDalam(d, ["dilarang", "banned", "blocked", "blokir"]);
  const penalti = Boolean(penaltiSampai || alasanPenalti || (d.penalti === true) || (d.penalty === true));

  const persen = maks && maks > 0 && pakai !== null ? Math.round((pakai / maks) * 1000) / 10 : null;

  const hasil = {
    nama, status,
    maks: maks !== null && maks > 0 ? maks : null,
    sisa, pakai,
    tokenTotal, tokenPrompt, tokenCompletion, tokenCache,
    permintaan, kedaluwarsa, persen,
    penalti, penaltiSampai, alasanPenalti,
    dilarang,
  };
  const adaData = Object.entries(hasil).some(([k, v]) => v !== null && v !== undefined && v !== false && k !== "persen");
  return adaData ? hasil : null;
}

export function formatToken(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "-";
  const num = Number(n);
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e4) return `${(num / 1e3).toFixed(1)}K`;
  return num.toLocaleString("id-ID");
}

function kandidatPath() {
  return [
    "/dashboard/billing/subscription",
    "/dashboard/billing/usage?start_date=2020-01-01&end_date=2099-12-31",
    "/me",
    "/user/me",
    "/akun",
    "/account",
    "/kuota",
    "/quota",
    "/usage",
    "/v1/me",
    "/v1/kuota",
  ];
}

function normalUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (!/\/v1$/.test(s)) s += "/v1";
  return s;
}

/**
 * Basis URL untuk endpoint NON-chat (billing/kuota).
 * daftarUrl() mengembalikan URL chat-completions (".../chat/completions"),
 * jadi bagian itu harus dibuang dulu agar tidak menghasilkan URL dobel
 * seperti ".../chat/completions/v1/dashboard/billing/subscription".
 */
function normalBasis(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  s = s.replace(/\/chat\/completions$/i, "");
  s = s.replace(/\/+$/, "");
  if (!/\/v1$/i.test(s)) s += "/v1";
  return s;
}

/**
 * Ambil kuota dari gateway. cfg = konfigurasi hasil muatConfig().
 * @returns {Promise<{ok:boolean, status?:number, data?:any, galat?:string, url?:string}>}
 */
export async function ambilKuota(cfg) {
  const konf = cfg || muatConfig();
  // Nama generik diprioritaskan; alias lama berawalan penyedia tetap dibaca agar
  // instalasi lama tidak rusak. konf.apiKey sudah hasil resolusi muatConfig(),
  // jadi dipakai sebagai sumber terakhir bila env benar-benar kosong.
  const kunci =
    process.env.API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.RELINK_API_KEY || // alias lama, dipertahankan untuk upgrade
    konf?.apiKey ||
    "";
  if (!kunci) return { ok: false, galat: "API_KEY belum diisi di .env" };

  const urlDasar = (typeof daftarUrl === "function" ? daftarUrl(konf) : [])
    .map(normalBasis)
    .filter(Boolean);
  if (!urlDasar.length) return { ok: false, galat: "Base URL gateway belum dikonfigurasi" };

  const galatKumpulan = [];
  for (const dasar of urlDasar) {
    for (const p of kandidatPath()) {
      const url = dasar + p;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), BATAS_MS);
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${kunci}`,
            Accept: "application/json",
            "User-Agent": "AgentTermux/3.3",
          },
          signal: ctl.signal,
        });
        const teks = await res.text();
        let data = null;
        try { data = JSON.parse(teks); } catch { data = teks; }

        if (res.status === 401 || res.status === 403) {
          galatKumpulan.push(`${url} → ${res.status} (kunci ditolak)`);
          continue;
        }
        if (!res.ok) {
          const pesan = typeof data === "string" ? data.slice(0, 160) : (data?.error?.message || data?.message || "");
          galatKumpulan.push(`${url} → ${res.status}${pesan ? `: ${pesan}` : ""}`);
          continue;
        }
        if (data === null || (typeof data === "object" && Object.keys(data).length === 0)) {
          galatKumpulan.push(`${url} → 200 tapi kosong`);
          continue;
        }
        const ringkas = ringkasKuota(data);
        if (ringkas) return { ok: true, status: res.status, data, url };
        galatKumpulan.push(`${url} → 200 tapi tidak ada angka kuota`);
        // simpan respons terakhir sebagai fallback mentah
        if (!galatKumpulan.__mentah) galatKumpulan.__mentah = { url, data };
      } catch (e) {
        galatKumpulan.push(`${url} → ${e.name === "AbortError" ? "timeout" : e.message}`);
      } finally {
        clearTimeout(t);
      }
    }
  }

  const mentah = galatKumpulan.__mentah;
  if (mentah) return { ok: true, status: 200, data: mentah.data, url: mentah.url };

  const ringkasGalat = galatKumpulan.slice(0, 6).join("\n");
  return {
    ok: false,
    galat: `Endpoint kuota tidak dapat dibaca (${galatKumpulan.length} percobaan).\n${ringkasGalat}`,
  };
}

export default { ambilKuota, ringkasKuota, formatToken };
