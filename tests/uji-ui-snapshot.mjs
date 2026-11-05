// Pratinjau visual UI tanpa memanggil API. Jalankan: node tests/uji-ui-snapshot.mjs
import { C, bubble, tulis, kotak, badge } from "../src/ui/util.js";
import { panel } from "../src/ui/tampilan.js";

// Paksa lebar agar konsisten di snapshot (opsional via env).
if (process.env.LEBAR_UJI) {
  Object.defineProperty(process.stdout, "columns", { value: Number(process.env.LEBAR_UJI), configurable: true });
}

tulis(`${C.samar}(pratinjau UI — lebar ${process.stdout.columns || 80})${C.reset}`);

// --- header tiruan ---
tulis("");
tulis(`  ${C.aksen}${C.bold}◆${C.reset}  ${C.bold}${C.aksen}A${C.aksen2}G${C.emas}E${C.jingga}N${C.ungu}T${C.reset} ${C.samar}${C.dim}·${C.reset} ${C.bold}Termux AI${C.reset} ${C.samar}v3.3${C.reset}`);
tulis(`  ${C.samar}${"─".repeat(56)}${C.reset}`);
tulis(`  ${C.samar}model${C.reset}  ${C.bold}${C.white}glm-5.3-flash${C.reset}`);
tulis(`  ${C.samar}router ${C.reset}${C.aksen2}otomatis${C.reset}   ${C.samar}mode${C.reset} ${C.ungu}agen otonom${C.reset}   ${C.samar}sesi${C.reset} ${C.samar}20261105-2300${C.reset}`);
tulis(`  ${C.samar}${"─".repeat(56)}${C.reset}`);

// --- bubble user ---
bubble("user", "Tolong rapikan folder tools dan test tool dinamisnya ya");

// --- bubble agent dengan markdown ---
bubble("agent", "Oke, saya cek dulu. Ini yang saya temukan:\n\n**Temuan penting**\n- Tool dinamis *sudah bekerja*\n- Ada `1 file` sisa dari uji\n\n```js\nconst t = a.reduce((s,x)=>s+x,0);\nconsole.log(t);\n```\n\nSelanjutnya saya bersihkan.");

// --- bubble tool ---
bubble("tool", { judul: "eksekusi_terminal → rm -v tools/*.js", detail: "removed 'baca_file.tool.js'\nremoved 'cek_waktu.tool.js'", ok: true });
bubble("tool", { judul: "bikin_tool → cek_waktu", detail: "Tool terpasang di ~/.agent-termux/tools/cek_waktu.tool.js", ok: false });

// --- bubble info / sukses / error ---
bubble("info", "Router otomatis aktif — model dipilih per giliran sesuai kesulitan.");
bubble("sukses", "Sesi disimpan sebagai 20261105-2300.");
bubble("error", "Tidak bisa ambil katalog: koneksi timeout.");

// --- panel ---
panel("CONTOH PANEL", [
  `${C.samar}baris satu${C.reset} nilai ${C.emas}42${C.reset}`,
  `${C.samar}baris dua${C.reset} ${badge("baru", C.aksen2)} status ${C.aksen2}aktif${C.reset}`,
  `${C.cyan}▸${C.reset} bullet dengan aksen`,
], { warna: C.ungu });

// --- badge sendirian ---
tulis("");
tulis(`  contoh badge: ${badge("agent", C.aksen)} ${badge("tool", C.jingga)} ${badge("ok", C.aksen2)} ${badge("error", C.merah)}`);
tulis("");
