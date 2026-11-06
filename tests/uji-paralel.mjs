import http from "node:http";
import { buatAgen } from "../src/core/agen.js";

const cek = [];
const rekam = (nama, ok, info = "") => {
  cek.push({ nama, ok });
  console.log(`${ok ? "OK  " : "GAGAL"} ${nama}${info ? " — " + info : ""}`);
};

const jawabanPalsu = [
  {
    choices: [{
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "A", ms: 300 }) } },
          { id: "c2", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "B", ms: 300 }) } },
          { id: "c3", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "C", ms: 300 }) } },
          { id: "c4", type: "function", function: { name: "tulis_file", arguments: JSON.stringify({ nama_file: "sama.txt", isi_kode: "x" }) } },
          { id: "c5", type: "function", function: { name: "tulis_file", arguments: JSON.stringify({ nama_file: "sama.txt", isi_kode: "y" }) } },
        ],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  },
  {
    choices: [{ message: { role: "assistant", content: "selesai" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  },
];

let putaran = 0;
const server = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jawabanPalsu[Math.min(putaran++, jawabanPalsu.length - 1)]));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const jendela = [];
const jendelaFile = [];
const eksekusiTool = async (call) => {
  const a = JSON.parse(call.function.arguments || "{}");
  const t0 = Date.now();
  if (call.function.name === "lambat") {
    await new Promise((r) => setTimeout(r, a.ms));
    jendela.push({ label: a.label, mulai: t0, selesai: Date.now() });
    return { judul: `lambat ${a.label}`, detail: a.label, raw: `hasil-${a.label}`, ok: true };
  }
  const mulai = Date.now();
  await new Promise((r) => setTimeout(r, 120));
  jendelaFile.push({ nama: a.nama_file, mulai, selesai: Date.now() });
  return { judul: "file", detail: "ok", raw: `file-ok-${a.nama_file}`, ok: true };
};

const cfg = {
  maksPutaran: 3,
  maksTool: 20,
  model: "uji/mock",
  modelCadangan: null,
  routingOtomatis: false,
  apiKey: "dummy",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  baseCadangan: "",
  suhu: 0,
  maxTokens: 100,
  streamDefault: false,
  verbose: false,
  autoCompact: false,
  batasKonteks: 999999,
};

const sesi = { id: "uji-paralel", messages: [{ role: "user", content: "jalankan" }] };
const tools = [
  {
    type: "function",
    function: {
      name: "lambat",
      description: "tool tiruan yang menunggu beberapa ms",
      parameters: {
        type: "object",
        properties: { ms: { type: "number" } },
        required: ["ms"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tulis_file",
      description: "tool tiruan yang menulis file",
      parameters: {
        type: "object",
        properties: { nama_file: { type: "string" }, ms: { type: "number" } },
        required: ["nama_file"],
      },
    },
  },
];
const agen = await buatAgen({ cfg, tools, eksekusiTool, sesi });

const t0 = Date.now();
const hasil = await agen.giliran("auto");
const durasi = Date.now() - t0;
server.close();

const toolMsgs = sesi.messages.filter((m) => m.role === "tool");
const mulai = jendela.map((j) => j.mulai - t0);
const sebaran = mulai.length ? Math.max(...mulai) - Math.min(...mulai) : 999;

let bentrok = 0;
for (let i = 0; i < jendelaFile.length; i++) {
  for (let j = i + 1; j < jendelaFile.length; j++) {
    const a = jendelaFile[i];
    const b = jendelaFile[j];
    if (a.nama === b.nama && a.mulai < b.selesai && b.mulai < a.selesai) bentrok++;
  }
}

const idUrut = toolMsgs.map((m) => m.tool_call_id).join(",");

console.log("putaran server  :", putaran);
console.log("durasi total ms :", durasi);
console.log("tool messages   :", toolMsgs.length, toolMsgs.map((m) => m.content).join(" | "));
console.log("urutan id       :", idUrut);
console.log("sebaran mulai ms:", sebaran, "(kecil = benar-benar paralel)");
console.log("bentrok file    :", bentrok);
console.log("hasil           :", JSON.stringify(hasil).slice(0, 200));
console.log("");

rekam("server tiruan menerima >0 permintaan", putaran > 0, `putaran=${putaran}`);
rekam("5 pesan tool tercatat", toolMsgs.length === 5, `${toolMsgs.length}`);
rekam("urutan id sesuai tool_calls", idUrut === "c1,c2,c3,c4,c5", idUrut);
rekam("3 tool lambat berjalan paralel", sebaran < 100, `sebaran=${sebaran}ms`);
rekam("tulis_file nama sama tidak bentrok", bentrok === 0, `bentrok=${bentrok}`);
rekam("giliran selesai", hasil?.selesai === true, JSON.stringify(hasil).slice(0, 80));
rekam("total waktu < 1400ms", durasi < 1400, `${durasi}ms`);

const gagal = cek.filter((c) => !c.ok).length;
console.log(`${cek.length - gagal} lulus / ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
