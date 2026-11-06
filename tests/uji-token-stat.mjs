// Uji statistik token: angka PASTI dari usage API + penghematan pemadatan nyata.
import { buatPencatatToken, nf, persen } from '../src/core/statistik.js';
import { riwayatUntukModel } from '../src/tools/tools.js';

let lulus = 0, gagal = 0;
const cek = (nama, syarat, info = '') => {
  if (syarat) { lulus++; console.log('  ✓', nama); }
  else { gagal++; console.log('  ✗', nama, info); }
};

console.log('\n== 1. usage API dicatat apa adanya ==');
const t = buatPencatatToken();
t.catatPanggilan({ prompt_tokens: 525, completion_tokens: 512, total_tokens: 1037 }, 'deepseek-v4-pro', 5);
t.catatPanggilan({ prompt_tokens: 1200, completion_tokens: 80,
  completion_tokens_details: { reasoning_tokens: 340 },
  prompt_tokens_details: { cached_tokens: 400 } }, 'deepseek-v4-pro', 5);
let s = t.ringkas(5);
cek('masuk = 525+1200', s.masuk === 1725, `dapat ${s.masuk}`);
cek('keluar = 512+80', s.keluar === 592, `dapat ${s.keluar}`);
cek('reasoning ditangkap', s.reasoning === 340, `dapat ${s.reasoning}`);
cek('cached ditangkap', s.cacheHemat === 400, `dapat ${s.cacheHemat}`);
cek('total = masuk+keluar', s.totalToken === 2317, `dapat ${s.totalToken}`);
cek('kuota = total x mult', s.kuota === 2317 * 5, `dapat ${s.kuota}`);

console.log('\n== 2. usage KOSONG ditandai, bukan dikarang ==');
const t2 = buatPencatatToken();
t2.catatPanggilan(null, 'x', 1);
t2.catatPanggilan({}, 'x', 1);
t2.catatPanggilan({ prompt_tokens: 10, completion_tokens: 5 }, 'x', 1);
const s2 = t2.ringkas(1);
cek('2 panggilan tanpa usage tercatat', s2.tanpaUsage === 2, `dapat ${s2.tanpaUsage}`);
cek('angka hanya dari yang valid', s2.masuk === 10 && s2.keluar === 5);
cek('flag adaAngkaPalsu aktif', s2.adaAngkaPalsu === true);
cek('panggilan tetap dihitung', s2.panggilan === 3);

console.log('\n== 3. penghematan diukur dari riwayat NYATA ==');
const BESAR = 'C'.repeat(4000);
function sesi(n) {
  const m = [{ role:'system', content:'sys' }, { role:'user', content:'halo' }];
  for (let i=0;i<n;i++){
    m.push({ role:'assistant', content:'', tool_calls:[{id:`c${i}`,type:'function',function:{name:'baca_file',arguments:'{}'}}] });
    m.push({ role:'tool', tool_call_id:`c${i}`, name:'baca_file', content:BESAR });
    m.push({ role:'assistant', content:'B'.repeat(1500) });
  }
  m.push({ role:'user', content:'lanjut' });
  return m;
}
const t3 = buatPencatatToken();
const mentah1 = sesi(5);
const kirim1 = riwayatUntukModel(mentah1, { jagaToolTerakhir: 2, jagaTerakhir: 4 });
t3.catatPemadatan(mentah1, kirim1);
s = t3.ringkas();
cek('kirim < mentah', s.kirim < s.mentah, `${s.kirim} vs ${s.mentah}`);
cek('persenHemat 0..100', s.persenHemat > 0 && s.persenHemat < 100, `${s.persenHemat}`);
cek('tokenDihemat positif', s.tokenDihemat > 0, `${s.tokenDihemat}`);
cek('giliranDiukur = 1', s.giliranDiukur === 1);

console.log('\n== 4. TIDAK ada pemadatan → hemat 0% (jujur, bukan dipaksa) ==');
const t4 = buatPencatatToken();
const kecil = [{role:'system',content:'a'},{role:'user',content:'b'}];
t4.catatPemadatan(kecil, kecil);
s = t4.ringkas();
cek('hemat tepat 0%', s.persenHemat === 0, `dapat ${s.persenHemat}`);

console.log('\n== 5. hemat tumbuh seiring sesi memanjang ==');
const hasil = [];
for (const n of [5, 20, 50]) {
  const tt = buatPencatatToken();
  const mm = sesi(n);
  tt.catatPemadatan(mm, riwayatUntukModel(mm, { jagaToolTerakhir: 2, jagaTerakhir: 4 }));
  hasil.push(tt.ringkas().persenHemat);
}
cek('5 < 20 putaran', hasil[0] < hasil[1], hasil.map(x=>x.toFixed(1)).join(' / '));
cek('20 < 50 putaran', hasil[1] < hasil[2], hasil.map(x=>x.toFixed(1)).join(' / '));
cek('50 putaran > 90%', hasil[2] > 90, `${hasil[2].toFixed(1)}%`);
console.log(`  → ${hasil.map((x,i)=>`${[5,20,50][i]} putaran: ${x.toFixed(1)}%`).join(' · ')}`);

console.log('\n== 6. router ganti model → multiplier dihitung PER MODEL ==');
const t6 = buatPencatatToken();
t6.catatPanggilan({ prompt_tokens: 1000, completion_tokens: 0 }, 'murah-1x', 1);
t6.catatPanggilan({ prompt_tokens: 1000, completion_tokens: 0 }, 'mahal-10x', 10);
s = t6.ringkas();
cek('dua model tercatat terpisah', s.perModel.length === 2, `dapat ${s.perModel.length}`);
cek('kuota = 1000x1 + 1000x10 = 11000', s.kuota === 11000, `dapat ${s.kuota}`);
cek('multiplier per model tersimpan', s.perModel.find(m=>m.id==='mahal-10x').mult === 10);

console.log('\n== 7. kelas harga dari multiplier ==');
const kelas = (mult) => buatPencatatToken().ringkas(mult).kelasHarga;
cek('1x = termurah', kelas(1) === 'termurah');
cek('5x = menengah', kelas(5) === 'menengah');
cek('20x = mahal', kelas(20) === 'mahal');
cek('100x = termahal', kelas(100) === 'termahal');
cek('null = ?', kelas(null) === '?');

console.log('\n== 8. format angka Indonesia ==');
cek('nf ribuan pakai titik', /\./.test(nf(1234567)), nf(1234567));
cek('nf desimal dibulatkan', nf(1234.7) === '1.235', nf(1234.7));
cek('persen 1 desimal', persen(94.04) === '94.0%', persen(94.04));

console.log('\n== 9. ukuran menghitung tool_calls (bukan hanya content) ==');
const t9 = buatPencatatToken();
const dgnCall = [{ role:'assistant', content:'', tool_calls:[{id:'c1',type:'function',function:{name:'x',arguments:JSON.stringify({a:'y'.repeat(500)})}}] }];
t9.catatPemadatan(dgnCall, [{role:'assistant',content:''}]);
cek('tool_calls ikut diukur', t9.ringkas().mentah > 500, `${t9.ringkas().mentah}`);

console.log(`\n${lulus} lulus · ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
