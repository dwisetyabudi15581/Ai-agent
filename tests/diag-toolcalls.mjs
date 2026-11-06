// Diagnosa: apakah pesan assistant yang mengandung tool_calls tersimpan
// lengkap di sesi.messages setelah putaran tool dijalankan.
import { muatConfig } from "../src/config/config.js";
import { buatAgen } from "../src/core/agen.js";
import { daftarTools, buatEksekutor } from "../src/tools/tools.js";

const cfg = await muatConfig();
if (!cfg.apiKey) {
  console.log("TIDAK ADA API KEY — diagnosa butuh panggilan model nyata.");
  process.exit(0);
}

const tools = daftarTools();
const sesi = { messages: [{ role: "user", content: "Jalankan `echo halo` lalu sebutkan hasilnya. Satu tool call saja." }] };

const agen = await buatAgen({
  cfg,
  tools,
  sesi,
  eksekusiTool: async (nama, args) => {
    console.log("[tool dijalankan]", nama, JSON.stringify(args).slice(0, 120));
    return { judul: nama, detail: "halo", ok: true };
  },
});

const out = await agen.giliran().then(() => (sesi.messages.filter(m=>m.role==="assistant").pop()||{}).content);
console.log("--- hasil akhir (potongan) ---");
console.log(String(out || "").slice(0, 200));

console.log("\n--- SESI.MESSAGES ---");
sesi.messages.forEach((m, i) => {
  console.log(
    i,
    m.role,
    "content:" + (typeof m.content === "string" ? m.content.length : typeof m.content),
    "tool_calls:" + (Array.isArray(m.tool_calls) ? m.tool_calls.length : "none"),
    "tool_call_id:" + (m.tool_call_id ? "ya" : "-"),
  );
});

const asst = sesi.messages.filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length);
const toolMsg = sesi.messages.filter((m) => m.role === "tool");
console.log("\nassistant dengan tool_calls:", asst.length);
console.log("pesan tool:", toolMsg.length);
console.log(asst.length > 0 && toolMsg.length > 0 ? "\nSTATUS: pasangan tool utuh tersimpan OK" : "\nSTATUS: BUG — pasangan tool hilang/terpotong");
