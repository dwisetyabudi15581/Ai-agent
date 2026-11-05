// Uji: agent harus berhenti karena MENTOK (bukan karena batas 20 putaran)
// dan hasil kerja tidak dibuang. Menggunakan tiruan panggilChat via mock import.
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const AKAR = fileURLToPath(new URL("..", import.meta.url));
const SRC_AGEN = path.join(AKAR, "src", "core", "agen.js");

// Substitusi lewat loader sederhana: bangun ulang src/core/agen.js dengan
// import diganti. Berkas uji ditulis di AKAR repo, jadi SEMUA impor relatif
// agen (./prompt, ../ui/util, dst.) harus ditulis ulang jadi path absolut.
const fs = await import("fs/promises");
let src = await fs.readFile(SRC_AGEN, "utf8");

// 1) sisipkan panggilChat tiruan (menggantikan impor asli dari api/klien)
src = src.replace(
  /import \{ panggilChat \} from [^;]+;/,
  `const panggilChat = async () => ({
    pesan: {
      role: "assistant",
      content: putaranTiruan === 1 ? "sepertinya saya masih mencoba" : "sepertinya tidak ada kemajuan",
      tool_calls: [{ id: "c" + (++putaranTiruan), function: { name: "cek", arguments: "{}" } }],
    },
    model: "tiruan",
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  var putaranTiruan = 0;`
);

// 2) impor relatif lain → URL berkas absolut (dihitung dari lokasi asli agen)
src = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (semua, rel) =>
  `from ${JSON.stringify(pathToFileURL(path.join(AKAR, "src", "core", rel)).href)}`
);

// Modul tiruan ditulis di akar repo (di-gitignore: .agen-uji*.mjs).
const berkasUji = path.join(AKAR, ".agen-uji.mjs");
await fs.writeFile(berkasUji, src);

const { buatAgen } = await import(pathToFileURL(berkasUji).href + "?t=" + Date.now());

const sesi = { id: "uji", messages: [{ role: "user", content: "kerjakan" }] };
const cfg = {
  model: "tiruan", maxTokens: 100, suhu: 0, verbose: false, autoCompact: false,
  batasKonteks: 1e9, routingOtomatis: false, // router dimatikan agar uji hermetis
};
const agen = await buatAgen({
  cfg,
  tools: [],
  eksekusiTool: async (c) => ({ raw: "ok", detail: "ok" }),
  sesi,
});

const t0 = Date.now();
const hasil = await agen.giliran("auto");
const ms = Date.now() - t0;

// putaranTiruan hidup di dalam modul hasil substitusi, bukan di berkas uji.
// Hitung kemajuan dari riwayat: tiap putaran menambah 1 asisten + 1 tool.
const jumlahAsisten = sesi.messages.filter((m) => m.role === "assistant").length;

console.log("\n=== HASIL UJI ===");
console.log("hasil      :", JSON.stringify(hasil));
console.log("putaran    :", jumlahAsisten, "(batas 20)");
console.log("riwayat    :", sesi.messages.length, "pesan");
console.log("durasi     :", ms, "ms");
console.log("terakhir   :", JSON.stringify(sesi.messages.at(-1)?.content || "").slice(0, 60));

const lulus = hasil.selesai === true && jumlahAsisten < 20 && sesi.messages.length > 2;
console.log(lulus ? "LULUS: berhenti cepat karena mentok, konteks tersimpan" : "GAGAL");
await fs.unlink(berkasUji).catch(() => {});
process.exit(lulus ? 0 : 1);
