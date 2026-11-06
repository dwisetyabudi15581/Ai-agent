// ============ UI UTIL: WARNA, LAYAR, BUBBLE, HELPER ============
// Warna dimatikan otomatis bila bukan TTY atau user set NO_COLOR.
//
// Desain ulang v3.3: palet 256-warna (dengan fallback truecolor → 256 → 16),
// border kotak halus, badge, dan bubble chat beraksen kiri. Semua warna tetap
// bisa dimatikan total lewat NO_COLOR atau saat output bukan terminal.

// ---------- Deteksi kemampuan warna ----------
const BUKAN_TTY = process.stdout.isTTY !== true;
const NO_WARNA = Boolean(process.env.NO_COLOR);
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM || "");
const PAKAI_WARNA = !NO_WARNA && !BUKAN_TTY;

/** Kode warna 256 (fg). Bila warna mati → string kosong. */
function fg256(n) {
  return PAKAI_WARNA ? `\x1b[38;5;${n}m` : "";
}
/** Kode warna 256 (bg). */
function bg256(n) {
  return PAKAI_WARNA ? `\x1b[48;5;${n}m` : "";
}
/** Warna RGB truecolor bila didukung, jika tidak jatuh ke 256. */
function rgb(r, g, b, win256 = 245) {
  if (!PAKAI_WARNA) return "";
  return TRUECOLOR ? `\x1b[38;2;${r};${g};${b}m` : fg256(win256);
}

const RST = PAKAI_WARNA ? "\x1b[0m" : "";
const BLD = PAKAI_WARNA ? "\x1b[1m" : "";
const DIM = PAKAI_WARNA ? "\x1b[2m" : "";
const ITL = PAKAI_WARNA ? "\x1b[3m" : "";

// ---------- Palet ----------
export const C = {
  reset: RST, bold: BLD, dim: DIM, italic: ITL,

  // Warna dasar (16) — dipakai bila perlu fallback paling aman.
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  magenta: "\x1b[35m", red: "\x1b[31m", gray: "\x1b[90m", white: "\x1b[97m",

  // Aksen 256-warna untuk tampilan modern.
  aksen: rgb(97, 175, 239, 111),      // biru langit (agent)
  aksen2: rgb(152, 195, 121, 114),    // hijau lembut (user/sukses)
  emas: rgb(229, 192, 123, 179),      // emas (judul/perintah)
  ungu: rgb(198, 120, 221, 176),      // ungu (judul panel)
  jingga: rgb(209, 154, 102, 173),    // jingga (tool)
  merah: rgb(224, 108, 117, 167),     // merah lembut (error)
  samar: rgb(92, 99, 112, 240),       // kelabu redup (meta)
  bgPanel: bg256(236),
  bgKode: bg256(235),

  // Eksplisit untuk blok kode (agar ANSI tidak terpotong saat streaming).
  kode: PAKAI_WARNA ? "\x1b[38;5;252m\x1b[48;5;235m" : "",
  tebal: BLD,
};

/** Nama gaya → kode ANSI, untuk pemakaian seragam. */
export const GAYA = {
  agent: C.aksen, user: C.aksen2, tool: C.jingga, info: C.aksen,
  sukses: C.aksen2, error: C.merah, emas: C.emas,
};

/** Hapus seluruh kode ANSI bila warna dimatikan. */
export function tanpaWarna(teks) {
  if (PAKAI_WARNA) return String(teks);
  return String(teks)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

// ---------- Waktu ----------
export function waktu() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function jamSekarang() {
  return `${C.samar}[${waktu()}]${C.reset}`;
}

// ---------- Lebar & pembungkusan ----------
const ANSI = /\x1b\[[0-9;]*m/g;

/** Lebar visual teks (ANSI diabaikan, emoji/wide char dihitung 2). */
// Penanda gaya (lihat P di bawah) adalah karakter kontrol yang TIDAK pernah
// dicetak — dibuang oleh terapkanGaya/tanpaWarna. Jadi ia tidak boleh ikut
// dihitung sebagai lebar, kalau tidak bungkus() memotong baris terlalu cepat.
const PENANDA_GAYA = /[\u0000-\u0008\u000e]/g;

export function lebarTeks(s) {
  let total = 0;
  for (const ch of String(s).replace(ANSI, "").replace(PENANDA_GAYA, "")) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f300 && cp <= 0x1faff) total += 2;
    else if (cp >= 0x1100 && cp <= 0x115f) total += 2;
    else total += 1;
  }
  return total;
}

export function lebar() {
  const cols = process.stdout.columns || 80;
  return Math.max(Math.min(cols, 100) - 4, 40);
}

/**
 * Bungkus teks agar tidak melebihi lebarMaks.
 * Aman untuk teks ber-ANSI: memotong pada batas kata sedekat mungkin.
 */
export function bungkus(teks, lebarMaks, indentasiGantung = 0) {
  const hasil = [];
  const gantung = (indentasiGantung > 0 && indentasiGantung < lebarMaks)
    ? " ".repeat(indentasiGantung) : "";
  const lebarIsi = lebarMaks - gantung.length;
  for (const barisAsli of String(teks ?? "").split("\n")) {
    if (lebarTeks(barisAsli) <= lebarMaks) { hasil.push(barisAsli); continue; }
    let sisa = barisAsli;
    let pertama = true;
    while (lebarTeks(sisa) > lebarMaks) {
      let potong = sisa.lastIndexOf(" ", lebarMaks);
      if (potong <= 0) potong = lebarMaks;
      hasil.push(sisa.slice(0, potong));
      sisa = (pertama && gantung ? gantung : gantung || "") + sisa.slice(potong).trimStart();
      pertama = false;
      // hindari loop tak berujung bila sisa tak menyusut
      if (lebarTeks(sisa) > lebarMaks && sisa.trim().length === 0) break;
    }
    if (sisa.length) hasil.push(sisa);
  }
  return hasil.length ? hasil : [""];
}

// ---------- Markdown ringan → penanda gaya ----------
// Penanda berbasis karakter kontrol (bukan ANSI mentah) supaya aman dipotong
// per baris saat streaming. Dibuka dengan \u000X dan DITUTUP dengan \u0000.
const P = {
  tebal: "\u0001", kode: "\u0002", miring: "\u0003", judul: "\u0004",
  bullet: "\u0005", blokBuka: "\u0006", akhirBhs: "\u0007",
  blokTutup: "\u000e", garis: "\u0008",
  tutup: "\u0000",
};

/** Ubah markdown ringan menjadi string ber-penanda gaya. */
export function markdown(teks) {
  let t = String(teks ?? "");

  // 1) blok kode dulu (agar isinya tidak diproses sebagai markdown inline)
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, bhs, isi) => {
    const badan = isi.replace(/\n$/, "").split("\n").map((x) => `${P.kode} ${x} ${P.tutup}`).join("\n");
    return `\n${P.blokBuka}${bhs || "kode"}${P.akhirBhs}\n${badan}\n${P.blokTutup}\n`;
  });

  t = t.replace(/`([^`\n]+)`/g, `${P.kode}$1${P.tutup}`);
  t = t
    .replace(/\*\*([^*\n]+)\*\*/g, `${P.tebal}$1${P.tutup}`)
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, `$1${P.miring}$2${P.tutup}`)
    .replace(/^#{1,6}\s+(.+)$/gm, `${P.judul}$1${P.tutup}`)
    .replace(/^(\s*)[-*]\s+/gm, `$1${P.bullet}`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${P.miring}$1${P.tutup} ($2)`)
    .replace(/^\s*([-—]{3,})\s*$/gm, P.garis);
  return t;
}

/** Ubah penanda gaya menjadi ANSI saat dicetak. */
export function terapkanGaya(baris) {
  const keluar = String(baris)
    // \u0006 hanya berisi teks biasa (bhs), diakhiri \u0007
    .replace(/\u0006([^\u0000\u0007]*)\u0007?/g, `${C.samar}${C.dim}┌─ $1 ────${C.reset}`)
    .replace(/\u0001([^\u0000]*)\u0000?/g, `${C.bold}$1${C.reset}`)
    .replace(/\u0002([^\u0000]*)\u0000?/g, `${C.kode}$1${C.reset}`)
    .replace(/\u0003([^\u0000]*)\u0000?/g, `${C.italic}$1${C.reset}`)
    .replace(/\u0004([^\u0000]*)\u0000?/g, `${C.bold}${C.emas}$1${C.reset}`)
    .replace(/\u0005/g, `${C.aksen}▸${C.reset} `)
    .replace(/\u000e/g, `${C.samar}${C.dim}└────${C.reset}`)
    .replace(/\u0008/g, `${C.samar}${"─".repeat(30)}${C.reset}`)
    .replace(/\u0000/g, "");
  return tanpaWarna(keluar);
}

// ---------- Badge & border ----------
/** Badge kecil berwarna latar, mis. [agent] [tool]. */
export function badge(teks, warna = C.aksen, bg = C.bgPanel) {
  return `${bg}${warna}${C.bold} ${teks} ${C.reset}`;
}

/**
 * Kotak berjudul dengan sudut membulat (untuk panel/menu).
 * Lebar DIHITUNG dari isi terlebar supaya border selalu rapi; isi yang
 * kepanjangan dibungkus otomatis. Judul dipasang di baris pertama.
 * @param {string} judul
 * @param {string[]} barisIsi
 * @param {{lebar?:number,warna?:string}} [opts]
 */
export function kotak(judul, barisIsi, opts = {}) {
  const warnaJudul = opts.warna || C.ungu;
  // -3 = border "│ " (2) + 1 spasi padding kanan supaya teks tidak menempel tepi.
  const maksIsi = Math.max(20, (opts.lebar || lebar()) - 3);

  // Bungkus tiap baris isi bila melebihi lebar maksimum.
  // Baris lanjutan diberi indentasi gantung agar tetap sejajar bila baris
  // dimulai penanda seperti "•", "-", atau nomor.
  const isi = [];
  for (const b of barisIsi) {
    if (b === null || b === undefined) continue;
    const polos = tanpaWarna(b);
    const cocok = /^(\s*(?:[•·▪◦\-*]\s+|\d+[.)]\s+))/.exec(polos);
    const gantung = cocok ? lebarTeks(cocok[1]) : 0;
    const potong = bungkus(b, maksIsi, gantung);
    for (const p of potong) isi.push(p);
  }

  // Lebar dalam = max(judul, isi terlebar), minimal 24.
  const lebarDalam = Math.max(
    24,
    lebarTeks(judul || "") + 1,
    ...isi.map((b) => lebarTeks(b) + 1)
  );

  const isiBaris = (b = "") => {
    const pad = " ".repeat(Math.max(0, lebarDalam - 1 - lebarTeks(b)));
    return `${C.samar}│${C.reset} ${b}${pad}`;
  };
  const garisAtas = `${C.samar}╭─${C.reset} ${warnaJudul}${C.bold}${judul || ""}${C.reset} ${C.samar}${"─".repeat(Math.max(0, lebarDalam - lebarTeks(judul || "") - 3))}╮${C.reset}`;
  const garisBawah = `${C.samar}╰${"─".repeat(lebarDalam + 1)}╯${C.reset}`;

  const out = [""];
  out.push(garisAtas);
  for (const b of isi) out.push(isiBaris(b));
  out.push(garisBawah);
  return out;
}

// ---------- Bubble chat ----------
/** Ikon + nama per peran. */
const PERAN = {
  user:   { ikon: "❯", nama: "Anda",  warna: () => C.aksen2 },
  agent:  { ikon: "◆", nama: "Agent", warna: () => C.aksen },
  tool:   { ikon: "⚙", nama: "tool",  warna: () => C.jingga },
  info:   { ikon: "i", nama: "info",  warna: () => C.aksen },
  sukses: { ikon: "✓", nama: "ok",    warna: () => C.aksen2 },
  error:  { ikon: "✗", nama: "error", warna: () => C.merah },
};

export function bubble(peran, isi) {
  const W = lebar();
  const cetak = (s) => process.stdout.write(tanpaWarna(s) + "\n");
  const p = PERAN[peran];
  const warna = p ? p.warna() : "";

  if (!p) { cetak(String(isi)); return; }

  // Untuk tool: tampilkan judul + status (✓/✗) di header bubble.
  let judulTool = "";
  if (peran === "tool" && isi && typeof isi === "object") {
    const ok = isi.ok !== false;
    const tanda = ok ? `${C.aksen2}✓${C.reset}` : `${C.merah}✗${C.reset}`;
    judulTool = ` ${tanda} ${C.bold}${C.jingga}${isi.judul || "tool"}${C.reset}`;
  }

  // header bubble: [jam] ikon nama ─────
  const kepala = `${jamSekarang()} ${warna}${C.bold}${p.ikon} ${p.nama}${C.reset}${judulTool}`;
  cetak("\n" + kepala);

  const teks = peran === "agent" ? markdown(isi) : String(isi?.detail ?? isi);
  const baris = bungkus(teks, W - 3);
  const aksen = `${warna}▏${C.reset}`;

  baris.forEach((b) => {
    const isi2 = peran === "agent" ? terapkanGaya(b) : peran === "tool" ? `${C.samar}${b}${C.reset}` : b;
    cetak(`${aksen} ${isi2}`);
  });
}

// ---------- Spinner ----------
/** Spinner elegan dengan durasi; hanya aktif bila TTY. */
export function mulaiMengetik(teks = "Agent sedang mengetik") {
  const chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const tty = process.stdout.isTTY === true;
  let i = 0;
  const mulai = Date.now();
  let iv = null;

  if (tty) {
    process.stdout.write("\n");
    iv = setInterval(() => {
      const detik = ((Date.now() - mulai) / 1000).toFixed(0);
      process.stdout.write(`\r${C.aksen}${chars[i]}${C.reset} ${C.dim}${teks}… ${detik}s${C.reset}\x1b[K`);
      i = (i + 1) % chars.length;
    }, 120);
  }

  return () => {
    if (iv) {
      clearInterval(iv);
      iv = null;
      process.stdout.write("\r\x1b[K");
    }
  };
}

/**
 * Potong teks untuk DITAMPILKAN di terminal (bukan untuk dikirim ke model).
 * Pesan penutup ditulis tanpa ANSI agar tidak merusak pembungkusan baris.
 */
export function singkat(teks, maks) {
  const t = String(teks ?? "");
  if (t.length <= maks) return t;
  return `${t.slice(0, maks)}\n… (dipotong di layar; AI menerima ${t.length} karakter penuh)`;
}

export function tulis(el = "") {
  process.stdout.write(tanpaWarna(el) + "\n");
}

/** Apakah warna aktif? Berguna untuk komponen yang ingin menyesuaikan. */
export function warnaAktif() {
  return PAKAI_WARNA;
}
