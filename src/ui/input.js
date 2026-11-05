// ============ INPUT: ANTREAN PESAN (aman untuk stdin pipe & terminal) ============
import readline from "readline";
import { tulis, C } from "./util.js";

const antrean = [];
let peminta = null;
let rl = null;
let tertutup = false;

export function mulaiInput() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true, historySize: 200 });

  rl.on("line", (baris) => {
    if (peminta) {
      const p = peminta;
      peminta = null;
      p(baris);
    } else antrean.push(baris);
  });

  rl.on("close", () => {
    tertutup = true;
    if (peminta) {
      const p = peminta;
      peminta = null;
      p(null); // EOF
    }
  });

  // Ctrl+C saat TIDAK sedang menunggu input: jangan matikan proses diam-diam.
  // Saat sedang menunggu input, readline meng-emit SIGINT juga — event
  // process "SIGINT" di ui/keluar.js yang menangani (simpan sesi lalu keluar).
  rl.on("SIGINT", () => {
    if (peminta) return; // siklus input aktif → tangani lewat process SIGINT
    tulis(`\n${C.gray}Ketik /quit untuk keluar.${C.reset}`);
  });
}

export function tanyaTeks(prompt) {
  if (antrean.length) {
    const v = antrean.shift();
    process.stdout.write(prompt + v + "\n");
    return Promise.resolve(v);
  }
  if (tertutup) { process.stdout.write("\n"); return Promise.resolve(null); }
  process.stdout.write(prompt);
  return new Promise((r) => { peminta = r; });
}

export function tutupInput() {
  try { rl?.close(); } catch { /* sudah tertutup */ }
}
