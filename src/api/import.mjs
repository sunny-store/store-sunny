// Impor data dari CSV hasil ekspor Rekap lama (khusus admin). Aman dijalankan berulang: data yang sudah ada dilewati.
import { getStore } from "../db.mjs";
import { verifyToken, bearer, json } from "../lib/auth.mjs";
import { clean, sha, rhex, enc } from "../lib/util.mjs";

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };
const NO = /^[A-Z]{3}-\d{6}-[A-Z2-9]{5}$/;
const STATUS = ["Menunggu konfirmasi", "Menunggu pembayaran", "Diproses", "Selesai", "Dibatalkan"];
const EXP_CAT = ["Modal produk", "Langganan aplikasi", "Biaya transaksi", "Promosi", "Internet & operasional", "Refund", "Lainnya"];
const p2 = (n) => String(n).padStart(2, "0");
const unq = (v) => String(v ?? "").replace(/^'(?=[=+\-@\t\r])/, "").trim(); // CSV lama memberi ' di depan sel yang diawali + = - @
const num = (v) => { const n = Math.round(Number(String(v ?? "").replace(/[^\d.-]/g, ""))); return isFinite(n) && n >= 0 ? n : NaN; };
const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? String(s) : "");
function when(s, no) {
  const m = String(s || "").match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})(?:\D+(\d{1,2})[.:](\d{2}))?/);
  const mo = m && MON[m[2].toLowerCase()];
  if (mo) return Date.parse(`${m[3]}-${p2(mo)}-${p2(m[1])}T${p2(m[4] || 12)}:${p2(m[5] || 0)}:00+07:00`);
  const d = String(no).split("-")[1] || ""; // fallback: YYMMDD dari nomor pesanan
  return /^\d{6}$/.test(d) ? Date.parse(`20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}T12:00:00+07:00`) : NaN;
}
const payOf = (l) => (/sudah|lunas/i.test(l) ? "lunas" : /bukti|verif/i.test(l) ? "bukti" : "belum");

async function orders(rows, store) {
  const g = new Map(); let bad = 0;
  for (const r of rows) { const no = unq(r["No. Pesanan"]); if (!NO.test(no)) { bad++; continue; } if (!g.has(no)) g.set(no, []); g.get(no).push(r); }
  const have = await store.existing([...g.keys()].map((n) => "ord-" + n));
  const put = []; let skipped = 0;
  for (const [no, rs] of g) {
    if (have.has("ord-" + no)) { skipped++; continue; }
    const f = rs[0], ts = when(f["Tanggal"], no);
    const items = rs.map((r) => {
      const qty = Math.max(1, Math.round(Number(r["Qty"]) || 1));
      let satuan = num(r["Harga satuan"]); if (isNaN(satuan)) satuan = Math.round((num(r["Subtotal"]) || 0) / qty);
      return { produk: clean(r["Aplikasi"], 60), jenis: clean(r["Jenis akun"], 60), durasi: clean(r["Durasi"], 60), qty, satuan, sub: qty * satuan };
    });
    const nama = clean(f["Nama"], 40);
    if (isNaN(ts) || nama.length < 2 || items.some((x) => !x.produk)) { bad++; continue; }
    const status = STATUS.includes(clean(f["Status"], 30)) ? clean(f["Status"], 30) : "Menunggu konfirmasi";
    const acc = rs.map((r) => ({ email: clean(unq(r["Email akun"]), 120), pw: clean(unq(r["Password"]), 120), pin: clean(unq(r["PIN"]), 40), profil: clean(unq(r["Profil"]), 60), note: "" }));
    const o = { no, ts, kh: await sha(rhex(12)), acct: null, buyer: { nama, wa: clean(unq(f["WhatsApp"]), 20).replace(/[\s-]/g, "") }, cat: "", items, total: items.reduce((s, x) => s + x.sub, 0), status, pay: payOf(clean(f["Pembayaran"], 40)), start: ["Diproses", "Selesai"].includes(status) ? ts : null, note: clean(f["Catatan"], 300), claim: null, src: no.startsWith("MAN-") ? "manual" : "web" };
    if (acc.some((a) => a.email || a.pw || a.pin || a.profil)) o.accEnc = await enc(acc);
    put.push(["ord-" + no, JSON.stringify(o)]);
  }
  if (put.length) await store.setMany(put);
  return { added: put.length, skipped, bad };
}

async function subs(rows, store) {
  const seen = new Map(), recs = []; let bad = 0;
  for (const r of rows) {
    const nama = clean(r["Buyer"], 40), app = clean(r["Aplikasi"], 60), start = day(r["Mulai"]), end = day(r["Berakhir"]), price = num(r["Harga"]);
    if (nama.length < 2 || app.length < 2 || !start || !end || end < start || isNaN(price)) { bad++; continue; }
    const base = [unq(r["No. Pesanan"]), app, unq(r["Akun"])].join("|"), occ = seen.get(base) || 0; seen.set(base, occ + 1);
    const id = "sb-i" + (await sha(base + "|" + occ)).slice(0, 12);
    const lab = clean(r["Status"], 40).toLowerCase();
    const status = lab.includes("dibatalkan") ? "dibatalkan" : lab.includes("bermasalah") ? "bermasalah" : lab.includes("menunggu") ? "menunggu perpanjangan" : "aktif";
    const e = Date.parse(end + "T23:59:00+07:00"), last = day(r["Diingatkan terakhir"]);
    const nren = parseInt(r["Perpanjangan"], 10) || 0;
    recs.push({ id, nama, wa: clean(unq(r["WhatsApp"]), 20).replace(/[\s-]/g, ""), app, plan: clean(r["Paket"], 60), device: clean(r["Perangkat"], 40), acct: clean(unq(r["Akun"]), 120), orderNo: clean(unq(r["No. Pesanan"]), 40), note: nren ? "Diimpor dari CSV (" + nren + " perpanjangan sebelumnya tidak ikut terbawa)" : "", start: Date.parse(start + "T00:00:00+07:00"), end: e, price, pay: "lunas", status, renewals: [], reminders: last ? [{ t: Date.parse(last + "T09:00:00+07:00"), end: e }] : [], remindedFor: last ? e : null, createdAt: Date.now(), log: [{ t: Date.now(), a: "diimpor" }] });
  }
  const have = await store.existing(recs.map((x) => x.id));
  const put = recs.filter((x) => !have.has(x.id)).map((x) => [x.id, JSON.stringify(x)]);
  if (put.length) await store.setMany(put);
  return { added: put.length, skipped: recs.length - put.length, bad };
}

async function expenses(rows, store) {
  const seen = new Map(), recs = []; let bad = 0;
  for (const r of rows) {
    const d = day(r["Tanggal"]), amount = num(r["Nominal"]), desc = clean(r["Deskripsi"], 120);
    if (!d || isNaN(amount) || amount < 1 || desc.length < 2) { bad++; continue; }
    const cat = EXP_CAT.includes(clean(r["Kategori"], 40)) ? clean(r["Kategori"], 40) : "Lainnya", note = clean(r["Catatan"], 200);
    const base = [d, cat, desc, amount, note].join("|"), occ = seen.get(base) || 0; seen.set(base, occ + 1);
    const id = "fx-i" + (await sha(base + "|" + occ)).slice(0, 12);
    recs.push({ id, ts: Date.parse(d + "T12:00:00+07:00"), amount, desc, cat, note, createdAt: Date.now() });
  }
  const have = await store.existing(recs.map((x) => x.id));
  const put = recs.filter((x) => !have.has(x.id)).map((x) => [x.id, JSON.stringify(x)]);
  if (put.length) await store.setMany(put);
  return { added: put.length, skipped: recs.length - put.length, bad };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await verifyToken(bearer(req)))) return json({ error: "Tidak diizinkan, login admin dulu" }, 401);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 300) : [];
  if (!rows.length) return json({ error: "Tidak ada baris data" }, 400);
  if (b.kind === "orders") return json({ ok: true, ...(await orders(rows, getStore("orders"))) });
  if (b.kind === "subs") return json({ ok: true, ...(await subs(rows, getStore("finance"))) });
  if (b.kind === "expenses") return json({ ok: true, ...(await expenses(rows, getStore("finance"))) });
  return json({ error: "Jenis impor tidak dikenal" }, 400);
};
