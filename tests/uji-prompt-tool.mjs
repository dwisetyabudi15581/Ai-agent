// ============ UJI: SYSTEM PROMPT ADAPTIF TERHADAP DAFTAR TOOL ============
import assert from "assert";
import { systemPrompt } from "../src/core/prompt.js";

let lulus = 0, gagal = 0;
const cek = (nama, fn) => {
  try { fn(); console.log("  ok   " + nama); lulus++; }
  catch (e) { console.log("  GAGAL " + nama + " -> " + e.message); gagal++; }
};

console.log("== uji prompt adaptif ==");

cek("tanpa cfg tidak menghasilkan 'undefined'", () => {
  const p = systemPrompt(undefined, "auto");
  assert.ok(!/undefined/.test(p), "ada 'undefined' di prompt");
  assert.ok(p.includes("Agent"), "nama default hilang");
});

cek("tool bawaan disebut di prompt default", () => {
  const p = systemPrompt({ namaAgent: "Agent", model: "m" }, "auto");
  assert.ok(p.includes("## TOOL YANG TERSEDIA"));
  assert.ok(p.includes("eksekusi_terminal"));
});

cek("daftar tool kustom dipakai, tool lama hilang", () => {
  const p = systemPrompt({ tools: ["baca_file", "cari_web"] }, "auto");
  assert.ok(p.includes("baca_file, cari_web"));
  assert.ok(!p.includes("eksekusi_terminal"), "tool yang tidak ada masih disebut");
});

cek("aturan ingat berubah bila tool ingat tidak ada", () => {
  const p = systemPrompt({ tools: ["baca_file"] }, "auto");
  assert.ok(p.includes("sebutkan di ringkasan akhir"));
  assert.ok(!p.includes("panggil `ingat`"));
});

cek("mode teman memakai blok TEMAN NGOBROL", () => {
  const t = systemPrompt({}, "teman");
  const a = systemPrompt({}, "auto");
  assert.ok(t.includes("MODE: TEMAN NGOBROL"));
  assert.ok(!t.includes("MODE: AGEN OTONOM"));
  assert.ok(a.includes("MODE: AGEN OTONOM"));
  assert.ok(a.includes("GAYA KERJA"));
});

cek("waktu & model tercetak wajar", () => {
  const p = systemPrompt({ namaAgent: "Z", model: "glm-5.3" }, "auto");
  assert.ok(p.includes("Model aktif: glm-5.3"));
  assert.ok(p.includes("Kamu adalah Z,"));
});

cek("daftar tool versi objek (format OpenAI) juga dibaca", () => {
  const p = systemPrompt({ tools: [{ type: "function", function: { name: "ambil_url" } }] }, "auto");
  assert.ok(p.includes("ambil_url"));
});

console.log(`\nhasil: ${lulus} lulus / ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
