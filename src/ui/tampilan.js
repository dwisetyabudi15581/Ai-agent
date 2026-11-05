// ============ UI: MARKDOWN STREAM, PANEL, MENU PILIH MODEL ============
import { C, lebar, markdown, bungkus, terapkanGaya, tulis, kotak, badge } from "./util.js";
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
      process.stdout.write(`\n${C.aksen}${C.bold}◆ Agent${C.reset} ${C.samar}${C.dim}▸${C.reset}\n`);
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
    const lebarMaks = lebar() - 3;
    for (const bagian of bungkus(markdown(b), lebarMaks)) {
      process.stdout.write(`\r\x1b[K${C.aksen}▏${C.reset} ${terapkanGaya(bagian)}\n`);
    }
  }
  akhiri() {
    if (this.baris.length) this.cetakBaris(this.baris);
    this.baris = "";
  }
}

function garis(karakter = "─", warna = C.samar) {
  return `${warna}${karakter.repeat(lebar())}${C.reset}`;
}

/** Panel berjudul dengan kotak sudut membulat. */
export function panel(judul, barisIsi, opts = {}) {
  const isi = barisIsi.filter((b) => b !== null && b !== undefined);
  for (const l of kotak(judul, isi, opts)) tulis(l);
}

/** Satu baris daftar model (nama · id · vendor · multiplier · kapabilitas). */
function barisModel(m, i, modelAktif) {
  const aktifTanda = m.id === modelAktif ? `${C.aksen2}●${C.reset}` : " ";
  const nonaktif = m.aktif === false;
  const nama = (m.nama || m.id).slice(0, 24).padEnd(24);
  const id = m.id.slice(0, 24).padEnd(24);
  const vendor = String(m.vendor || "?").slice(0, 9).padEnd(9);
  const mult = m.multiplier != null ? `${m.multiplier}x` : "?";
  const kap = kapabilitasTampil(m).join(",");
  const badan = `${nama} ${C.samar}${id}${C.reset} ${vendor} ${C.emas}×${mult.padStart(4)}${C.reset} ${C.samar}${kap}${m.vision ? " 👁" : ""}${C.reset}`;
  return ` ${aktifTanda} ${C.samar}${String(i + 1).padStart(2," ")}${C.reset}  ${nonaktif ? `${C.samar}${C.dim}${badan}${C.reset} ✗` : badan}`;
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
    ? `${info.jumlahAktif} aktif / ${info.jumlahTotal} total`
    : `${katalog.length} model`;
  while (true) {
    tulis("");
    tulis(`${C.ungu}${C.bold}  Pilih Model${C.reset} ${C.samar}(${judulJumlah})${C.reset}`);
    tulis(garis());
    katalog.forEach((m, i) => tulis(barisModel(m, i, modelAktif)));
    tulis(garis());
    tulis(` ${C.samar}nomor = pilih · kata kunci = filter · kosong = batal${daftar.some((m) => m.aktif === false) ? " · ✗ = nonaktif" : ""}${C.reset}`);

    const jawab = (await tanyaTeks(`\n${C.aksen}${C.bold}  › ${C.reset}`) ?? "").trim();
    if (!jawab) return null;

    if (/^\d+$/.test(jawab)) {
      const m = katalog[Number(jawab) - 1];
      if (!m) { tulis(`${C.merah}  Nomor tidak ada.${C.reset}`); continue; }
      if (m.aktif === false) {
        tulis(`${C.merah}  "${m.id}" sedang nonaktif di gateway — tidak bisa dipilih.${C.reset}`);
        continue;
      }
      return m;
    }

    const cocok = daftar.filter((m) =>
      (m.id + " " + m.nama + " " + m.vendor + " " + kapabilitasTampil(m).join(" ")).toLowerCase().includes(jawab.toLowerCase())
    );
    if (!cocok.length) tulis(`${C.merah}  Tidak ada model cocok dengan "${jawab}".${C.reset}`);
    else if (cocok.length === 1) {
      if (cocok[0].aktif === false) {
        tulis(`${C.merah}  "${cocok[0].id}" sedang nonaktif di gateway — tidak bisa dipilih.${C.reset}`);
        continue;
      }
      return cocok[0];
    }
    else katalog = cocok;
  }
}
