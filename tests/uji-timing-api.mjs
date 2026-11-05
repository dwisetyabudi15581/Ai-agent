import { panggilChat } from "../src/api/klien.js";
const port = process.env.UJI_PORT;
const cfg = { model: "uji/mock", modelCadangan: null, apiKey: "dummy",
  baseUrl: `http://127.0.0.1:${port}/v1`, baseCadangan: `http://127.0.0.1:${port}/v1`,
  suhu: 0, maxTokens: 100, streamDefault: false, verbose: false };
const msgs = [{ role: "user", content: "hai" }];
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  const h = await panggilChat(cfg, msgs, [], { stream: false, model: cfg.model, maxTokens: 100, suhu: 0 });
  console.log(`panggilan ${i}: ${Date.now() - t} ms, tool_calls=${h.pesan.tool_calls?.length ?? 0}`);
}
