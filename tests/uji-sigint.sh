#!/data/data/com.termux/files/usr/bin/bash
# Uji: Ctrl+C (SIGINT) saat model sedang menjawab TIDAK boleh menghilangkan sesi.
# Caranya: jalankan index.js non-interaktif (pipe), kirim satu pesan, tunggu
# proses sibuk, kirim SIGINT, lalu periksa berkas sesi di DIR_SESI.
#
# Perubahan: output sekarang ditulis ke tmp-uji/ (bukan menumpuk di folder
# proyek), dan skrip punya exit code yang benar (sebelumnya selalu 0).
set -u
cd "$(dirname "$0")/.." || exit 1

DIR_SESI="$HOME/.agent-termux/sessions"
DIR_TMP="$PWD/tmp-uji"
mkdir -p "$DIR_SESI" "$DIR_TMP"
LOG="$DIR_TMP/uji-sigint.out"

SEBELUM=$(ls -1 "$DIR_SESI"/*.json 2>/dev/null | wc -l)
echo "== Berkas sesi sebelum: $SEBELUM"

# stdin terbuka (ditahan) supaya proses tidak keluar karena EOF
( printf 'halo, tolong jawab singkat\n'; sleep 30 ) | node index.js > "$LOG" 2>&1 &
PID_PIPE=$!
sleep 6

# Cari proses node anak dari pipeline
PID_NODE=$(pgrep -n -f "node index.js")
if [ -z "${PID_NODE:-}" ]; then
  echo "GAGAL: proses node tidak ditemukan"; kill $PID_PIPE 2>/dev/null; exit 1
fi
echo "== Kirim SIGINT ke PID $PID_NODE"
T_MULAI=$(date +%s%3N)
kill -INT "$PID_NODE"

# Tunggu proses benar-benar hilang. Catatan: loop dibatasi 30 x 0,5 dtk =
# 15 dtk, dan angka yang dilaporkan dihitung SESUDAH loop selesai — bukan
# di dalam loop. Kesalahan lama: `break` keluar dari loop sebelum `sleep`,
# lalu `date` dipanggil setelah `wait` (yang menunggu `sleep 30` di pipe),
# sehingga durasi bisa tampak 24 dtk padahal keluar < 1 dtk.
KELUAR=0
for i in $(seq 1 30); do
  kill -0 "$PID_NODE" 2>/dev/null || { KELUAR=1; break; }
  sleep 0.5
done
T_SELESAI=$(date +%s%3N)
kill $PID_PIPE 2>/dev/null; wait $PID_PIPE 2>/dev/null

if [ "$KELUAR" -eq 1 ]; then
  MS_KELUAR=$((T_SELESAI - T_MULAI))
  echo "== Proses berhenti dalam ${MS_KELUAR} ms"
  # Keluar cepat = sinyal tertangani. Di atas 5 dtk berarti ada yang menggantung.
  if [ "$MS_KELUAR" -gt 5000 ]; then
    echo "== PERINGATAN: keluar lambat (> 5 dtk), cek janji yang menggantung"
  fi
else
  echo "== PERINGATAN: proses masih hidup setelah 15 dtk"
fi

SESUDAH=$(ls -1 "$DIR_SESI"/*.json 2>/dev/null | wc -l)
echo "== Berkas sesi sesudah: $SESUDAH"

BARU=$(ls -1t "$DIR_SESI"/*.json 2>/dev/null | head -1)
echo "== Sesi terbaru: $BARU"
echo "== Jumlah pesan tersimpan:"
HASIL=$(node -e '
const f=process.argv[1]; if(!f){console.log("TIDAK_ADA");process.exit(0)}
let j; try{ j=JSON.parse(require("fs").readFileSync(f,"utf8")); }catch(e){console.log("RUSAK");process.exit(0)}
const m=j.messages||[];
console.log("  judul:", j.judul || "-");
console.log("  pesan:", m.length, "| peran:", m.map(x=>x.role).join(","));
console.log(m.some(x=>x.role==="user") ? "PESAN_ADA" : "PESAN_HILANG");
' "$BARU" 2>&1)
echo "$HASIL" | grep -v -E "^(PESAN_ADA|PESAN_HILANG|TIDAK_ADA|RUSAK)$"

echo "== 10 baris terakhir output:"
tail -n 10 "$LOG"

echo
case "$(echo "$HASIL" | tail -1)" in
  PESAN_ADA)
    if [ "$SESUDAH" -ge "$SEBELUM" ]; then
      echo "LULUS ✓  (pesan user tersimpan walau SIGINT)"
      exit 0
    fi
    echo "GAGAL ✗  (berkas sesi berkurang: $SEBELUM → $SESUDAH)"; exit 1 ;;
  PESAN_HILANG) echo "GAGAL ✗  (pesan user hilang setelah SIGINT)"; exit 1 ;;
  RUSAK)        echo "GAGAL ✗  (berkas sesi tidak bisa dibaca)"; exit 1 ;;
  *)            echo "GAGAL ✗  (tidak ada sesi terbentuk)"; exit 1 ;;
esac
