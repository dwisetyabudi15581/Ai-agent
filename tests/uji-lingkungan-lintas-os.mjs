// ============ UJI: DETEKSI LINGKUNGAN LAIN (desktop) ============
// Memastikan prompt tidak lagi hardcode "Android/Termux" dan adaptif per OS.
import assert from "assert";

const m = await import("../src/core/lingkungan.js");

let lulus = 0, gagal = 0;
const cek = (nama, fn) => {
  try { fn(); lulus++; console.log("  ok  " + nama); }
  catch (e) { gagal++; console.log("  GAGAL " + nama + " :: " + e.message); }
};

console.log("— modul lingkungan");
cek("IS_WIN boolean", () => assert.strictEqual(typeof m.IS_WIN, "boolean"));
cek("namaOS mengembalikan string berisi platform atau nama umum", () => {
  const s = m.namaOS();
  assert.strictEqual(typeof s, "string");
  assert.ok(s.length > 0);
});
cek("namaShell tidak kosong", () => assert.ok(m.namaShell().length > 0));
cek("homeUser sama dengan HOME", () => assert.strictEqual(m.homeUser(), process.env.HOME));
cek("dirKerja memendekkan home jadi ~", () => {
  const d = m.dirKerja();
  assert.ok(!d.startsWith(process.env.HOME), "cwd seharusnya sudah dipendekkan: " + d);
});
cek("ringkasLingkungan memuat OS & node", () => {
  const r = m.ringkasLingkungan();
  assert.ok(/OS:/.test(r), r);
  assert.ok(/node:/.test(r), r);
});

console.log("— prompt memakai nilai dinamis");
const { systemPrompt } = await import("../src/core/prompt.js");
const cfg = { namaAgent: "Agent", model: "glm-5.3" };
const p = systemPrompt(cfg, "auto");
cek("prompt memuat OS hasil deteksi", () => assert.ok(p.includes(`OS: ${m.namaOS()}`), "OS tidak muncul"));
cek("prompt memuat path lokal", () => assert.ok(p.includes(m.pemetaanPath()), "pemetaanPath tidak muncul"));
cek("prompt memakai ~ bukan path absolut home", () => {
  assert.ok(!p.includes(`Folder kerja: ${process.env.HOME}`), "home masih absolut");
});

console.log("— simulasi desktop Linux (HOME diganti)");
const homeAsli = process.env.HOME;
process.env.HOME = "/home/user";
const p2 = systemPrompt(cfg, "auto");
cek("home baru terbaca", () => assert.ok(p2.includes("/home/user"), "HOME baru tidak dipakai"));
process.env.HOME = homeAsli;

console.log(`\nHASIL: ${lulus} lulus · ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
