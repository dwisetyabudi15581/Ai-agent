import { lebarTeks, bungkus, markdown, terapkanGaya, tanpaWarna } from "../src/ui/util.js";
import { tambahMemori, muatMemori, memoriKosong, sisipkanMemori } from "../src/core/memori.js";
import { idSesiBaru, ukuranRiwayat, ringkasRiwayat } from "../src/core/sesi.js";
import { daftarUrl, dasarDari, tandaiBermasalah, tandaiPulih } from "../src/config/config.js";

const cek = (nama, kondisi, info = "") => console.log(`${kondisi ? "OK  " : "BUG "} ${nama} ${info}`);

// 1) lebarTeks vs bungkus: teks ANSI
const t = "\x1b[31mhalo dunia\x1b[0m";
cek("lebarTeks ANSI", lebarTeks(t) === 10, `dapat ${lebarTeks(t)}`);

// 2) bungkus dengan baris sangat panjang tanpa spasi
const pjg = "x".repeat(200);
const b = bungkus(pjg, 40);
cek("bungkus tanpa spasi", b.every((x) => lebarTeks(x) <= 40) && b.join("") === pjg, `potongan=${b.length}`);

// 3) bungkus kata > lebar (emoji lebar 2)
const em = "😀".repeat(30);
const be = bungkus(em, 10);
cek("bungkus emoji", be.every((x) => lebarTeks(x) <= 10), `potongan=${be.length} lebar=${be.map(lebarTeks).join(",")}`);

// 4) markdown: bold di dalam bullet
const md = markdown("- **tebal** dan `kode`");
console.log("   markdown ->", JSON.stringify(md));

// 5) markdown: blok kode tertutup?
const md2 = markdown("```js\nlet a=1;\n```");
console.log("   blok ->", JSON.stringify(md2));

// 6) markdown label bahasa berisi karakter aneh
const md3 = markdown("```\nno-lang\n```");
console.log("   tanpa-bahasa ->", JSON.stringify(md3));

// 7) idSesiBaru keunikan dalam 1 detik
const ids = new Set(Array.from({ length: 10 }, () => idSesiBaru()));
cek("idSesi unik <1dtk", ids.size === 10, `unik=${ids.size}`);
console.log("   contoh id:", idSesiBaru());

// 8) ukuranRiwayat
console.log("   ukuranRiwayat:", ukuranRiwayat([{ role: "user", content: "abc" }, { role: "assistant", content: "", tool_calls: [{ id: "1", function: { name: "x", arguments: "{}" } }] }]));

// 9) daftarUrl: cek duplikat
const cfg = { baseUrl: "https://a/v1", baseCadangan: "https://a/v1" };
const u1 = daftarUrl(cfg, { stream: true });
cek("daftarUrl dedup", new Set(u1).size === u1.length, JSON.stringify(u1));

// 10) dasarDari
cek("dasarDari chat", dasarDari("https://a/v1/chat/completions") === "https://a/v1");
cek("dasarDari models", dasarDari("https://a/v1/models") === "https://a/v1");

// 11) memori
const asli = await muatMemori();
console.log("   memoriKosong:", memoriKosong(asli));
console.log("   sisipkanMemori panjang:", sisipkanMemori("SYS", asli).length, "vs 3");

// 12) Number aneh
console.log("   Number('') =>", Number(""), "| Number('  ') =>", Number("  "));

// 13) terapkanGaya dengan penanda tak tertutup
console.log("   gaya-tak-tertutup ->", JSON.stringify(terapkanGaya("\u0001tebal tanpa tutup")));
console.log("   tanpaWarna ->", JSON.stringify(tanpaWarna("\x1b[31mabc\x1b[0m")));
