// Uji: tool dijalankan PARALEL, hasil tetap urut sesuai tool_calls.
// Versi ini memakai server HTTP tiruan lokal (tanpa jaringan internet) —
// versi sebelumnya mencoba "monkeypatch" panggilChat yang tidak mungkin pada
// ESM, lalu diam-diam menembak localhost dan gagal dengan "fetch failed".
import http from "http";
import { buatAgen } from "../src/core/agen.js";
import { panaskanFetch } from "../src/api/klien.js";

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

panaskanFetch();
await new Promise((r) => setTimeout(r, 400));

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

// routingOtomatis dimatikan agar router tidak mem-fetch /models ke server
// tiruan (request itu akan menghabiskan jawaban putaran pertama mock).
const cfg = {
  model: "uji/mock",
  modelCadangan: null,
  routingOtomatis: false,
  apiKey: "dummy",
  baseUrl: `http://127.0.0.1:${port}/v1`,
  baseCadangan: `http://127.0.0.1:${port}/v1`,
  suhu: 0,
  maxTokens: 100,
  streamDefault: false,
  verbose: false,
  autoCompact: false,
  batasKonteks: 999999,
};

const sesi = { id: "uji-paralel", messages: [{ role: "user", content: "jalankan" }] };
const agen = await buatAgen({ cfg, tools: [], eksekusiTool, sesi });

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
    const a = jendelaFile[i], b = jendelaFile[j];
    if (a.nama === b.nama && a.mulai < b.selesai && b.mulai < a.selesai) bentrok++;
  }
}

const idUrut = toolMsgs.map((m) => m.tool_call_id).join(",");
console.log("durasi total ms :", durasi);
console.log("tool messages   :", toolMsgs.length);
console.log("urutan id       :", idUrut);
console.log("isi             :", toolMsgs.map((m) => m.content).join(" | "));
console.log("sebaran mulai ms:", sebaran, "(kecil = benar-benar paralel)");
console.log("bentrok file    :", bentrok);
console.log("hasil           :", JSON.stringify(hasil));

const lulus =
  toolMsgs.length === 5 &&
  idUrut === "c1,c2,c3,c4,c5" &&
  sebaran < 100 &&      // 3 tool lambat mulai hampir bersamaan
  bentrok === 0 &&      // file sama tidak dipakai bersamaan
  hasil?.selesai === true &&
  durasi < 1400;        // 300 ms paralel + serialisasi file, bukan 3×300+2×120
console.log(lulus ? "LULUS ✓" : "GAGAL ✗");
process.exit(lulus ? 0 : 1);
