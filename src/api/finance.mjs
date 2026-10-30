import { getStore } from "../db.mjs";
import { verifyToken, bearer, json } from "../lib/auth.mjs";
import { clean, rhex } from "../lib/util.mjs";
import { runDigest, tgReady } from "../lib/digest.mjs";

// Semua endpoint di sini KHUSUS admin (wajib login).
// ?kind=exp  -> pengeluaran      ?kind=sub -> langganan (masa aktif)

const KIND = { exp: "fx-", sub: "sb-", bud: "bd-", digest: "dg-" };
const EXP_CAT = ["Modal produk", "Langganan aplikasi", "Biaya transaksi", "Promosi", "Internet & operasional", "Refund", "Lainnya"];
const SUB_ST = ["aktif", "menunggu perpanjangan", "bermasalah", "dibatalkan"];
const PAYS = ["belum", "lunas"];
const rid = () => rhex(6);
const num = (v, max = 1e9) => { const n = Math.round(Number(v)); return n >= 0 && n <= max ? n : NaN; };
const ts = (s) => { const t = Date.parse(s); return isNaN(t) ? NaN : t; };

async function list(store, prefix) {
  return store.all(prefix, 2000); // yang diarsipkan tetap dikirim (ada archivedAt) agar riwayat keuangan tidak hilang
}

export default async (req) => {
  if (!(await verifyToken(bearer(req)))) return json({ error: "Tidak diizinkan, login admin dulu" }, 401);
  const store = getStore("finance");
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  if (!KIND[kind]) return json({ error: "kind tidak valid" }, 400);
  const P = KIND[kind];

  if (req.method === "GET") {
    if (kind === "digest") return json({ last: await store.get("dg-last", { type: "json" }), telegram: tgReady() });
    if (kind === "bud") {
      const m = url.searchParams.get("month") || "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return json({ error: "Bulan tidak valid" }, 400);
      return json({ budget: await store.get("bd-" + m, { type: "json" }) });
    }
    return json(await list(store, P));
  }

  if (req.method === "DELETE") { // arsip (soft delete), data tidak hilang dari server
    const id = clean(url.searchParams.get("id"), 40);
    const cur = id.startsWith(P) ? await store.get(id, { type: "json" }) : null;
    if (!cur) return json({ error: "Tidak ditemukan" }, 404);
    cur.archivedAt = Date.now();
    (cur.log = cur.log || []).push({ t: Date.now(), a: "diarsipkan" });
    await store.setJSON(id, cur);
    return json({ ok: true });
  }

  let b;
  try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }

  // ---------- PENGINGAT HARIAN (jalankan manual untuk tes) ----------
  if (kind === "digest" && req.method === "POST") return json({ ok: true, last: await runDigest({ notify: true }), telegram: tgReady() });

  // ---------- BUDGETING (satu dokumen per bulan) ----------
  if (kind === "bud" && req.method === "POST") {
    const m = String(b.month || "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return json({ error: "Bulan tidak valid" }, 400);
    const n0 = (v) => (v == null || v === "" ? 0 : num(v));
    const saldo = n0(b.saldo), targetOmzet = n0(b.targetOmzet), targetLaba = n0(b.targetLaba), items = {};
    if ([saldo, targetOmzet, targetLaba].some(isNaN)) return json({ error: "Nominal tidak valid" }, 400);
    for (const c of EXP_CAT) { const v = n0(b.items && b.items[c]); if (isNaN(v)) return json({ error: "Anggaran " + c + " tidak valid" }, 400); items[c] = v; }
    const doc = { month: m, saldo, targetOmzet, targetLaba, items, updatedAt: Date.now() };
    await store.setJSON("bd-" + m, doc);
    return json({ ok: true, budget: doc });
  }

  // ---------- PENGELUARAN ----------
  if (kind === "exp") {
    const f = () => {
      const t = ts(b.date + "T12:00:00+07:00"), amt = num(b.amount), desc = clean(b.desc, 120);
      if (isNaN(t)) return "Tanggal tidak valid";
      if (isNaN(amt) || amt < 1) return "Nominal tidak valid";
      if (desc.length < 2) return "Isi deskripsi dulu";
      return { t, amt, desc, cat: EXP_CAT.includes(b.cat) ? b.cat : "Lainnya", note: clean(b.note, 200) };
    };
    const v = f();
    if (typeof v === "string") return json({ error: v }, 400);
    if (req.method === "POST") {
      // idempotensi: klien kirim `cid`; kirim ulang (retry/klik dobel) tidak membuat data ganda
      const cid = clean(b.cid, 40).replace(/[^a-z0-9]/gi, "");
      const id = "fx-" + (cid || rid());
      if (cid && (await store.get(id, { type: "json" }))) return json({ ok: true, dup: true });
      const o = { id, ts: v.t, amount: v.amt, desc: v.desc, cat: v.cat, note: v.note, createdAt: Date.now() };
      await store.setJSON(id, o);
      return json({ ok: true, item: o });
    }
    if (req.method === "PATCH") {
      const cur = String(b.id || "").startsWith("fx-") ? await store.get(b.id, { type: "json" }) : null;
      if (!cur) return json({ error: "Tidak ditemukan" }, 404);
      Object.assign(cur, { ts: v.t, amount: v.amt, desc: v.desc, cat: v.cat, note: v.note, updatedAt: Date.now() });
      await store.setJSON(cur.id, cur);
      return json({ ok: true, item: cur });
    }
  }

  // ---------- LANGGANAN ----------
  if (kind === "sub") {
    const readFields = () => {
      const s = ts(b.start + "T00:00:00+07:00"), e = ts(b.end + "T23:59:00+07:00");
      const price = num(b.price, 5e6), nama = clean(b.nama, 40), app = clean(b.app, 60);
      const wa = clean(b.wa, 20).replace(/[\s-]/g, "");
      if (nama.length < 2 || app.length < 2) return "Isi nama pembeli & aplikasi";
      if (isNaN(s) || isNaN(e)) return "Tanggal mulai/berakhir tidak valid";
      if (e < s) return "Tanggal berakhir tidak boleh sebelum tanggal mulai";
      if (isNaN(price)) return "Harga tidak valid";
      if (wa && !/^(\+?62|0)8\d{7,12}$/.test(wa)) return "Nomor WhatsApp tidak valid";
      return { s, e, price, nama, app, wa, plan: clean(b.plan, 60), device: clean(b.device, 40), acct: clean(b.acct, 120), orderNo: clean(b.orderNo, 40), note: clean(b.note, 300) };
    };

    if (req.method === "POST" && b.action === "renew") {
      const cur = String(b.id || "").startsWith("sb-") ? await store.get(b.id, { type: "json" }) : null;
      if (!cur) return json({ error: "Langganan tidak ditemukan" }, 404);
      const rid_ = clean(b.rid, 40).replace(/[^a-z0-9]/gi, "");
      cur.renewals = cur.renewals || [];
      if (rid_ && cur.renewals.some((r) => r.rid === rid_)) return json({ ok: true, dup: true, item: cur }); // anti ganda
      const ns = ts(b.start + "T00:00:00+07:00"), ne = ts(b.end + "T23:59:00+07:00"), price = num(b.price, 5e6);
      if (isNaN(ns) || isNaN(ne) || ne <= ns) return json({ error: "Tanggal perpanjangan tidak valid" }, 400);
      if (isNaN(price)) return json({ error: "Harga tidak valid" }, 400);
      const pay = PAYS.includes(b.pay) ? b.pay : "belum";
      cur.renewals.push({ rid: rid_ || rid(), at: Date.now(), prevStart: cur.start, prevEnd: cur.end, start: ns, end: ne, price, pay, note: clean(b.note, 200) });
      cur.start = ns; cur.end = ne; cur.status = "aktif"; cur.remindedFor = null; // periode baru -> pengingat dihitung ulang
      (cur.log = cur.log || []).push({ t: Date.now(), a: "perpanjang", prevEnd: cur.prevEnd });
      await store.setJSON(cur.id, cur);
      return json({ ok: true, item: cur });
    }

    if (req.method === "POST" && b.action === "remind") { // hanya mencatat bahwa admin membuka WhatsApp
      const cur = String(b.id || "").startsWith("sb-") ? await store.get(b.id, { type: "json" }) : null;
      if (!cur) return json({ error: "Tidak ditemukan" }, 404);
      (cur.reminders = cur.reminders || []).push({ t: Date.now(), end: cur.end });
      cur.remindedFor = cur.end;
      await store.setJSON(cur.id, cur);
      return json({ ok: true, item: cur });
    }

    if (req.method === "POST" && b.action === "payrenew") { // tandai pembayaran perpanjangan sudah diterima
      const cur = String(b.id || "").startsWith("sb-") ? await store.get(b.id, { type: "json" }) : null;
      const r = cur && (cur.renewals || []).find((x) => x.rid === b.rid);
      if (!r) return json({ error: "Tidak ditemukan" }, 404);
      r.pay = "lunas"; r.paidAt = Date.now();
      await store.setJSON(cur.id, cur);
      return json({ ok: true, item: cur });
    }

    const v = readFields();
    if (typeof v === "string") return json({ error: v }, 400);

    if (req.method === "POST") {
      const cid = clean(b.cid, 40).replace(/[^a-z0-9]/gi, "");
      const id = "sb-" + (cid || rid());
      if (cid && (await store.get(id, { type: "json" }))) return json({ ok: true, dup: true });
      const pay = PAYS.includes(b.pay) ? b.pay : "lunas";
      const o = { id, nama: v.nama, wa: v.wa, app: v.app, plan: v.plan, device: v.device, acct: v.acct, orderNo: v.orderNo, note: v.note, start: v.s, end: v.e, price: v.price, pay, status: "aktif", renewals: [], reminders: [], remindedFor: null, createdAt: Date.now(), log: [{ t: Date.now(), a: "dibuat" }] };
      await store.setJSON(id, o);
      return json({ ok: true, item: o });
    }

    if (req.method === "PATCH") {
      const cur = String(b.id || "").startsWith("sb-") ? await store.get(b.id, { type: "json" }) : null;
      if (!cur) return json({ error: "Tidak ditemukan" }, 404);
      const st = SUB_ST.includes(b.status) ? b.status : cur.status;
      (cur.log = cur.log || []).push({ t: Date.now(), a: "edit", prevEnd: cur.end, prevStatus: cur.status });
      Object.assign(cur, { nama: v.nama, wa: v.wa, app: v.app, plan: v.plan, device: v.device, acct: v.acct, orderNo: v.orderNo, note: v.note, start: v.s, end: v.e, price: v.price, status: st, updatedAt: Date.now() });
      if (PAYS.includes(b.pay)) cur.pay = b.pay;
      await store.setJSON(cur.id, cur);
      return json({ ok: true, item: cur });
    }
  }

  return json({ error: "Method not allowed" }, 405);
};
