// ============ PRESET KATALOG MODEL GATEWAY ============
// Snapshot katalog gateway per 2026-11-05.
//
// Kegunaan:
//  1. Sumber multiplier, nama tampilan, dan vendor — endpoint /v1/models
//     TIDAK menyediakan ketiganya, sedangkan router butuh multiplier
//     sebagai metrik biaya (gateway memakai token prabayar x multiplier,
//     bukan dolar per juta token).
//  2. Katalog cadangan saat offline: menu /model tetap terisi walau
//     jaringan/gateway sedang tidak bisa dihubungi.
//
// Baris tiap model: id, nama, vendor, vision, aktif (status snapshot),
// multiplier (pengali konsumsi token terhadap kuota).
// Status `aktif` bisa berubah sewaktu-waktu di sisi gateway — katalog live
// dari /v1/models selalu menang atas snapshot ini (lihat api/katalog.js).
// Perbarui snapshot: ambil <BASE_URL>/models memakai API_KEY yang sama
// dengan runtime, lalu sunting berkas ini. Base URL tidak ditulis di kode —
// ambil dari env BASE_URL atau config.json.

export const TANGGAL_PRESET = "2026-11-05";

export const PRESET_MODEL = [
  { id: "auto", nama: "Auto", vendor: "Lainnya", vision: false, aktif: true, multiplier: 1 },
  { id: "claude-opus-5", nama: "Claude Opus 5", vendor: "Anthropic", vision: true, aktif: false, multiplier: 20 },
  { id: "claude-opus-5-5", nama: "Claude Opus 5 5", vendor: "Anthropic", vision: true, aktif: false, multiplier: 32 },
  { id: "claude-sonnet-5", nama: "Claude Sonnet 5", vendor: "Anthropic", vision: true, aktif: false, multiplier: 10 },
  { id: "deepseek-v4-flash", nama: "Deepseek V4 Flash", vendor: "DeepSeek", vision: false, aktif: true, multiplier: 2 },
  { id: "deepseek-v4-flash-0731", nama: "Deepseek V4 Flash 0731", vendor: "DeepSeek", vision: false, aktif: true, multiplier: 2 },
  { id: "deepseek-v4-flash-vision-exp", nama: "Deepseek V4 Flash Vision Exp", vendor: "DeepSeek", vision: true, aktif: true, multiplier: 2.5 },
  { id: "deepseek-v4-mod", nama: "Deepseek V4 Mod", vendor: "DeepSeek", vision: false, aktif: true, multiplier: 3 },
  { id: "deepseek-v4-pro", nama: "Deepseek V4 Pro", vendor: "DeepSeek", vision: false, aktif: true, multiplier: 1.15 },
  { id: "deepseek-v4-pro-0813", nama: "Deepseek V4 Pro 0813", vendor: "DeepSeek", vision: false, aktif: false, multiplier: 1.8 },
  { id: "deepseek-v4.1-flash", nama: "Deepseek V4.1 Flash", vendor: "DeepSeek", vision: true, aktif: true, multiplier: 2.56 },
  { id: "deepseek-v4.1-flash-1017", nama: "Deepseek V4.1 Flash 1017", vendor: "DeepSeek", vision: true, aktif: true, multiplier: 3 },
  { id: "deepseek-v4.1-flash-1017-mod", nama: "Deepseek V4.1 Flash 1017 Mod", vendor: "DeepSeek", vision: true, aktif: true, multiplier: 3.5 },
  { id: "deepseek-v4.1-flash-mod", nama: "Deepseek V4.1 Flash Mod", vendor: "DeepSeek", vision: true, aktif: true, multiplier: 3.2 },
  { id: "gemini-4-argon", nama: "Gemini 4 Argon", vendor: "Google", vision: true, aktif: true, multiplier: 60 },
  { id: "glm-5.2", nama: "GLM 5.2", vendor: "Zhipu AI", vision: false, aktif: true, multiplier: 1.25 },
  { id: "glm-5.2-mod", nama: "GLM 5.2 Mod", vendor: "Zhipu AI", vision: false, aktif: true, multiplier: 3 },
  { id: "glm-5.3", nama: "GLM 5.3", vendor: "Zhipu AI", vision: false, aktif: true, multiplier: 2 },
  { id: "glm-5.3-flash", nama: "GLM 5.3 Flash", vendor: "Zhipu AI", vision: true, aktif: true, multiplier: 2 },
  { id: "glm-5.3-flash-mod", nama: "GLM 5.3 Flash Mod", vendor: "Zhipu AI", vision: true, aktif: true, multiplier: 3.5 },
  { id: "glm-5.3-flashx", nama: "GLM 5.3 Flashx", vendor: "Zhipu AI", vision: true, aktif: false, multiplier: 3 },
  { id: "glm-5.3-flashx-mod", nama: "GLM 5.3 Flashx Mod", vendor: "Zhipu AI", vision: true, aktif: false, multiplier: 5 },
  { id: "glm-5.3-mod", nama: "GLM 5.3 Mod", vendor: "Zhipu AI", vision: false, aktif: true, multiplier: 3.2 },
  { id: "gpt-5.6", nama: "GPT 5.6", vendor: "OpenAI", vision: true, aktif: false, multiplier: 5 },
  { id: "gpt-5.6-luna", nama: "GPT 5.6 Luna", vendor: "OpenAI", vision: true, aktif: false, multiplier: 5 },
  { id: "gpt-5.6-sol", nama: "GPT 5.6 Sol", vendor: "OpenAI", vision: true, aktif: false, multiplier: 25 },
  { id: "gpt-5.6-terra", nama: "GPT 5.6 Terra", vendor: "OpenAI", vision: true, aktif: false, multiplier: 10 },
  { id: "gpt-6-astra", nama: "GPT 6 Astra", vendor: "OpenAI", vision: true, aktif: true, multiplier: 42 },
  { id: "gpt-6-luna", nama: "GPT 6 Luna", vendor: "OpenAI", vision: true, aktif: true, multiplier: 8 },
  { id: "gpt-6-sol", nama: "GPT 6 Sol", vendor: "OpenAI", vision: true, aktif: false, multiplier: 30 },
  { id: "hy3", nama: "Hy3", vendor: "Tencent", vision: false, aktif: false, multiplier: 1 },
  { id: "hy4", nama: "Hy4", vendor: "Tencent", vision: false, aktif: false, multiplier: 1.4 },
  { id: "kimi-k2.5", nama: "Kimi K2.5", vendor: "Moonshot", vision: false, aktif: false, multiplier: 1 },
  { id: "kimi-k2.6", nama: "Kimi K2.6", vendor: "Moonshot", vision: false, aktif: false, multiplier: 1 },
  { id: "kimi-k2.7-code", nama: "Kimi K2.7 Code", vendor: "Moonshot", vision: false, aktif: true, multiplier: 1 },
  { id: "kimi-k2.7-code-highspeed", nama: "Kimi K2.7 Code Highspeed", vendor: "Moonshot", vision: false, aktif: true, multiplier: 1.5 },
  { id: "kimi-k2.8", nama: "Kimi K2.8", vendor: "Moonshot", vision: true, aktif: true, multiplier: 2 },
  { id: "kimi-k3", nama: "Kimi K3", vendor: "Moonshot", vision: false, aktif: false, multiplier: 6 },
  { id: "kimi-k3-mod", nama: "Kimi K3 Mod", vendor: "Moonshot", vision: false, aktif: false, multiplier: 8 },
  { id: "mimo-v2.5-pro", nama: "Mimo V2.5 Pro", vendor: "MiniMax", vision: true, aktif: true, multiplier: 1.4 },
  { id: "mimo-v2.6-flash", nama: "Mimo V2.6 Flash", vendor: "MiniMax", vision: true, aktif: true, multiplier: 2 },
  { id: "mimo-v2.6-pro", nama: "Mimo V2.6 Pro", vendor: "MiniMax", vision: true, aktif: true, multiplier: 2 },
];

/** Cari preset berdasarkan id (Map sekali-buat, lookup O(1)). */
/** @deprecated alias lama, dipertahankan agar impor pihak ketiga tidak rusak */
/**
 * @deprecated Alias lama demi kompatibilitas impor. Gunakan PRESET_MODEL.
 */
export const PRESET_RELINK = PRESET_MODEL;

const PETA_PRESET = new Map(PRESET_MODEL.map((m) => [m.id, m]));
export function cariPreset(id) {
  return PETA_PRESET.get(id) || null;
}
