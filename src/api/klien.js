// ============ KLIEN API: PANGGIL CHAT/COMPLETIONS (OpenAI-compatible) ============
import { daftarUrl, tandaiBermasalah, tandaiPulih, dasarDari } from "../config/config.js";

// ---------- Panggil chat/completions ----------
/**
 * Strategi berderet per model (dari paling diinginkan ke paling aman):
 *   1. stream     ke host utama → host cadangan (bila dikonfigurasi)
 *   2. non-stream ke host cadangan → host utama
 *   3. model cadangan (cfg.modelCadangan) mengulang urutan di atas
 * `mintaStream=false` melewati semua tahap stream.
 */
export async function panggilChat(cfg, messages, tools, opsi = {}) {
  const {
    stream: mintaStream = cfg.streamDefault !== false,
    model = cfg.model,
    maxTokens = cfg.maxTokens,
    suhu = cfg.suhu,
    onToken = null,
    onReasoning = null,
    detikTimeout = 600,
    // Batas total seluruh rantai fallback. Default = detikTimeout + 30 dtk,
    // sehingga tahap berikutnya otomatis dilewati begitu anggaran habis
    // (tanpa ini, 2 host × 2 mode × 2 model bisa makan waktu berlipat).
    detikTotal = detikTimeout + 30,
    toolChoice = "auto",
  } = opsi;

  // Anggaran total yang tidak wajar (0, negatif, NaN) tidak boleh mematikan
  // seluruh rantai sebelum satu pun percobaan jalan. Pakai batas aman minimum.
  const totalDetikAman = Number.isFinite(detikTotal) && detikTotal > 0
    ? detikTotal
    : Math.max(1, Number(detikTimeout) || 600);

  const tenggat = Date.now() + totalDetikAman * 1000;
  const sisaMs = () => tenggat - Date.now();

  const daftarModel = [model];
  if (cfg.modelCadangan && cfg.modelCadangan !== model) daftarModel.push(cfg.modelCadangan);

  let galatTerakhir;
  let galatSebelumnya; // galat dari host/model yang lebih diutamakan
  // Set true begitu satu host terbukti hidup (walau modelnya menolak), supaya
  // galat "model tidak mendukung" tidak tertimpa galat host mati di bawahnya.
  let adaHostHidup = false;

  // Susun tahap: stream dipertahankan lebih dulu (host utama → cadangan),
  // baru jatuh ke non-stream. Bila host cadangan tidak muncul di daftar
  // stream (mis. sedang ditandai bermasalah), tetap dicoba sekali di akhir
  // rantai stream agar streaming tidak langsung dibuang.
  const urlStream = daftarUrl(cfg, { stream: true });
  const urlNonStream = daftarUrl(cfg, { stream: false });
  const baseCadangan = (cfg.baseCadangan || "").replace(/\/+$/, "");
  const cadanganDiStream = !baseCadangan || urlStream.some((u) => u.startsWith(baseCadangan));
  const urlStreamLengkap = cadanganDiStream ? urlStream : [...urlStream, `${baseCadangan}/chat/completions`];

  for (const modelKini of daftarModel) {
    const strategi = mintaStream
      ? [
          { stream: true, url: urlStreamLengkap },
          { stream: false, url: urlNonStream },
        ]
      : [{ stream: false, url: urlNonStream }];

    for (const tahap of strategi) {
      if (sisaMs() <= 0) break;
      for (const url of tahap.url) {
        // Anggaran total habis → jangan buang waktu ke host berikutnya.
        const sisa = sisaMs();
        if (sisa <= 0) break;

        const badan = { model: modelKini, messages, stream: tahap.stream, max_tokens: maxTokens, temperature: suhu };
        if (tools?.length) { badan.tools = tools; badan.tool_choice = toolChoice; }

        // Satu batas waktu per percobaan = min(detikTimeout, sisa anggaran total).
        const batasMs = Math.min(detikTimeout * 1000, sisa);

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfg.apiKey}`,
              Accept: tahap.stream ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(badan),
            signal: AbortSignal.timeout ? AbortSignal.timeout(batasMs) : undefined,
          });

          if (!res.ok) {
            const teks = await res.text().catch(() => ""); adaHostHidup = true;
            let pesan = teks;
            try { pesan = JSON.parse(teks)?.error?.message || teks; } catch { /* mentah */ }
            galatTerakhir = new Error(`HTTP ${res.status} — ${String(pesan).slice(0, 300)}`);
            // 403/404 = model tidak tersedia di host ini (host-nya sendiri hidup),
            // jadi host TIDAK ditandai bermasalah: model tetap dicoba lagi di host
            // berikutnya, dan host asal tetap dipakai untuk model lain.
            if ([403, 404].includes(res.status)) {
              if (galatTerakhir) galatSebelumnya = galatTerakhir;
            } else {
              if ([429, 500, 502, 503, 504].includes(res.status)) tandaiBermasalah(dasarDari(url));
              // Host mati di bawah host yang sudah terbukti hidup: jangan
              // menimpa galat model (lebih informatif) dengan galat host.
              if (adaHostHidup && galatSebelumnya) galatTerakhir = galatSebelumnya;
            }
            continue;
          }

          if (tahap.stream) {
            const hasil = await bacaStream(res, { onToken, onReasoning, url });
            const adaIsi = !!hasil.pesan.content;
            const adaTool = !!hasil.pesan.tool_calls?.length;
            // Teks sudah terlanjur tampil ke layar: jangan ulang di host/model
            // lain (jawaban akan tercetak ganda). Pakai apa adanya.
            if (!adaIsi && !adaTool && !hasil.jumlahChunk) {
              galatTerakhir = new Error("Balasan stream kosong");
              continue; // host mungkin memotong stream → coba tahap berikutnya
            }
            tandaiPulih(dasarDari(url));
            hasil.stream = true;
            hasil.model = modelKini;
            return hasil;
          }

          const json = await res.json();
          if (json?.error) {
            galatTerakhir = new Error(`${json.error.code || "error"} — ${json.error.message || ""}`);
            continue;
          }
          const pesan = normalkanPesan(json.choices?.[0]?.message);
          if (!pesan.content && !pesan.tool_calls?.length) {
            galatTerakhir = new Error("Balasan kosong dari model");
            continue;
          }
          tandaiPulih(dasarDari(url));
          return { pesan, usage: json.usage || null, finish: json.choices?.[0]?.finish_reason, url, model: modelKini, stream: false };
        } catch (e) {
          const habisWaktu = /aborted|timeout|ETIMEDOUT/i.test(e.message || "");
          galatTerakhir = habisWaktu
            ? new Error(`Batas waktu habis (${Math.round(batasMs / 1000)} dtk) di ${dasarDari(url)}`)
            : e;
          // Timeout sementara (jaringan lambat) tidak layak ditandai "bermasalah"
          // permanen hanya karena anggaran waktu percobaan ini pendek.
          if (!habisWaktu && /fetch failed|network|ECONNRESET|Headers|terminated/i.test(e.message || "")) {
            tandaiBermasalah(dasarDari(url));
          }
          continue;
        }
      }
    }
  }

  // Tidak ada galat tercatat = tidak satupun percobaan sempat dijalankan.
  // Pesan menyebut HOST yang benar-benar dituju (bukan nama produk hardcoded),
  // supaya log jujur soal endpoint mana yang dipanggil.
  const urlDicoba = [...new Set([...urlStreamLengkap, ...urlNonStream])]
    .map((u) => { try { return new URL(u).host; } catch { return null; } })
    .filter(Boolean);
  const daftarHost = urlDicoba.length ? urlDicoba.join(", ") : "(base URL kosong / tidak dikonfigurasi)";

  throw galatTerakhir || new Error(
    `Tidak ada endpoint yang sempat dipanggil: ${daftarHost} — ` +
    `anggaran waktu habis sebelum percobaan pertama ` +
    `(detikTotal=${detikTotal}, detikTimeout=${detikTimeout}, totalDetikAman=${totalDetikAman})`
  );
  // Catatan: `detikTimeout` = batas per percobaan, `detikTotal` = anggaran
  // seluruh rantai fallback (stream → non-stream → model cadangan).
}

/**
 * Pemanasan fetch sekali-jalan.
 * Di Termux/Android, panggilan `fetch` PERTAMA di proses Node memakan
 * ~0,9–1,0 detik (inisialisasi undici + resolver DNS), sedangkan panggilan
 * berikutnya hanya ~20–40 ms. Tanpa pemanasan, user merasakan "agent menggantung"
 * pada pesan pertama. Dipanggil tanpa ditunggu (fire-and-forget) saat start;
 * hasil/gagalnya diabaikan karena hanya untuk memanaskan mesin.
 */
let sudahDipanaskan = false;
export function panaskanFetch() {
  if (sudahDipanaskan) return;
  sudahDipanaskan = true;
  // Alamat lokal yang pasti menolak dengan cepat: yang penting jalur fetch
  // (termasuk inisialisasi internalnya) sudah terbentuk.
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const batas = setTimeout(() => ctrl?.abort(), 3000);
  fetch("http://127.0.0.1:1/__panas__", { signal: ctrl?.signal })
    .catch(() => { /* memang diharapkan gagal */ })
    .finally(() => clearTimeout(batas));
}

function normalkanPesan(m) {
  if (!m) return { role: "assistant", content: "" };
  const hasil = { role: "assistant", content: m.content ?? "" };
  if (m.tool_calls?.length) {
    hasil.tool_calls = m.tool_calls.map((t, i) => ({
      id: t.id || `call_${Date.now()}_${i}`,
      type: "function",
      function: { name: t.function?.name || "", arguments: t.function?.arguments || "{}" },
    }));
  }
  return hasil;
}

// ---------- Pembaca SSE (stream) ----------
/**
 * Membaca respons SSE dan menyusun pesan utuh.
 * Aman terhadap: potongan baris terbelah, event multi-baris, duplikat delta
 * (beberapa host mengirim ulang teks yang sama), dan tool_calls berindeks.
 */
async function bacaStream(res, { onToken, onReasoning, url }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sisa = "";
  let isi = "";
  let reasoning = "";
  let usage = null;
  let finish = null;
  let jumlahChunk = 0;
  const toolMap = new Map();
  // penjaga duplikat: hanya aktif bila terdeteksi pengulangan beruntun
  let deltaTerakhir = "";
  let sisaDuplikat = "";

  const prosesBaris = (l) => {
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new Error(`${j.error.code || "upstream_error"} — ${j.error.message || "galat hulu"}`);
    if (j.usage) usage = j.usage;

    const pilihan = j.choices?.[0];
    if (!pilihan) return;
    if (pilihan.finish_reason) finish = pilihan.finish_reason;

    const d = pilihan.delta || {};

    const r = d.reasoning_content ?? d.reasoning;
    if (typeof r === "string" && r) {
      reasoning += r;
      if (onReasoning) onReasoning(r);
    }

    if (typeof d.content === "string" && d.content) {
      // deteksi pengulangan persis berturut-turut (bug buffer host)
      if (d.content === deltaTerakhir && deltaTerakhir.length > 0) {
        sisaDuplikat += d.content; // catat tapi jangan tampilkan/dihitung
      } else {
        deltaTerakhir = d.content;
        isi += d.content;
        jumlahChunk++;
        if (onToken) onToken(d.content);
      }
    }

    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolMap.has(idx)) {
          toolMap.set(idx, { id: tc.id || `call_${Date.now()}_${idx}`, type: "function", function: { name: "", arguments: "" } });
        }
        const acc = toolMap.get(idx);
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.function.name += tc.function.name;
        if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sisa += decoder.decode(value, { stream: true });
    const baris = sisa.split("\n");
    sisa = baris.pop() || "";
    for (const b of baris) prosesBaris(b.trim());
  }
  if (sisa.trim()) prosesBaris(sisa.trim());

  const pesan = { role: "assistant", content: isi };
  if (toolMap.size) pesan.tool_calls = [...toolMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return { pesan, usage, finish, reasoning, url, jumlahChunk, duplikatDibuang: sisaDuplikat.length };
}
