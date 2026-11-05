// ============ UI: MARKDOWN STREAM, PANEL, MENU PILIH MODEL ============
import { C, lebar, markdown, bungkus, terapkanGaya, tulis } from "./util.js";
import { tanyaTeks } from "./input.js";
import { kapabilitasTampil } from "../api/katalog.js";

// Menulis teks markdown baris-per-baris saat streaming
export class PenulisStream {
  constructor() {
    this.baris = "";
    this.sudahHeader = false;
  }
  tulis(keping) {
    if (!this.sudahHeader) {
      process.stdout.write(`\n${C.cyan}┃${C.reset} `);
      this.sudahHeader = true;
    }
    this.baris += keping;
    let idx;
    while ((idx = this.baris.indexOf("\n")) !== -1) {
      const b = this.baris.slice(0, idx);
      this.baris = this.baris.slice(idx + 1);
      this.cetakBaris(b);
    }
  }
  cetakBaris(b) {
    const lebarMaks = lebar() - 4;
    for (const bagian of bungkus(markdown(b), lebarMaks)) {
      process.stdout.write(`\r\x1b[K${C.cyan}┃${C.reset} ${terapkanGaya(bagian)}\n`);
    }
  }
  akhiri() {
    if (this.baris.length) this.cetakBaris(this.baris);
    this.baris = "";
  }
}

function garis(karakter = "─", warna = C.gray) {
  return `${warna}${karakter.repeat(lebar() + 2)}${C.reset}`;
}

export function panel(judul, barisIsi) {
  const isi = barisIsi.filter((b) => b !== null && b !== undefined);
  tulis("");
  tulis(`${C.cyan}${C.bold} ${judul}${C.reset}`);
  tulis(garis());
  for (const b of isi) tulis(` ${b}`);
  tulis(garis());
}

/** Satu baris daftar model (nama · id · vendor · multiplier · kapabilitas). */
function barisModel(m, i, modelAktif) {
  const aktifTanda = m.id === modelAktif ? `${C.green}●${C.reset}` : " ";
  const nonaktif = m.aktif === false;
  const nama = (m.nama || m.id).slice(0, 26).padEnd(26);
  const id = m.id.slice(0, 26).padEnd(26);
  const vendor = String(m.vendor || "?").slice(0, 9).padEnd(9);
  const mult = m.multiplier != null ? `${m.multiplier}x` : "?";
  const kap = kapabilitasTampil(m).join(",");
  const badan = `${nama} ${C.gray}${id}${C.reset} ${vendor} mult ${mult.padStart(5)} ${kap}${m.vision ? " 👁" : ""}`;
  return ` ${aktifTanda} ${String(i + 1).padStart(2)}) ${nonaktif ? `${C.gray}${C.dim}${badan}${C.reset} ✗` : badan}`;
}

/**
 * Menu pilih model interaktif (memakai antrean input global).
 * Daftar bisa berisi model nonaktif (mode "semua") — memilihnya ditolak
 * dengan pesan supaya user tahu kenapa.
 * @param {Array}  daftar       katalog (aktif saja, atau lengkap)
 * @param {string} modelAktif   id model yang sedang dipakai
 * @param {object} [info]       {jumlahAktif, jumlahTotal} untuk header
 */
export async function pilihModel(daftar, modelAktif, info = {}) {
  let katalog = daftar;
  const judulJumlah = info.jumlahTotal
    ? `${info.jumlahAktif} aktif dari ${info.jumlahTotal} model`
    : `${katalog.length} model`;
  while (true) {
    tulis("");
    tulis(`${C.bold}${C.cyan} PILIH MODEL${C.reset} ${C.gray}(${judulJumlah})${C.reset}`);
    tulis(garis());
    katalog.forEach((m, i) => tulis(barisModel(m, i, modelAktif)));
    tulis(garis());
    tulis(` ${C.gray}nomor = pilih · kata kunci = filter · kosong = batal${daftar.some((m) => m.aktif === false) ? " · ✗ = nonaktif (tidak bisa dipilih)" : ""}${C.reset}`);

    const jawab = (await tanyaTeks(`\n${C.bold}${C.cyan}›${C.reset} `) ?? "").trim();
    if (!jawab) return null;

    if (/^\d+$/.test(jawab)) {
      const m = katalog[Number(jawab) - 1];
      if (!m) { tulis(`${C.red}Nomor tidak ada.${C.reset}`); continue; }
      if (m.aktif === false) {
        tulis(`${C.red}"${m.id}" sedang nonaktif di gateway — tidak bisa dipilih.${C.reset}`);
        continue;
      }
      return m;
    }

    const cocok = daftar.filter((m) =>
      (m.id + " " + m.nama + " " + m.vendor + " " + kapabilitasTampil(m).join(" ")).toLowerCase().includes(jawab.toLowerCase())
    );
    if (!cocok.length) tulis(`${C.red}Tidak ada model cocok dengan "${jawab}".${C.reset}`);
    else if (cocok.length === 1) {
      if (cocok[0].aktif === false) {
        tulis(`${C.red}"${cocok[0].id}" sedang nonaktif di gateway — tidak bisa dipilih.${C.reset}`);
        continue;
      }
      return cocok[0];
    }
    else katalog = cocok;
  }
}
