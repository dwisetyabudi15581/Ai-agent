#!/data/data/com.termux/files/usr/bin/bash
# Uji ketahanan: timeout jaringan, timeout stream, argumen tool rusak.
# Versi ini MENGUKUR waktu tiap tahap agar regresi (mis. timeout melebar
# berlipat karena fallback) langsung kelihatan.
#
# PENTING: skrip ini sekarang punya PENILAIAN (LULUS/GAGAL) dan exit code.
# Sebelumnya exit code selalu 0 sehingga selalu tampak "OK" di suite.
#
# Batas waktu yang diharapkan (detikTotal=4):
#   - tahap 1 & 2 harus selesai < 8 dtk (toleransi 2x detikTotal karena
#     ada HTTP + fallback host, tapi TIDAK boleh 16 dtk seperti bug lama).
cd "$(dirname "$0")/.." || exit 1

TMP_UJI="$PWD/tmp-uji"
mkdir -p "$TMP_UJI"
OUT="$TMP_UJI/uji-ketahanan.out"
: > "$OUT"

GAGAL=0
BATAS_MS=8000

catat() { echo "$@" | tee -a "$OUT"; }

# ---------- 1. Timeout sangat pendek saat stream ----------
catat "=== 1. Timeout stream (detikTimeout=2, detikTotal=4) ==="
R1=$(node --input-type=module -e '
const cfg=await (await import("./src/config/config.js")).muatConfig();
const api=await import("./src/api/klien.js");
const t=Date.now();
try{
  const h=await api.panggilChat(cfg,[{role:"user",content:"Tulis 200 kata tentang laut."}],null,{stream:true,maxTokens:400,detikTimeout:2,detikTotal:4});
  console.log(JSON.stringify({t:Date.now()-t,ok:true,url:h.url,len:h.pesan.content.length}));
}catch(e){ console.log(JSON.stringify({t:Date.now()-t,ok:false,err:e.message.slice(0,120)})); }
' 2>&1 | tail -1)

catat "  $R1"
MS1=$(node -e 'const j=JSON.parse(process.argv[1]||"{}");console.log(j.t||0)' "$R1" 2>/dev/null)
MS1=${MS1:-0}
if [ "$MS1" -gt 0 ] && [ "$MS1" -le "$BATAS_MS" ]; then
  catat "  ✓ selesai dalam ${MS1} ms (batas ${BATAS_MS} ms)"
else
  catat "  ✗ durasi ${MS1} ms melewati batas ${BATAS_MS} ms (atau hasil tak terbaca)"
  GAGAL=1
fi

# ---------- 2. Non-stream, batas ketat ----------
catat ""
catat "=== 2. Non-stream, detikTimeout=2, detikTotal=4 (harus gagal terkontrol) ==="
R2=$(node --input-type=module -e '
const cfg=await (await import("./src/config/config.js")).muatConfig();
const api=await import("./src/api/klien.js");
const t=Date.now();
try{
  const h=await api.panggilChat(cfg,[{role:"user",content:"Tulis 200 kata tentang gunung."}],null,{stream:false,detikTimeout:2,detikTotal:4});
  console.log(JSON.stringify({t:Date.now()-t,ok:true,len:h.pesan.content.length}));
}catch(e){ console.log(JSON.stringify({t:Date.now()-t,ok:false,err:e.message.slice(0,120)})); }
' 2>&1 | tail -1)

catat "  $R2"
MS2=$(node -e 'const j=JSON.parse(process.argv[1]||"{}");console.log(j.t||0)' "$R2" 2>/dev/null)
MS2=${MS2:-0}
if [ "$MS2" -gt 0 ] && [ "$MS2" -le "$BATAS_MS" ]; then
  catat "  ✓ selesai dalam ${MS2} ms (batas ${BATAS_MS} ms)"
else
  catat "  ✗ durasi ${MS2} ms melewati batas ${BATAS_MS} ms (atau hasil tak terbaca)"
  GAGAL=1
fi

# ---------- 3. Argumen tool rusak ----------
catat ""
catat "=== 3. Argumen tool rusak (JSON invalid) + tool tak dikenal ==="
R3=$(node --input-type=module -e '
const {buatEksekutor}=await import("./src/tools/tools.js");
const eksek=buatEksekutor({},{cwd:process.cwd()});
const r=await eksek({function:{name:"baca_file",arguments:"{rusak"}});
const r2=await eksek({function:{name:"tool_hantu",arguments:"{}"}});
console.log(JSON.stringify({ok1:r.ok,raw1:r.raw,ok2:r2.ok,raw2:r2.raw}));
' 2>&1 | tail -1)

catat "  $R3"
if echo "$R3" | grep -q '"ok1":false' && echo "$R3" | grep -q '"ok2":false'; then
  catat "  ✓ kedua input rusak ditolak rapi (tidak crash)"
else
  catat "  ✗ input rusak tidak ditolak sebagaimana mestinya"
  GAGAL=1
fi

# ---------- Kesimpulan ----------
catat ""
if [ "$GAGAL" -eq 0 ]; then
  catat "LULUS ✓  (total ${MS1}+${MS2} ms, batas ${BATAS_MS} ms per tahap)"
  catat "  log lengkap: $OUT"
  exit 0
else
  catat "GAGAL ✗  (lihat rincian di atas)"
  exit 1
fi
