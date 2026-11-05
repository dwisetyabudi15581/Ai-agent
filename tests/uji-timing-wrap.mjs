import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
const s = http.createServer((q, r) => { let b=""; q.on("data",c=>b+=c); q.on("end",()=>{
  r.writeHead(200,{"Content-Type":"application/json"});
  r.end(JSON.stringify({choices:[{message:{role:"assistant",content:"ok"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:1}}));
});});
s.listen(0,"127.0.0.1",()=>{
  const k = spawn(process.execPath,[fileURLToPath(new URL("./uji-timing-api.mjs", import.meta.url))],{env:{...process.env,UJI_PORT:String(s.address().port)},stdio:"inherit"});
  k.on("exit",c=>{s.close();process.exit(c??0);});
});
