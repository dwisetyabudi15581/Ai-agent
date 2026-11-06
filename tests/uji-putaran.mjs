// ============ UJI MENTOK VS BATAS PUTARAN (offline, server tiruan) ============
// Tujuan: buktikan dua hal yang sebelumnya tidak terverifikasi:
//   1) batas putaran cfg.maksPutaran DIHORMATI (bukan konstanta mati 20)
//   2) batas tercapai => { selesai: <true bila ada teks>, mentok: true }
//
// Server tiruan SELALU mengembalikan tool_calls (model bandel) → agen tidak
// akan pernah "selesai" sendiri, jadi satu-satunya jalan keluar adalah batas
// putaran. Non-stream dipakai agar tidak perlu meniru format SSE.
import http from "http";
import { buatAgen } from "../src/core/agen.js";
import { muatConfig } from "../src/config/config.js";

const catat = [];
const ok = (s) => catat.push(["LULUS", s]);
const gagal = (s) => catat.push(["GAGAL", s]);

// ── Server tiruan: selalu balas tool_calls ────────────────────────────────
let jumlahPanggilan = 0;
const server = http.createServer((req, res) => {
  let isi = "";
  req.on("data", (d) => (isi += d));
  req.on("end", () => {
    jumlahPanggilan++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "x", object: "chat.completion", model: "mock",
      choices: [{
        index: 0, finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: "", // TANPA teks: menguji cabang selesai=false
          tool_calls: [{
            id: `c${jumlahPanggilan}`, type: "function",
            function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const cfg = await muatConfig();
cfg.baseUrl = `http://127.0.0.1:${port}/v1`;
cfg.baseCadangan = "";
cfg.apiKey = "uji";
cfg.streamDefault = false;
cfg.routingOtomatis = false; // router dimatikan agar tak menembak jaringan
cfg.verbose = false;
cfg.maksPutaran = 3; // batas kecil supaya uji cepat
cfg.maksTool = 50;
cfg.autoCompact = false;

const sesi = { id: "uji-putaran", messages: [{ role: "user", content: "kerjakan" }] };
const tools = [{ type: "function", function: { name: "cek_folder", description: "x", parameters: { type: "object", properties: {} } } }];
const eksekusiTool = async (call) => ({ judul: "cek_folder", detail: ".", raw: "ok", ok: true });

const t0 = Date.now();
const hasil = await buatAgen({ cfg, tools, eksekusiTool, sesi }).then((a) => a.giliran("auto", "kerjakan"));
const ms = Date.now() - t0;

console.log(`\nhasil=${JSON.stringify(hasil)}  panggilanModel=${jumlahPanggilan}  ${ms}ms\n`);

// Assert 1: batas putaran dihormati (3, bukan 20)
if (jumlahPanggilan === 3) ok(`cfg.maksPutaran=3 dihormati (panggilan model = ${jumlahPanggilan})`);
else gagal(`batas putaran TIDAK dihormati: ${jumlahPanggilan} panggilan (harusnya 3)`);

// Assert 2: mentok=true karena loop keluar lewat batas putaran
if (hasil?.mentok === true) ok("mentok=true saat batas putaran tercapai");
else gagal(`mentok bukan true → ${JSON.stringify(hasil)}`);

// Assert 3: selesai=false karena model tidak pernah menulis teks
if (hasil?.selesai === false) ok("selesai=false saat tidak ada teks jawaban (konsisten)");
else gagal(`selesai seharusnya false tanpa teks → ${JSON.stringify(hasil)}`);

// Assert 4: setiap tool_call punya balasan role:tool (tidak ada panggilan menggantung)
const balasan = sesi.messages.filter((m) => m.role === "tool").length;
if (balasan === 3) ok(`3 tool_call dibalas lengkap (tanpa panggilan menggantung)`);
else gagal(`balasan tool = ${balasan}, harusnya 3`);

// ── Skenario 2: model menulis teks + tool → selesai=true, mentok=true ────
server.removeAllListeners("request");
let n2 = 0;
server.on("request", (req, res) => {
  req.on("data", () => {});
  req.on("end", () => {
    n2++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "y", object: "chat.completion", model: "mock",
      choices: [{ index: 0, finish_reason: "tool_calls",
        message: { role: "assistant", content: `langkah ${n2} saya cek folder`, tool_calls: [{
          id: `d${n2}`, type: "function",
          function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
const sesi2 = { id: "uji-putaran-2", messages: [{ role: "user", content: "kerjakan" }] };
const hasil2 = await buatAgen({ cfg, tools, eksekusiTool, sesi: sesi2 }).then((a) => a.giliran("auto", "kerjakan"));
console.log(`\nhasil2=${JSON.stringify(hasil2)}  panggilanModel=${n2}\n`);
if (hasil2?.selesai === true && hasil2?.mentok === true) ok("selesai=true + mentok=true saat ada teks tapi putaran habis");
else gagal(`harusnya selesai=true & mentok=true → ${JSON.stringify(hasil2)}`);

// ── Skenario 3: model bandel yang mengulang kalimat "mentok" ──────────────
server.removeAllListeners("request");
let n3 = 0;
server.on("request", (req, res) => {
  req.on("data", () => {});
  req.on("end", () => {
    n3++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "z", object: "chat.completion", model: "mock",
      choices: [{ index: 0, finish_reason: "tool_calls",
        message: { role: "assistant", content: "Sepertinya saya tidak menemukan perubahan apa pun.",
          tool_calls: [{ id: `e${n3}`, type: "function",
            function: { name: "cek_folder", arguments: JSON.stringify({ path_direktori: "." }) } }] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
const sesi3 = { id: "uji-putaran-3", messages: [{ role: "user", content: "kerjakan" }] };
const hasil3 = await buatAgen({ cfg, tools, eksekusiTool, sesi: sesi3 }).then((a) => a.giliran("auto", "kerjakan"));
console.log(`\nhasil3=${JSON.stringify(hasil3)}  panggilanModel=${n3}\n`);
if (n3 === 2 && hasil3?.mentok === true) ok("deteksi mentok memutus loop di putaran 2 (lebih awal dari batas 3)");
else gagal(`deteksi mentok tidak bekerja → panggilan=${n3} hasil=${JSON.stringify(hasil3)}`);

server.close();

// ── Ringkasan ─────────────────────────────────────────────────────────────
console.log("\n=== RINGKASAN UJI PUTARAN ===");
for (const [s, t] of catat) console.log(`${s === "LULUS" ? "✅" : "❌"} ${s}: ${t}`);
const jumlahGagal = catat.filter(([s]) => s === "GAGAL").length;
console.log(`\n${catat.length - jumlahGagal}/${catat.length} lulus`);
console.log(jumlahGagal ? "HASIL: GAGAL ❌" : "HASIL: LULUS ✅");
process.exit(jumlahGagal ? 1 : 0);
