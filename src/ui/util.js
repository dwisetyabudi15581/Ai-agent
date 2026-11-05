// ============ UI UTIL: WARNA, LAYAR, BUBBLE, HELPER ============
// Warna dimatikan otomatis bila bukan TTY atau user set NO_COLOR.

// ---------- Palet ANSI ----------
export const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  magenta: "\x1b[35m", red: "\x1b[31m", gray: "\x1b[90m",
  bgCyan: "\x1b[46m", bgBlue: "\x1b[44m",
  // teks eksplisit untuk blok kode (agar ANSI tidak terpotong saat streaming)
  kode: "\x1b[38;5;250m\x1b[48;5;238m",
  tebal: "\x1b[1m",
};

// Warna hanya aktif bila TTY sungguhan (isTTY === true).
// Bug lama: `isTTY !== false` bernilai true saat isTTY `undefined` (pipe/redirect),
// sehingga kode ANSI bocor ke log/file.
const PAKAI_WARNA = !process.env.NO_COLOR && process.stdout.isTTY === true;

/** Hapus seluruh kode ANSI bila warna dimatikan. */
export function tanpaWarna(teks) {
  if (PAKAI_WARNA) return String(teks);
  return String(teks).replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------- Waktu ----------
export function waktu() {
  return new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function jamSekarang() {
  return `${C.gray}[${waktu()}]${C.reset}`;
}

// ---------- Lebar & pembungkusan ----------
const ANSI = /\x1b\[[0-9;]*m/g;

/** Lebar visual teks (ANSI diabaikan, emoji/wide char dihitung 2). */
export function lebarTeks(s) {
  let total = 0;
  for (const ch of String(s).replace(ANSI, "")) {
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
export function bungkus(teks, lebarMaks) {
  const hasil = [];
  for (const barisAsli of String(teks ?? "").split("\n")) {
    if (lebarTeks(barisAsli) <= lebarMaks) { hasil.push(barisAsli); continue; }
    let sisa = barisAsli;
    while (lebarTeks(sisa) > lebarMaks) {
      let potong = sisa.lastIndexOf(" ", lebarMaks);
      if (potong <= 0) potong = lebarMaks;
      hasil.push(sisa.slice(0, potong));
      sisa = sisa.slice(potong).trimStart();
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
  bullet: "\u0005", blokBuka: "\u0006", blokTutup: "\u0007", garis: "\u0008",
  tutup: "\u0000",
};

/** Ubah markdown ringan menjadi string ber-penanda gaya. */
export function markdown(teks) {
  let t = String(teks ?? "");

  // 1) blok kode dulu (agar isinya tidak diproses sebagai markdown inline)
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, bhs, isi) => {
    const badan = isi.replace(/\n$/, "").split("\n").map((x) => `${P.kode} ${x} ${P.tutup}`).join("\n");
    return `\n${P.blokBuka}${bhs || "kode"}${P.blokTutup}\n${badan}\n`;
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
    // \u0006 hanya berisi teks biasa (bhs), jadi tangkap sampai penutup berikutnya
    .replace(/\u0006([^\u0000\u0007]*)\u0007?/g, `${C.gray}${C.dim}┌─ $1 ─${C.reset}`)
    .replace(/\u0001([^\u0000]*)\u0000?/g, `${C.bold}$1${C.reset}`)
    .replace(/\u0002([^\u0000]*)\u0000?/g, `${C.kode}$1${C.reset}`)
    .replace(/\u0003([^\u0000]*)\u0000?/g, `${C.italic}$1${C.reset}`)
    .replace(/\u0004([^\u0000]*)\u0000?/g, `${C.bold}${C.magenta}$1${C.reset}`)
    .replace(/\u0005/g, `${C.cyan}•${C.reset} `)
    .replace(/\u0007/g, `${C.gray}${C.dim}└─${C.reset}`)
    .replace(/\u0008/g, `${C.gray}${"─".repeat(28)}${C.reset}`)
    .replace(/\u0000/g, "");
  return tanpaWarna(keluar);
}

// ---------- Bubble chat ----------
export function bubble(peran, isi) {
  const W = lebar();
  const cetak = (s) => process.stdout.write(tanpaWarna(s) + "\n");

  switch (peran) {
    case "user": {
      const baris = bungkus(isi, W - 4);
      cetak(`\n${jamSekarang()} ${C.bold}${C.green}👤 Anda${C.reset}`);
      cetak(`${C.green}┃${C.reset} ${C.bold}${baris[0]}${C.reset}`);
      for (const b of baris.slice(1)) cetak(`${C.green}┃${C.reset} ${b}`);
      break;
    }
    case "agent": {
      const baris = bungkus(markdown(isi), W - 4);
      cetak(`\n${jamSekarang()} ${C.bold}${C.cyan}🤖 Agent${C.reset}`);
      cetak(`${C.cyan}┃${C.reset} ${terapkanGaya(baris[0])}`);
      for (const b of baris.slice(1)) cetak(`${C.cyan}┃${C.reset} ${terapkanGaya(b)}`);
      break;
    }
    case "tool": {
      cetak(`\n${jamSekarang()} ${C.bold}${C.yellow}⚙️  ${isi.judul}${C.reset}`);
      for (const b of bungkus(isi.detail ?? "", W - 4)) cetak(`${C.yellow}┃${C.reset} ${C.gray}${b}${C.reset}`);
      break;
    }
    // Info/sukses dibungkus seperti bubble lain agar tidak terpotong di
    // terminal sempit.
    case "info": {
      const baris = bungkus(isi, W - 4);
      cetak(`\n${jamSekarang()} ${C.blue}ℹ️  ${baris[0]}${C.reset}`);
      for (const b of baris.slice(1)) cetak(`${C.blue}┃${C.reset} ${b}`);
      break;
    }
    case "sukses": {
      const baris = bungkus(isi, W - 4);
      cetak(`\n${jamSekarang()} ${C.green}✓ ${baris[0]}${C.reset}`);
      for (const b of baris.slice(1)) cetak(`${C.green}┃${C.reset} ${b}`);
      break;
    }
    case "error":
      cetak(`\n${jamSekarang()} ${C.bold}${C.red}❌ Kesalahan${C.reset}`);
      for (const b of bungkus(isi, W - 4)) cetak(`${C.red}┃${C.reset} ${b}`);
      break;
    default:
      cetak(String(isi));
  }
}

// ---------- Spinner ----------
/** Spinner hanya aktif bila TTY (hemat CPU & tidak membanjiri log pipe). */
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
      process.stdout.write(`\r${C.cyan}${chars[i]}${C.reset} ${C.dim}${teks}... ${detik}s${C.reset}\x1b[K`);
      i = (i + 1) % chars.length;
    }, 150);
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
