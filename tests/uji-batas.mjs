// Uji: bila BENAR-BENAR mentok di batas 20 putaran (content netral, terus panggil tool),
// hasil tidak boleh dibuang: return selesai=true + mentok=true.
import fs from "fs/promises"; import path from "path"; import { pathToFileURL, fileURLToPath } from "url";
const AKAR = fileURLToPath(new URL("..", import.meta.url));
const SRC_AGEN = path.join(AKAR, "src", "core", "agen.js");

let src = await fs.readFile(SRC_AGEN, "utf8");
// 1) tiruan panggilChat (menggantikan impor asli dari api/klien)
src = src.replace(/import \{ panggilChat \} from [^;]+;/,
  `const panggilChat = async () => ({ pesan: { role: "assistant", content: "mengerjakan langkah",
    tool_calls: [{ id: "x" + Math.random(), function: { name: "cek", arguments: "{}" } }] },
    model: "tiruan", usage: { prompt_tokens: 1, completion_tokens: 1 } });`);
// 2) impor relatif lain → URL absolut (berkas uji ditulis di akar repo,
//    sedangkan impor agen dihitung dari lokasi asalinya di src/core/)
src = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (semua, rel) =>
  `from ${JSON.stringify(pathToFileURL(path.join(AKAR, "src", "core", rel)).href)}`);

// Modul tiruan ditulis di akar repo (di-gitignore: .agen-uji*.mjs).
const f = path.join(AKAR, ".agen-uji2.mjs"); await fs.writeFile(f, src);
const { buatAgen } = await import(pathToFileURL(f).href + "?t=" + Date.now());
const sesi = { id: "uji2", messages: [{ role: "user", content: "kerjakan" }] };
const agen = await buatAgen({ cfg: { model: "tiruan", verbose: false, autoCompact: false, batasKonteks: 1e9, routingOtomatis: false },
  tools: [], eksekusiTool: async () => ({ raw: "ok" }), sesi });
const hasil = await agen.giliran("auto");
const n = sesi.messages.filter(m => m.role === "assistant").length;
console.log("\n=== UJI BATAS ===");
console.log("hasil   :", JSON.stringify(hasil));
console.log("putaran :", n, "| pesan:", sesi.messages.length);
const lulus = hasil.mentok === true && hasil.selesai === true && n === 20;
console.log(lulus ? "LULUS: batas 20 tercapai & konteks tidak dibuang" : "GAGAL");
await fs.unlink(f).catch(()=>{});
process.exit(lulus ? 0 : 1);
