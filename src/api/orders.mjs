import { getStore } from "../db.mjs";
import { verifyToken, verifyCust, bearer, json } from "../lib/auth.mjs";
import { clean, ipOf, sha, limit, enc, dec, rhex } from "../lib/util.mjs";

const NO = /^[A-Z]{3}-\d{6}-[A-Z2-9]{5}$/;
const STATUS = ["Menunggu konfirmasi", "Menunggu pembayaran", "Diproses", "Selesai", "Dibatalkan"];
const PAY = ["belum", "bukti", "lunas"];
const AL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rand5 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => AL[b % AL.length]).join("");

async function listOrders(store, prefix, month) {
  let items;
  if (prefix === "ord-") { // kunci memuat YYMMDD, jadi bulan bisa disaring langsung di query
    const ym = month ? month.slice(2, 4) + month.slice(5, 7) : "";
    items = ym ? await store.allLike("ord-___-" + ym + "__-_____", 1500) : await store.all("ord-", 1500);
  } else { // indeks pelanggan "ix-<user>-<no>" lalu ambil pesanannya
    const keys = await store.keys(prefix, 500);
    items = await store.many(keys.map((k) => "ord-" + k.slice(prefix.length)));
  }
  return items.sort((a, b) => b.ts - a.ts);
}
const forCust = (o) => ({ no: o.no, ts: o.ts, items: o.items, total: o.total, status: o.status, pay: o.pay, start: o.start, note: o.note });
const forAdmin = async (o) => ({ ...forCust(o), buyer: o.buyer, cat: o.cat, acct: o.acct, claim: o.claim, src: o.src || "web", acc: (o.accEnc && (await dec(o.accEnc))) || [] });
const cleanAcc = (arr, n) => Array.from({ length: n }, (_, i) => {
  const a = (arr && arr[i]) || {};
  return { email: clean(a.email, 120), pw: clean(a.pw, 120), pin: clean(a.pin, 40), profil: clean(a.profil, 60), note: clean(a.note, 200) };
});

export default async (req) => {
  const store = getStore("orders");
  const url = new URL(req.url);
  const token = bearer(req);
  const admin = await verifyToken(token);
  const cust = await verifyCust(token);

  if (req.method === "GET") {
    if (url.searchParams.get("all")) {
      if (!admin) return json({ error: "Tidak diizinkan" }, 401);
      const m = url.searchParams.get("month") || "";
      return json(await Promise.all((await listOrders(store, "ord-", /^\d{4}-\d{2}$/.test(m) ? m : "")).map(forAdmin)));
    }
    if (!cust) return json({ error: "Belum login" }, 401);
    return json((await listOrders(store, "ix-" + cust.u + "-")).map(forCust));
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }

  if (req.method === "POST") {
    const manual = admin && b.manual; // admin mencatat penjualan di luar website
    if (!manual && !(await limit(store, "ord:" + ipOf(req), 20, 3600e3))) return json({ error: "Terlalu sering, coba lagi nanti" }, 429);
    let no = String(b.no || ""), ts = Date.now();
    if (manual) {
      const d = b.date ? Date.parse(b.date + "T12:00:00+07:00") : NaN;
      if (!isNaN(d)) ts = d;
      const w = new Date(ts + 7 * 3600e3), p2 = (n) => String(n).padStart(2, "0");
      no = "MAN-" + String(w.getUTCFullYear()).slice(2) + p2(w.getUTCMonth() + 1) + p2(w.getUTCDate()) + "-" + rand5();
    } else if (!NO.test(no)) return json({ error: "Nomor pesanan tidak valid" }, 400);
    const nama = clean(b.buyer && b.buyer.nama, 40), wa = clean(b.buyer && b.buyer.wa, 20).replace(/[\s-]/g, "");
    if (nama.length < 2) return json({ error: "Nama pembeli tidak valid" }, 400);
    if (!(manual && !wa) && !/^(\+?62|0)8\d{7,12}$/.test(wa)) return json({ error: "Nomor WhatsApp tidak valid" }, 400);
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 20) return json({ error: "Isi pesanan tidak valid" }, 400);
    const items = [];
    for (const x of b.items) {
      const qty = Math.round(Number(x.qty)), satuan = Math.round(Number(x.satuan));
      if (!(qty >= 1 && qty <= 99) || !(satuan >= 0 && satuan <= 5000000)) return json({ error: "Isi pesanan tidak valid" }, 400);
      items.push({ produk: clean(x.produk, 60), jenis: clean(x.jenis, 60), durasi: clean(x.durasi, 60), qty, satuan, sub: qty * satuan });
    }
    const total = items.reduce((s, x) => s + x.sub, 0);
    if (!manual && (await store.get("ord-" + no, { type: "json" }))) return json({ ok: true, dup: true });
    const key = rhex(12);
    const o = { no, ts, kh: await sha(key), acct: cust ? cust.u : null, buyer: { nama, wa }, cat: clean(b.cat, 200), items, total, status: "Menunggu konfirmasi", pay: "belum", start: null, note: "", claim: null, src: manual ? "manual" : "web" };
    if (manual) {
      if (STATUS.includes(b.status)) o.status = b.status;
      o.pay = PAY.includes(b.pay) ? b.pay : "lunas";
      if (["Diproses", "Selesai"].includes(o.status)) o.start = ts;
    }
    await store.setJSON("ord-" + no, o);
    if (cust) await store.setJSON("ix-" + cust.u + "-" + no, { no });
    return json({ ok: true, key, no });
  }

  if (req.method === "PATCH") {
    if (admin && b.no) { // admin memperbarui status / data akun yang dijual
      const o = await store.get("ord-" + String(b.no), { type: "json" });
      if (!o) return json({ error: "Pesanan tidak ditemukan" }, 404);
      if (STATUS.includes(b.status)) o.status = b.status;
      if (PAY.includes(b.pay)) o.pay = b.pay;
      if (b.start === "" || b.start === null) o.start = null;
      else if (b.start) { const t = Date.parse(b.start); if (!isNaN(t)) o.start = t; }
      if (typeof b.note === "string") o.note = clean(b.note, 300);
      if (Array.isArray(b.acc)) o.accEnc = await enc(cleanAcc(b.acc, o.items.length));
      if (["Diproses", "Selesai"].includes(o.status) && !o.start && b.start === undefined) o.start = Date.now();
      await store.setJSON("ord-" + o.no, o);
      return json({ ok: true, order: await forAdmin(o) });
    }
    if (cust && Array.isArray(b.link)) { // hubungkan pesanan dari perangkat ini ke akun
      let n = 0;
      for (const l of b.link.slice(0, 50)) {
        const o = NO.test(String(l.no)) ? await store.get("ord-" + l.no, { type: "json" }) : null;
        if (o && !o.acct && o.kh === (await sha(l.key || ""))) { o.acct = cust.u; await store.setJSON("ord-" + o.no, o); await store.setJSON("ix-" + cust.u + "-" + o.no, { no: o.no }); n++; }
      }
      return json({ ok: true, linked: n });
    }
    if (b.claim && b.no) { // customer menandai "sudah bayar, bukti dikirim"
      const o = NO.test(String(b.no)) ? await store.get("ord-" + b.no, { type: "json" }) : null;
      if (!o || o.kh !== (await sha(b.key || ""))) return json({ error: "Tidak diizinkan" }, 401);
      o.claim = Date.now();
      if (o.pay === "belum") o.pay = "bukti";
      await store.setJSON("ord-" + o.no, o);
      return json({ ok: true });
    }
    return json({ error: "Tidak diizinkan" }, 401);
  }

  return json({ error: "Method not allowed" }, 405);
};
