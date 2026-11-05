// ============ SESI: SIMPAN / MUAT / RINGKAS RIWAYAT ============
import fs from "fs/promises";
import path from "path";
import { DIR_SESI, pastikanDir } from "../paths.js";
import { waktu } from "../ui/util.js";
import { panggilChat } from "../api/klien.js";

// Penghitung urut untuk mencegah tabrakan bila beberapa sesi dibuat dalam
// detik yang sama (mis. `/baru` diikuti restart cepat). ID tetap enak dibaca.
let urutSesi = 0;

export function idSesiBaru() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const dasar = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  urutSesi = (urutSesi + 1) % 100;
  // -01..-99 memberi ruang 99 sesi per detik; tidak pernah sama dalam proses ini
  return `${dasar}-${p(urutSesi)}`;
}

export async function daftarSesi() {
  await pastikanDir();
  const berkas = await fs.readdir(DIR_SESI).catch(() => []);
  const hasil = [];
  for (const b of berkas) {
    if (!b.endsWith(".json")) continue;
    try {
      const j = JSON.parse(await fs.readFile(path.join(DIR_SESI, b), "utf-8"));
      const jumlahUser = j.messages.filter((m) => m.role === "user").length;
      hasil.push({ id: j.id, judul: j.judul || "(tanpa judul)", model: j.model, pesan: jumlahUser, diperbarui: j.diperbarui });
    } catch { /* berkas rusak */ }
  }
  return hasil.sort((a, b) => String(b.diperbarui).localeCompare(String(a.diperbarui)));
}

export async function simpanSesi(sesi) {
  await pastikanDir();
  sesi.diperbarui = new Date().toISOString();
  await fs.writeFile(path.join(DIR_SESI, `${sesi.id}.json`), JSON.stringify(sesi, null, 2));
}

export async function muatSesi(id) {
  await pastikanDir();
  return JSON.parse(await fs.readFile(path.join(DIR_SESI, `${id}.json`), "utf-8"));
}

// Perkiraan ukuran riwayat dalam karakter (proxy cepat untuk token)
export function ukuranRiwayat(messages) {
  return messages.reduce((n, m) => n + String(m.content || "").length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
}

/**
 * Ringkas riwayat lama menjadi satu pesan system "RINGKASAN PERCAKAPAN",
 * menyisakan beberapa pesan terakhir agar konteks tetap nyambung.
 */
export async function ringkasRiwayat(cfg, messages, { simpan = 8 } = {}) {
  const systemAwal = messages[0]?.role === "system" ? messages[0] : null;
  const badan = systemAwal ? messages.slice(1) : messages.slice();
  if (badan.length <= simpan) return messages;

  const lama = badan.slice(0, badan.length - simpan);
  const baru = badan.slice(badan.length - simpan);

  const transkrip = lama
    .map((m) => {
      const peran = m.role === "user" ? "USER" : m.role === "assistant" ? "AGENT" : `TOOL(${m.name || ""})`;
      return `${peran}: ${String(m.content || "").slice(0, 1200)}`;
    })
    .join("\n")
    .slice(-24000);

  const { pesan } = await panggilChat(
    cfg,
    [
      { role: "system", content: "Kamu adalah peringkas riwayat percakapan. Tulis ringkasan padat dalam poin-poin: tujuan user, fakta penting, keputusan, file/ perintah yang sudah dibuat, dan hal yang belum selesai. Bahasa Indonesia. Maksimal 40 baris." },
      { role: "user", content: `Ringkas transkrip berikut:\n\n${transkrip}` },
    ],
    null,
    { stream: false, model: cfg.modelCepat, maxTokens: 4000, suhu: 0.2, detikTimeout: 180 }
  );

  const ringkasan = { role: "system", content: `=== RINGKASAN PERCAKAPAN SEBELUMNYA (${waktu()}) ===\n${pesan.content}\n=== AKHIR RINGKASAN ===` };
  return systemAwal ? [systemAwal, ringkasan, ...baru] : [ringkasan, ...baru];
}
