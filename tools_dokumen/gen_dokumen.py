#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generator Dokumen v2 — PDF & PPT dari satu file konten bertanda (Markdown ringan).

Pemakaian:
    python3 gen_dokumen.py konten.md --pdf out.pdf --ppt out.pptx
    python3 gen_dokumen.py konten.md --pdf out.pdf          # PDF saja
    python3 gen_dokumen.py konten.md --ppt out.pptx          # PPT saja
    python3 gen_dokumen.py konten.md --tema biru             # pilih tema warna

Format konten (.md) yang didukung — sintaks sederhana:
    # Judul Besar              -> H1 (judul dokumen / slide judul)
    ## Judul Seksi             -> H2 (slide baru di PPT / heading di PDF)
    ### Subjudul               -> H3
    - poin bullet              -> daftar tak bernomor
    1. poin                    -> daftar bernomor
    > kutipan                  -> paragraf kutipan (italic)
    | a | b |                  -> tabel (baris pertama = header)
    ![gambar](path.png)        -> gambar
    ---                        -> pemisah / slide baru
    teks biasa                 -> paragraf
    **tebal** dan *miring*     -> format inline
"""

import sys
import os
import re
import argparse

# ---------- Palet tema ----------
TEMA = {
    "biru":    {"utama": "#2d6cdf", "aksen": "#1b3f8b", "teks": "#1a1a1a"},
    "hijau":   {"utama": "#1f9e5a", "aksen": "#12663a", "teks": "#14261c"},
    "merah":   {"utama": "#d63b3b", "aksen": "#8f2020", "teks": "#2a1414"},
    "ungu":    {"utama": "#7a4fd6", "aksen": "#4a2a91", "teks": "#201633"},
    "gelap":   {"utama": "#2b2f36", "aksen": "#4c525c", "teks": "#f2f2f2"},
    "oranye":  {"utama": "#e07a1f", "aksen": "#93500f", "teks": "#24170a"},
}


# ================= PARSER KONTEN =================

class Blok:
    """Satu blok konten hasil parsing."""
    def __init__(self, tipe, level=0, teks="", data=None):
        self.tipe = tipe          # h1,h2,h3,p,bullet,numbered,quote,table,img,hr
        self.level = level
        self.teks = teks
        self.data = data or []


def parse_konten(teks):
    """Ubah teks markdown ringan menjadi daftar Blok."""
    baris = teks.splitlines()
    blok = []
    i = 0
    while i < len(baris):
        b = baris[i].rstrip()
        s = b.strip()

        if not s:
            i += 1
            continue

        # Judul
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            blok.append(Blok(f"h{lvl}", level=lvl, teks=m.group(2).strip()))
            i += 1
            continue

        # Pemisah
        if re.match(r"^-{3,}$", s) or re.match(r"^\*{3,}$", s):
            blok.append(Blok("hr"))
            i += 1
            continue

        # Gambar
        m = re.match(r"^!\[(.*?)\]\((.*?)\)$", s)
        if m:
            blok.append(Blok("img", teks=m.group(1), data=[m.group(2)]))
            i += 1
            continue

        # Tabel
        if s.startswith("|") and s.endswith("|"):
            rows = []
            while i < len(baris) and baris[i].strip().startswith("|"):
                raw = baris[i].strip().strip("|")
                sel = [c.strip() for c in raw.split("|")]
                # baris pemisah markdown |---|---|
                if not all(re.match(r"^:?-{2,}:?$", c) for c in sel if c):
                    rows.append(sel)
                i += 1
            blok.append(Blok("table", data=rows))
            continue

        # Bullet
        if re.match(r"^[-*+]\s+", s):
            blok.append(Blok("bullet", teks=re.sub(r"^[-*+]\s+", "", s)))
            i += 1
            continue

        # Bernomor
        m = re.match(r"^\d+[.)]\s+(.*)$", s)
        if m:
            blok.append(Blok("numbered", teks=m.group(1)))
            i += 1
            continue

        # Kutipan
        if s.startswith(">"):
            blok.append(Blok("quote", teks=s.lstrip("> ").strip()))
            i += 1
            continue

        # Paragraf biasa (gabung baris berlanjut)
        par = [s]
        i += 1
        while i < len(baris):
            nx = baris[i].strip()
            if (not nx or nx.startswith(("#", "-", "*", "+", ">", "|", "!"))
                    or re.match(r"^\d+[.)]\s", nx) or re.match(r"^-{3,}$", nx)):
                break
            par.append(nx)
            i += 1
        blok.append(Blok("p", teks=" ".join(par)))
    return blok


# ================= FORMAT INLINE =================

def ke_html_inline(teks):
    """**tebal** -> <b>, *miring* -> <i>, `kode` -> <font face=Courier>."""
    teks = teks.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    teks = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", teks)
    teks = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", teks)
    teks = re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', teks)
    return teks


# ================= PDF =================

def bikin_pdf(blok, path, tema="biru"):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                    Table, TableStyle, Image, HRFlowable,
                                    KeepTogether)
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT

    w = TEMA.get(tema, TEMA["biru"])
    C_UTAMA = colors.HexColor(w["utama"])
    C_AKSEN = colors.HexColor(w["aksen"])

    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
        title=os.path.basename(path), author="Generator Dokumen AI")

    st = getSampleStyleSheet()
    st.add(ParagraphStyle("H1c", parent=st["Title"], textColor=C_AKSEN,
                          fontSize=26, leading=30, alignment=TA_LEFT,
                          spaceAfter=14))
    st.add(ParagraphStyle("H2c", parent=st["Heading1"], textColor=C_UTAMA,
                          fontSize=18, leading=22, spaceBefore=14, spaceAfter=8))
    st.add(ParagraphStyle("H3c", parent=st["Heading2"], textColor=C_AKSEN,
                          fontSize=14, leading=18, spaceBefore=10, spaceAfter=6))
    st.add(ParagraphStyle("Pc", parent=st["BodyText"], textColor=colors.HexColor(w["teks"]),
                          fontSize=11, leading=16, spaceAfter=8))
    st.add(ParagraphStyle("Bulc", parent=st["BodyText"], leftIndent=16,
                          bulletIndent=6, spaceAfter=4, fontSize=11, leading=15))
    st.add(ParagraphStyle("Numc", parent=st["BodyText"], leftIndent=16,
                          bulletIndent=6, spaceAfter=4, fontSize=11, leading=15))
    st.add(ParagraphStyle("Quote", parent=st["BodyText"], leftIndent=14,
                          textColor=C_UTAMA, fontName="Helvetica-Oblique",
                          fontSize=11, leading=15, spaceAfter=8,
                          borderPadding=4))

    alir = []
    for blk in blok:
        t = blk.tipe
        if t == "h1":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["H1c"]))
        elif t == "h2":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["H2c"]))
        elif t == "h3":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["H3c"]))
        elif t == "h4":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["H3c"]))
        elif t == "p":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["Pc"]))
        elif t == "bullet":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["Bulc"],
                                  bulletText="\u2022"))
        elif t == "numbered":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["Numc"]))
        elif t == "quote":
            alir.append(Paragraph(ke_html_inline(blk.teks), st["Quote"]))
        elif t == "hr":
            alir.append(Spacer(1, 0.2*cm))
            alir.append(HRFlowable(width="100%", thickness=1, color=C_UTAMA))
            alir.append(Spacer(1, 0.4*cm))
        elif t == "img":
            jalur = os.path.expanduser(blk.data[0])
            if os.path.exists(jalur):
                try:
                    img = Image(jalur)
                    maxw = 16*cm
                    if img.drawWidth > maxw:
                        ratio = maxw / img.drawWidth
                        img.drawWidth = maxw
                        img.drawHeight *= ratio
                    img.hAlign = "LEFT"
                    alir.append(Spacer(1, 0.2*cm))
                    alir.append(img)
                    alir.append(Spacer(1, 0.4*cm))
                except Exception as e:
                    alir.append(Paragraph(f"[gambar gagal: {e}]", st["Pc"]))
            else:
                alir.append(Paragraph(f"[gambar tidak ada: {jalur}]", st["Pc"]))
        elif t == "table" and blk.data:
            rows = [[Paragraph(ke_html_inline(c), st["Pc"]) for c in r]
                    for r in blk.data]
            t_ = Table(rows, hAlign="LEFT")
            gaya = [
                ("BACKGROUND", (0, 0), (-1, 0), C_UTAMA),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbbbbb")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
            for r in range(1, len(rows)):
                if r % 2 == 0:
                    gaya.append(("BACKGROUND", (0, r), (-1, r),
                                 colors.HexColor("#eef3fb")))
            t_.setStyle(TableStyle(gaya))
            alir.append(Spacer(1, 0.15*cm))
            alir.append(t_)
            alir.append(Spacer(1, 0.4*cm))

    doc.build(alir)
    return path


# ================= PPT =================

def bikin_ppt(blok, path, tema="biru"):
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN

    w = TEMA.get(tema, TEMA["biru"])
    C_UTAMA = RGBColor.from_string(w["utama"].lstrip("#"))
    C_AKSEN = RGBColor.from_string(w["aksen"].lstrip("#"))
    C_TEKS = RGBColor.from_string(w["teks"].lstrip("#"))

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    def slide_baru():
        return prs.slides.add_slide(blank)

    def tambah_kotak(slide, l, t, ww, hh, teks, size=18, warna=C_TEKS,
                     bold=False, align=PP_ALIGN.LEFT, italic=False):
        tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(ww), Inches(hh))
        tf = tb.text_frame
        tf.word_wrap = True
        lines = teks.split("\n")
        for idx, ln in enumerate(lines):
            p = tf.paragraphs[0] if idx == 0 else tf.add_paragraph()
            p.alignment = align
            # format inline sederhana: **tebal**
            seg = re.split(r"(\*\*.+?\*\*)", ln)
            for s in seg:
                if not s:
                    continue
                run = p.add_run()
                if s.startswith("**") and s.endswith("**"):
                    run.text = s[2:-2]
                    run.font.bold = True
                else:
                    run.text = s
                run.font.size = Pt(size)
                run.font.color.rgb = warna
                run.font.italic = italic
                run.font.bold = bold or run.font.bold
        return tb

    def banner(slide):
        # pita aksen di atas
        from pptx.enum.shapes import MSO_SHAPE
        sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0,
                                    prs.slide_width, Emu(0))
        sh.height = Emu(int(Inches(0.35)))
        sh.fill.solid()
        sh.fill.fore_color.rgb = C_UTAMA
        sh.line.fill.background()

    # Kelompokkan blok menjadi beberapa slide.
    # h1 + (sampai h2 berikutnya) -> slide judul + bagian.
    slides = []           # list of dict: {judul, subs, isi}
    judul_dok = "Dokumen"
    cur = None
    for blk in blok:
        if blk.tipe == "h1" and cur is None:
            judul_dok = blk.teks
            continue
        if blk.tipe == "h2" or (blk.tipe == "h1" and cur is not None):
            cur = {"judul": blk.teks, "isi": []}
            slides.append(cur)
            continue
        if cur is None:
            # konten sebelum h2 -> buat slide default
            cur = {"judul": judul_dok, "isi": []}
            slides.append(cur)
        cur["isi"].append(blk)

    # ---- Slide judul ----
    s0 = slide_baru()
    banner(s0)
    tambah_kotak(s0, 0.8, 2.4, 11.7, 1.6, judul_dok, size=40,
                 warna=C_AKSEN, bold=True, align=PP_ALIGN.CENTER)
    tambah_kotak(s0, 0.8, 4.1, 11.7, 0.8,
                 "Dibuat otomatis dengan Generator Dokumen AI", size=16,
                 warna=C_UTAMA, align=PP_ALIGN.CENTER, italic=True)

    # ---- Slide isi ----
    if not slides:
        slides.append({"judul": judul_dok, "isi": []})
    for sl in slides:
        s = slide_baru()
        banner(s)
        tambah_kotak(s, 0.7, 0.6, 12, 0.9, sl["judul"], size=28,
                     warna=C_AKSEN, bold=True)
        # susun isi ke kotak body, tiap blok satu paragraf
        body_top = 1.75
        y = body_top
        for blk in sl["isi"]:
            if y > 6.7:
                break
            if blk.tipe == "bullet":
                tambah_kotak(s, 0.9, y, 11.8, 0.5, "\u2022 " + blk.teks,
                             size=18, warna=C_TEKS)
                y += 0.55
            elif blk.tipe == "numbered":
                tambah_kotak(s, 0.9, y, 11.8, 0.5, blk.teks, size=18)
                y += 0.55
            elif blk.tipe == "p":
                tambah_kotak(s, 0.9, y, 11.8, 0.7, blk.teks, size=18)
                y += 0.75
            elif blk.tipe == "quote":
                tambah_kotak(s, 1.0, y, 11.4, 0.6, "\u201c" + blk.teks + "\u201d",
                             size=17, warna=C_UTAMA, italic=True)
                y += 0.7
            elif blk.tipe == "h3":
                tambah_kotak(s, 0.9, y, 11.8, 0.5, blk.teks, size=19,
                             warna=C_AKSEN, bold=True)
                y += 0.6
            elif blk.tipe == "hr":
                y += 0.2
            elif blk.tipe == "img":
                jalur = os.path.expanduser(blk.data[0])
                if os.path.exists(jalur):
                    try:
                        pic = s.shapes.add_picture(
                            jalur, Inches(4.4), Inches(y),
                            height=Inches(1.6))
                        y += 1.75
                    except Exception:
                        pass
            elif blk.tipe == "table" and blk.data:
                nrow = min(len(blk.data), 8)
                ncol = max(len(r) for r in blk.data)
                gf = s.shapes.add_table(
                    nrow, ncol, Inches(0.9), Inches(y),
                    Inches(11.6), Inches(min(0.4 * nrow, 3.2)))
                tabel = gf.table
                for ri in range(nrow):
                    for ci in range(ncol):
                        val = blk.data[ri][ci] if ci < len(blk.data[ri]) else ""
                        cell = tabel.cell(ri, ci)
                        cell.text = val
                        for par in cell.text_frame.paragraphs:
                            for run in par.runs:
                                run.font.size = Pt(13)
                y += min(0.4 * nrow, 3.2) + 0.3

    prs.save(path)
    return path


# ================= CLI =================

def main():
    ap = argparse.ArgumentParser(description="Generator Dokumen v2 (PDF & PPT)")
    ap.add_argument("konten", help="file .md konten")
    ap.add_argument("--pdf", help="output PDF")
    ap.add_argument("--ppt", help="output PPTX")
    ap.add_argument("--tema", default="biru",
                    choices=list(TEMA.keys()), help="tema warna")
    args = ap.parse_args()

    if not args.pdf and not args.ppt:
        print("error: tentukan minimal --pdf atau --ppt"); sys.exit(1)

    with open(os.path.expanduser(args.konten), encoding="utf-8") as f:
        teks = f.read()
    blok = parse_konten(teks)
    print(f"konten: {len(blok)} blok "
          f"({sum(1 for b in blok if b.tipe=='h2')} seksi, tema={args.tema})")

    if args.pdf:
        bikin_pdf(blok, os.path.expanduser(args.pdf), args.tema)
        print("PDF  ->", args.pdf)
    if args.ppt:
        bikin_ppt(blok, os.path.expanduser(args.ppt), args.tema)
        print("PPT  ->", args.ppt)


if __name__ == "__main__":
    main()
