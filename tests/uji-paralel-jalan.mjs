// Klien uji: agent memanggil server tiruan, 5 tool dijalankan paralel.
const __tStart = Date.now(); globalThis.__tStart = __tStart;
import { buatAgen } from "../src/core/agen.js";
import { panaskanFetch } from "../src/api/klien.js";

const port = process.env.UJI_PORT;
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

const jendelaFile = [];
const jendela = [];

const jejak = [];
const eksekusiTool = async (call) => {
  jejak.push([call.id, Date.now() - t0Global]);
  const a = JSON.parse(call.function.arguments || "{}");
  const t0 = Date.now();
  if (call.function.name === "lambat") {
    await new Promise((r) => setTimeout(r, a.ms));
    jendela.push({ label: a.label, mulai: t0, selesai: Date.now() });
    return { judul: `lambat ${a.label}`, detail: a.label, raw: `hasil-${a.label}`, ok: true };
  }
  // Deteksi bentrok: tool file yang sama TIDAK boleh jalan bersamaan.
  // Catat jendela waktu tiap pemakaian, lalu periksa tumpang tindih.
  const mulaiFile = Date.now();
  await new Promise((r) => setTimeout(r, 150));
  jendelaFile.push({ nama: a.nama_file, mulai: mulaiFile - t0Global, selesai: Date.now() - t0Global });
  return { judul: "file", detail: "ok", raw: `file-ok-${a.nama_file}`, ok: true };
};

panaskanFetch();
await new Promise(r=>setTimeout(r,600)); // tiru jeda user mengetik
const tModul = Date.now();
const sesi = { id: "uji-paralel", messages: [{ role: "user", content: "jalankan" }] };
const tSebelumBuat = Date.now();
const agen = await buatAgen({ cfg, tools: [], eksekusiTool, sesi });

const tSetelahBuat = Date.now();
const t0Global = Date.now();
console.log("FASE", JSON.stringify({impor: tModul-globalThis.__tStart, buatAgen: tSebelumBuat-tModul, sisanya: tSetelahBuat-tSebelumBuat})); process.env.UJI_T0 = String(t0Global);
const t0 = t0Global;
const tSebelum = Date.now();
const hasil = await agen.giliran("auto");
const tSesudah = Date.now();
const durasi = Date.now() - t0;

const toolMsgs = sesi.messages.filter((m) => m.role === "tool");
// cek tumpang tindih waktu: paralel sejati → semua mulai hampir bersamaan
const mulai = jendela.map((j) => j.mulai - t0);
const sebaranMulai = Math.max(...mulai) - Math.min(...mulai);

// hitung tumpang tindih pemakaian file yang sama
let bentrok = 0;
for (let i = 0; i < jendelaFile.length; i++) {
  for (let j = i + 1; j < jendelaFile.length; j++) {
    const a = jendelaFile[i], b = jendelaFile[j];
    if (a.nama === b.nama && a.mulai < b.selesai && b.mulai < a.selesai) bentrok++;
  }
}

const lapor = {
  durasi_ms: durasi,
  jumlah_tool_msg: toolMsgs.length,
  urutan_id: toolMsgs.map((m) => m.tool_call_id).join(","),
  isi: toolMsgs.map((m) => m.content).join(" | "),
  mulai_tool_lambat_ms: mulai,
  sebaran_mulai_ms: sebaranMulai,
  jendela_file: jendelaFile,
  bentrok_file: bentrok,
  hasil,
};
console.log(JSON.stringify(lapor, null, 2));

const lulus =
  durasi < 1200 &&
  toolMsgs.length === 6 &&
  lapor.urutan_id === "c1,c2,c3,c4,c5,c6" &&
  sebaranMulai < 100 &&
  bentrok === 0 &&
  hasil?.selesai === true;
console.log("JEJAK", JSON.stringify(jejak));
console.log("T", JSON.stringify({sebelum: tSebelum-t0Global, sesudah: tSesudah-t0Global, total: tSesudah-tSebelum}));
console.log(JSON.stringify({durasi, n:toolMsgs.length, id:lapor.urutan_id, sebaran:sebaranMulai, bentrok, selesai:hasil?.selesai}));
console.log(lulus ? "LULUS ✓" : "GAGAL ✗");
process.exit(lulus ? 0 : 1);
