// Bukti: dengan panaskanFetch(), fetch sesungguhnya jadi cepat.
import { panaskanFetch } from "../src/api/klien.js";
const t0 = Date.now();
panaskanFetch();
// kerja lain yang biasanya berjalan saat start (muat memori, dsb.)
await new Promise(r => setTimeout(r, 700));
console.log(`startup sintetis selesai di ${Date.now()-t0} ms`);
const http = await import("http");
const s = http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"application/json"});r.end('{"a":1}')});
await new Promise(r=>s.listen(0,"127.0.0.1",r));
const p = s.address().port;
const t1 = Date.now();
await (await fetch(`http://127.0.0.1:${p}/x`)).json();
console.log(`fetch sungguhan setelah pemanasan: ${Date.now()-t1} ms`);
s.close();
process.exit(0);
