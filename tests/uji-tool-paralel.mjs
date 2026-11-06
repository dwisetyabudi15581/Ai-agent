// Uji terisolasi: Agent harus MEMAKAI tool meski system prompt di-edit user
// (kasus nyata: user mengganti kepribadian sehingga aturan tool ikut terhapus).
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";

const dirIsolasi = fs.mkdtempSync(path.join(os.tmpdir(), "uji-tool-"));
const homeAsli = process.env.HOME;
process.env.HOME = dirIsolasi;

const { buatAgen } = await import(path.resolve("src/core/agen.js"));
const { panaskanFetch } = await import(path.resolve("src/api/klien.js"));

const jawabanPalsu = [
  { choices: [{ message: { role: "assistant", content: "", tool_calls: [
    { id: "c1", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "A", ms: 300 }) } },
    { id: "c2", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "B", ms: 300 }) } },
  ] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  { choices: [{ message: { role: "assistant", content: "selesai" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
];

let putaran = 0;
const server = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(b); } catch {}
    if (req.url.includes("chat/completions")) {
      const sys = (j.messages || []).find((m) => m.role === "system");
      console.error("REQ tools=" + (j.tools ? j.tools.map((t) => t.function.name).join(",") : "TIDAK-ADA"));
      console.error("REQ syslen=" + (sys ? sys.content.length : 0));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(jawabanPalsu[Math.min(putaran++, 1)]));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "uji/mock", object: "model" }] }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
panaskanFetch();
await new Promise((r) => setTimeout(r, 400));

const eksekusiTool = async (call) => {
  const a = JSON.parse(call.function.arguments || "{}");
  await new Promise((r) => setTimeout(r, a.ms));
  return { judul: "lambat " + a.label, detail: a.label, raw: "hasil-" + a.label, ok: true };
};

const toolUji = [{
  type: "function",
  function: { name: "lambat", description: "tunggu beberapa ms",
    parameters: { type: "object", properties: { label: { type: "string" }, ms: { type: "number" } }, required: ["label"] } },
}];

const cfg = {
  model: "uji/mock", modelCadangan: null, routingOtomatis: false, apiKey: "dummy",
  baseUrl: `http://127.0.0.1:${port}/v1`, baseCadangan: `http://127.0.0.1:${port}/v1`,
  suhu: 0, maxTokens: 100, streamDefault: false, verbose: true, autoCompact: false, batasKonteks: 999999,
};

const sesi = { id: "dbg", messages: [{ role: "user", content: "jalankan" }] };
const agen = await buatAgen({ cfg, tools: toolUji, eksekusiTool, sesi });
const t0 = Date.now();
const hasil = await agen.giliran("auto");
const durasi = Date.now() - t0;
server.close();
process.env.HOME = homeAsli;
console.error("DURASI", durasi, "ms (2 tool x 300ms -> paralel ~300-400, seri ~600+)");
console.error("HASIL", JSON.stringify(hasil));
console.error("PESAN", JSON.stringify(sesi.messages.map((m) => ({ r: m.role, c: (m.content || "").slice(0, 50), tc: m.tool_calls ? m.tool_calls.length : 0 }))));
