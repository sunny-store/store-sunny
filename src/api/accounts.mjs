import { getStore } from "../db.mjs";
import { makeToken, verifyToken, verifyCust, bearer, json, safeEq } from "../lib/auth.mjs";
import { clean, ipOf, limit, rhex, rb64u } from "../lib/util.mjs";
import { ENV } from "../env.mjs";

// Hash password pelanggan: PBKDF2-SHA256 (WebCrypto). Jumlah putaran dibatasi karena paket gratis Workers
// hanya memberi 10 ms CPU per permintaan. Naikkan lewat Secret HASH_ITER jika memakai Workers Paid (mis. 210000).
const ITER = () => Math.min(Math.max(parseInt(ENV("HASH_ITER"), 10) || 10000, 1000), 1000000);
const hashPw = async (p, salt, it) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(p)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: it }, k, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
};
const pub = (a) => ({ u: a.u, nama: a.nama, wa: a.wa });

export default async (req) => {
  const store = getStore("accounts");

  if (req.method === "GET") {
    const c = await verifyCust(bearer(req));
    if (!c) return json({ error: "Belum login" }, 401);
    const a = await store.get("u-" + c.u, { type: "json" });
    return a ? json(pub(a)) : json({ error: "Akun tidak ditemukan" }, 401);
  }

  let b = {};
  if (req.method === "POST" || req.method === "PATCH") {
    try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }
  }

  if (req.method === "POST" && b.action === "register") {
    if (!(await limit(store, "reg:" + ipOf(req), 5, 3600e3))) return json({ error: "Terlalu sering, coba lagi nanti ya" }, 429);
    const u = String(b.u || "").toLowerCase(), p = String(b.p || "");
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return json({ error: "Username 3-20 karakter: huruf kecil, angka, atau _" }, 400);
    if (p.length < 6 || p.length > 72) return json({ error: "Password minimal 6 karakter" }, 400);
    const nama = clean(b.nama, 40);
    const wa = clean(b.wa, 20).replace(/[\s-]/g, "");
    if (nama.length < 2) return json({ error: "Isi namamu dulu ya" }, 400);
    if (wa && !/^(\+?62|0)8\d{7,12}$/.test(wa)) return json({ error: "Nomor WhatsApp belum valid" }, 400);
    if (await store.get("u-" + u, { type: "json" })) return json({ error: "Username sudah dipakai" }, 409);
    const salt = rhex(16), it = ITER();
    const a = { u, nama, wa, salt, it, hash: await hashPw(p, salt, it), ts: Date.now() };
    await store.setJSON("u-" + u, a);
    return json({ token: await makeToken(24 * 30, { r: "c", u }), ...pub(a) });
  }

  if (req.method === "POST" && b.action === "login") {
    if (!(await limit(store, "login:" + ipOf(req), 15, 600e3))) return json({ error: "Terlalu banyak percobaan, coba lagi nanti" }, 429);
    const u = String(b.u || "").toLowerCase();
    const a = /^[a-z0-9_]{3,20}$/.test(u) ? await store.get("u-" + u, { type: "json" }) : null;
    const ok = a && safeEq(await hashPw(b.p || "", a.salt, a.it || 16384), a.hash);
    if (!ok) return json({ error: "Username atau password salah" }, 401);
    return json({ token: await makeToken(24 * 30, { r: "c", u }), ...pub(a) });
  }

  if (req.method === "PATCH") { // admin: reset password pelanggan
    if (!(await verifyToken(bearer(req)))) return json({ error: "Tidak diizinkan" }, 401);
    const u = String(b.u || "").toLowerCase();
    const a = await store.get("u-" + u, { type: "json" });
    if (!a) return json({ error: "Username tidak ditemukan" }, 404);
    const tmp = rb64u(6).slice(0, 8);
    a.salt = rhex(16); a.it = ITER();
    a.hash = await hashPw(tmp, a.salt, a.it);
    await store.setJSON("u-" + u, a);
    return json({ ok: true, u, tmp });
  }

  return json({ error: "Method not allowed" }, 405);
};
