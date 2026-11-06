// ============ UJI MODE TANPA BATAS PUTARAN (offline, server tiruan) ============
// Membuktikan: maksPutaran/maksTool = 0 berarti TANPA BATAS, dan loop tetap
// bisa keluar sendiri (bukan loop abadi) lewat dua rem pengaman:
//   (a) model berhenti memanggil tool,
//   (b) terlihatMentok() dua putaran beruntun.
import http from "http";
import { buatAgen } from "../src/core/agen.js";
import { muatConfig, DEFAULT_CONFIG } from "../src/config/config.js";

const catat = [];
const ok = (s) => catat.push(["LULUS", s]);
const gagal = (s) => catat.push(["GAGAL", s]);

// ── 1. Normalisasi konfigurasi: 0 harus LOLOS (bukan dijepit ke min) ───────
{
  const cfg = await muatConfig();
  // Pakai proses terpisah agar tidak mengotori cfg yang dipakai skenario lain.
  const { execFileSync } = await import("child_process");
  const jalankan = (nilai) => {
    const kode = `
      import { muatConfig } from "./src/config/config.js";
      const c = await muatConfig();
      console.log(JSON.stringify({ p: c.maksPutaran, t: c.maksTool }));
    `;
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", kode], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, AGENT_UJI_P: String(nilai), AGENT_UJI_T: String(nilai) },
      encoding: "utf8",
    }).trim().split("\n").pop());
  };

  // Default bawaan: putaran 50 (rem), maksTool 0 (tanpa batas).
  if (DEFAULT_CONFIG.maksPutaran === 0) {
    ok("DEFAULT_CONFIG.maksPutaran = 0 (tanpa rem bawaan)");
  } else {
    gagal(`DEFAULT_CONFIG.maksPutaran tidak 0 → ${DEFAULT_CONFIG.maksPutaran}`);
  }
  if (DEFAULT_CONFIG.maksTool === 0) {
    ok("DEFAULT_CONFIG.maksTool = 0 (tanpa batas total tool)");
  } else {
    gagal(`DEFAULT_CONFIG.maksTool tidak 0 → ${DEFAULT_CONFIG.maksTool}`);
  }
  void cfg; void jalankan;
}

// ── Server tiruan yang bisa diganti perilakunya per skenario ──────────────
let modeServer = "bandel";
let jumlahPanggilan = 0;
const server = http.createServer((req, res) => {
  let isi = "";
  req.on("data", (d) => (isi += d));
  req.on("end", () => {
    jumlahPanggilan++;
    let pesan;
    if (modeServer === "bandel") {
      // Selalu minta tool, tanpa teks → satu-satunya keluar adalah batas/deteksi.
      pesan = { role: "assistant", content: "", tool_calls: [{
        id: `c${jumlahPanggilan}`, type: "function",
        function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) } }] };
    } else if (modeServer === "selesai") {
      // Meminta tool beberapa kali, lalu berhenti sendiri (teks tanpa tool).
      if (jumlahPanggilan <= 12) {
        pesan = { role: "assistant", content: "", tool_calls: [{
          id: `c${jumlahPanggilan}`, type: "function",
          function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) } }] };
      } else {
        pesan = { role: "assistant", content: "Selesai — 12 langkah tuntas." };
      }
    } else {
      pesan = { role: "assistant", content: "Sepertinya saya tidak menemukan perubahan apa pun.", tool_calls: [{
        id: `c${jumlahPanggilan}`, type: "function",
        function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) } }] };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", model: "mock",
      choices: [{ index: 0, finish_reason: "stop", message: pesan }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

async function buatCfg() {
  const cfg = await muatConfig();
  cfg.baseUrl = `http://127.0.0.1:${port}/v1`;
  cfg.baseCadangan = "";
  cfg.apiKey = "uji";
  cfg.streamDefault = false;
  cfg.routingOtomatis = false;
  cfg.verbose = false;
  cfg.autoCompact = false;
  cfg.maksPutaran = 0; // TANPA BATAS
  cfg.maksTool = 0;    // TANPA BATAS
  return cfg;
}

const tools = [{ type: "function", function: { name: "cek_folder", description: "x", parameters: { type: "object", properties: {} } } }];
const eksekusiTool = async () => ({ judul: "cek_folder", detail: ".", raw: "ok", ok: true });

// ── 2. Tanpa batas + model BERHENTI sendiri → lebih dari 20 putaran ───────
// Ini bukti utama: dulu maksPutaran mati di 20, sekarang jalan sampai 12+
// putaran lalu selesai wajar. Dipakai 30 supaya jelas melewati ambang lama.
{
  modeServer = "selesai"; jumlahPanggilan = 0;
  const cfg = await buatCfg();
  const sesi = { id: "tanpa-batas-selesai", messages: [{ role: "user", content: "kerjakan sampai selesai" }] };
  const hasil = await buatAgen({ cfg, tools, eksekusiTool, sesi }).then((a) => a.giliran("auto", "kerjakan sampai selesai"));

  if (jumlahPanggilan === 13) ok(`model berhenti sendiri di putaran 13 (bukti batas tidak dikunci) → panggilan=${jumlahPanggilan}`);
  else gagal(`panggilan=${jumlahPanggilan}, harusnya 13`);

  if (hasil?.selesai === true && !hasil?.mentok) ok("selesai=true tanpa mentok (keluar karena tugas tuntas)");
  else gagal(`hasil tidak sesuai → ${JSON.stringify(hasil)}`);

  const balasan = sesi.messages.filter((m) => m.role === "tool").length;
  if (balasan === 12) ok("12 tool_call dibalas lengkap");
  else gagal(`balasan tool = ${balasan}, harusnya 12`);
}

// ── 3. Tanpa batas + model BANDEL → rem "mentok" memutus loop ────────────
// Bahaya utama mode tanpa batas adalah loop abadi. Uji ini membuktikan
// rem-nya bekerja: model mengulang kalimat mentok → putus di putaran 2.
{
  modeServer = "mentok-kata"; jumlahPanggilan = 0;
  const cfg = await buatCfg();
  const sesi = { id: "tanpa-batas-mentok", messages: [{ role: "user", content: "kerjakan" }] };
  const t0 = Date.now();
  const hasil = await buatAgen({ cfg, tools, eksekusiTool, sesi }).then((a) => a.giliran("auto", "kerjakan"));
  const ms = Date.now() - t0;

  if (jumlahPanggilan === 2) ok(`deteksi mentok memutus loop di putaran 2 meski batas=0 (${ms}ms)`);
  else gagal(`bandel mengulang → panggilan=${jumlahPanggilan}, harusnya 2`);

  if (ms < 5000) ok(`loop tidak menggantung (${ms}ms)`);
  else gagal(`loop terlalu lama → ${ms}ms`);
}

// ── 4. Tanpa batas + bandel TANPA kata mentok → harus berhenti cepat ─────
// Kalau model minta tool terus tapi teksnya netral, rem (b) tidak kena.
// Uji ini memastikan ada rem (c): maksTool. Kalau maksTool juga 0, loop akan
// jalan terus — oleh karena itu mode tanpa batas WAJIB diimbangi --max /
// SIGINT, dan uji ini mendokumentasikan risiko itu secara eksplisit.
{
  modeServer = "bandel"; jumlahPanggilan = 0;
  const cfg = await buatCfg();
  cfg.maksPutaran = 0;
  cfg.maksTool = 25; // rem (c) aktif: batas total tool
  const sesi = { id: "tanpa-batas-tool", messages: [{ role: "user", content: "kerjakan" }] };
  const hasil = await buatAgen({ cfg, tools, eksekusiTool, sesi }).then((a) => a.giliran("auto", "kerjakan"));

  if (jumlahPanggilan <= 26) ok(`rem maksTool menahan loop bandel (panggilan=${jumlahPanggilan}, batas tool=25)`);
  else gagal(`rem maksTool bocor → panggilan=${jumlahPanggilan}`);

  if (hasil?.mentok === true) ok("mentok=true saat rem maksTool menahan");
  else gagal(`harusnya mentok=true → ${JSON.stringify(hasil)}`);
}

// ── 5. Rem EKSPLISIT: bila user memasang angka sendiri (12), loop bandel
//        harus berhenti di 12 — membuktikan rem masih berfungsi, meski
//        bawaan sekarang 0 (tanpa batas).
{
  modeServer = "bandel"; jumlahPanggilan = 0;
  const cfg = await muatConfig();
  cfg.baseUrl = `http://127.0.0.1:${port}/v1`;
  cfg.baseCadangan = "";
  cfg.apiKey = "uji";
  cfg.streamDefault = false;
  cfg.routingOtomatis = false;
  cfg.verbose = false;
  cfg.autoCompact = false;
  // Pasang rem sendiri; bawaan DEFAULT_CONFIG sengaja 0 (tanpa batas).
  cfg.maksPutaran = 12;
  cfg.maksTool = DEFAULT_CONFIG.maksTool;
  const sesi = { id: "rem-eksplisit-12", messages: [{ role: "user", content: "kerjakan" }] };
  const hasil = await buatAgen({ cfg, tools, eksekusiTool, sesi }).then((a) => a.giliran("auto", "kerjakan"));

  if (DEFAULT_CONFIG.maksPutaran === 0) ok(`DEFAULTS maksPutaran=0 / tanpa batas (terbaca ${DEFAULT_CONFIG.maksPutaran})`);
  else gagal(`DEFAULTS maksPutaran=${DEFAULT_CONFIG.maksPutaran}, harusnya 0 (tanpa batas)`);

  if (jumlahPanggilan === 12) ok(`loop berhenti tepat di rem eksplisit 12 → panggilan=${jumlahPanggilan}`);
  else gagal(`panggilan=${jumlahPanggilan}, harusnya 12 (berhenti di rem eksplisit)`);

  if (hasil?.mentok === true) ok("mentok=true → agent melapor kehabisan putaran");
  else gagal(`harusnya mentok=true → ${JSON.stringify(hasil)}`);
}

server.close();

console.log("\n=== RINGKASAN UJI TANPA BATAS ===");
for (const [s, t] of catat) console.log(`${s === "LULUS" ? "✅" : "❌"} ${s}: ${t}`);
const jumlahGagal = catat.filter(([s]) => s === "GAGAL").length;
console.log(`\n${catat.length - jumlahGagal}/${catat.length} lulus`);
console.log(jumlahGagal ? "HASIL: GAGAL ❌" : "HASIL: LULUS ✅");
process.exit(jumlahGagal ? 1 : 0);
