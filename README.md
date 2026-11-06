# Agent Termux v3.3

Asisten AI pribadi + agen otonom untuk Termux, ditenagai gateway OpenAI-compatible (**42 model** dalam satu API key).

## Pasang
```bash
export API_KEY=sk-xxxx           # atau isi ~/.agent-termux/config.json
node index.js
```

Gateway tunggal, tanpa provider lain. **Base URL tidak ditulis di kode** —
wajib diisi lewat `.env` (`BASE_URL`) atau `config.json` (`baseUrl`).
Bila keduanya kosong, client melapor galat "Base URL belum diatur" alih-alih
menembak host default. `config.json` murni setelan lokal tanpa kredensial;
kunci API hanya dibaca dari env / `.env`.

## Struktur proyek
```
index.js                Titik masuk: flag CLI + perintah slash + loop utama
src/
├── paths.js            Lokasi data (~/.agent-termux)
├── config/config.js    Konfigurasi (env/.env/config.json) + urutan host + failover
├── api/
│   ├── preset-model.js Snapshot 42 model Re:Link (multiplier, vendor, status)
│   ├── katalog.js      Katalog: live /v1/models + preset + cache + fallback offline
│   └── klien.js        Klien HTTP: chat/completions, SSE stream, failover berderet
├── core/
│   ├── agen.js         Loop tool-calling (paralel, mutex file, deteksi mentok)
│   ├── router.js       Router model otomatis (hemat kuota per giliran)
│   ├── prompt.js       System prompt (kepribadian + aturan agen)
│   ├── sesi.js         Sesi & ringkasan riwayat otomatis
│   └── memori.js       Memori jangka panjang antar sesi
├── tools/tools.js      12 tool untuk model (file, terminal, web, memori, katalog)
└── ui/                 tampilan terminal, menu model, input, penjaga keluar
tests/                  14 uji lokal (tanpa API key) + 2 uji live
```

## Flag
| Flag | Fungsi |
|---|---|
| `--teman` | mode teman ngobrol (eksekusi perintah dibatasi) |
| `--model <id>` | set model awal **dan menguncinya** (router tidak menimpa) |
| `--router` | buka kunci — paksa router otomatis aktif lagi |
| `--no-stream` | paksa non-streaming |
| `--verbose` | tampilkan usage token & reasoning |
| `--max <n>` | batas jumlah giliran user lalu keluar |

## Perintah dalam aplikasi
`/help` `/model` `/router` `/tools` `/memori` `/lupakan` `/sesi` `/lanjut` `/simpan` `/baru`
`/ringkas` `/teman` `/agen` `/stream` `/nostream` `/suhu` `/maxtoken` `/verbose` `/biaya` `/clear` `/quit`

### Pilih model (`/model`)
- `/model` — menu interaktif **model aktif** (nama, id, vendor, multiplier, kapabilitas)
- `/model semua` — tampilkan **seluruh 42 model** (nonaktif ditandai ✗, tidak bisa dipilih)
- `/model cari <kata>` — filter, mis. `/model cari vision`
- `/model <id>` atau `/model <nomor>` — pasang langsung
- Katalog digabung dari live `/v1/models` (status terbaru) + preset (multiplier/vendor);
  saat offline otomatis jatuh ke snapshot preset sehingga menu tetap terisi.

### Router otomatis (`/router`)
Model dipilih **per giliran** sesuai kesulitan tugas — biaya diperingkat lewat
**multiplier token** Re:Link (bukan dolar):
- obrolan ringan → model termurah (mult 1x, mis. `auto`, `kimi-k2.7-code`)
- tugas teknis (skrip/bug/uji) → kelas menengah termurah (mis. `deepseek-v4-pro` 1.15x)
- tugas berat (refaktor/arsitektur/analisis mendalam) → kuartil kelas kuat

`/model <pilih>` mengunci pilihan (router menyerah); `/router on` membuka kunci,
`/router off` mematikan fitur. Setiap pergantian model dicetak alasannya.

### Estimasi pemakaian (`/biaya`)
Menampilkan perkiraan token masuk/keluar dan **kuota terpotong** =
(masuk + keluar) × multiplier model aktif.

## Kemampuan (tools)
baca_file · tulis_file · edit_file · hapus_file · eksekusi_terminal · cek_folder ·
cari_teks · daftar_model · ingat · baca_memori · cari_web · ambil_url

`daftar_model` memberi model daftar lengkap 42 model (aktif + nonaktif, multiplier,
vendor) sehingga agent bisa membantu memilihkan.

## Data
- `~/.agent-termux/config.json` — pengaturan (API key, model, suhu, router)
- `~/.agent-termux/memory.md` — memori jangka panjang antar sesi
- `~/.agent-termux/sessions/` — riwayat sesi (bisa dilanjutkan)
- `~/.agent-termux/backups/` — backup otomatis setiap file ditimpa
- `~/.agent-termux/transkrip/` — arsip transkrip penuh
- `~/.agent-termux/cache-model.json` — cache katalog (1 jam)

## Host API
- `https://api.relink-gateway.biz.id/v1` — endpoint resmi Re:Link Gateway (OpenAI-compatible)
- Katalog model (`/v1/models`) publik; 25 dari 42 model aktif per 5 Nov 2026,
  antara lain `deepseek-v4-pro` (1.15x), `glm-5.2` (1.25x), `kimi-k2.8` (2x),
  `gpt-6-luna` (8x), `gpt-6-astra` (42x), `gemini-4-argon` (60x)
- Tagihan berupa token prabayar: `(prompt + completion) × multiplier` — bukan dolar per juta token
- `baseCadangan` boleh diisi host OpenAI-compatible lain; client otomatis failover
  ke sana bila host utama error (404/403/5xx/timeout)

## Uji
```bash
npm test          # suite lokal (server tiruan, tanpa API key)
npm run test:live # uji ketahanan + SIGINT (butuh API key & terminal)
```
