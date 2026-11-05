// Server tiruan: putaran 1 → 5 tool_call paralel (3 lambat + 2 menulis file SAMA), putaran 2 → teks.
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

let permintaan = 0;
let putaran = 0;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    permintaan++;
    console.log(`[mock] #${permintaan} ${req.method} ${req.url} stream=${(()=>{try{return JSON.parse(body).stream}catch{return "?"}})()} t=${Date.now()%100000}`);
    putaran++;
    const toolCalls = [
      { id: "c1", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "A", ms: 400 }) } },
      { id: "c2", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "B", ms: 400 }) } },
      { id: "c3", type: "function", function: { name: "lambat", arguments: JSON.stringify({ label: "C", ms: 400 }) } },
      { id: "c4", type: "function", function: { name: process.env.UJI_MURNI ? "lambat" : "tulis_file", arguments: process.env.UJI_MURNI ? JSON.stringify({ label: "D", ms: 400 }) : JSON.stringify({ nama_file: "sama.txt", isi_kode: "x" }) } },
      { id: "c5", type: "function", function: { name: process.env.UJI_MURNI ? "lambat" : "tulis_file", arguments: process.env.UJI_MURNI ? JSON.stringify({ label: "E", ms: 400 }) : JSON.stringify({ nama_file: "sama.txt", isi_kode: "y" }) } },
      { id: "c6", type: "function", function: { name: process.env.UJI_MURNI ? "lambat" : "baca_file", arguments: process.env.UJI_MURNI ? JSON.stringify({ label: "F", ms: 400 }) : JSON.stringify({ nama_file: "lain.txt" }) } },
    ];

    const balasan = putaran === 1
      ? { choices: [{ message: { role: "assistant", content: "", tool_calls: toolCalls }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 5 } }
      : { choices: [{ message: { role: "assistant", content: "semua beres" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(balasan));
  });
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`[mock] siap di port ${port}`);
  const anakUji = process.env.UJI_ANAK || "./uji-paralel-jalan.mjs";
  const anak = spawn(process.execPath, [fileURLToPath(new URL(anakUji, import.meta.url))], {
    env: { ...process.env, UJI_PORT: String(port) },
    stdio: "inherit",
  });
  anak.on("exit", (kode) => {
    console.log(`[mock] total request diterima: ${permintaan}`);
    server.close();
    process.exit(kode ?? 0);
  });
});
