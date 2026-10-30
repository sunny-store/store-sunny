import { getStore } from "../db.mjs";
import { verifyToken, json } from "../lib/auth.mjs";
import { sha, ipOf } from "../lib/util.mjs";

const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const dateId = (ts) => new Date(ts).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric" });
const isAdmin = (req) => verifyToken((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));

async function all(store) {
  return store.all("rev-", 300, true); // terbaru dulu
}

export default async (req) => {
  const store = getStore("reviews");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const wantAll = url.searchParams.get("all");
    if (wantAll && !(await isAdmin(req))) return json({ error: "Tidak diizinkan" }, 401);
    const list = await all(store);
    const shown = wantAll ? list : list.filter((x) => x.status === "approved");
    return json(shown.map((x) => ({ id: x.id, name: x.name, rating: x.rating, text: x.text, status: x.status, date: dateId(x.ts) })));
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }
    if (b.hp) return json({ ok: true, status: "hidden" }); // jebakan untuk bot
    const rating = Math.round(Number(b.rating));
    if (!(rating >= 1 && rating <= 5)) return json({ error: "Pilih rating 1-5" }, 400);
    const name = clean(b.name, 40), text = clean(b.text, 300);
    if (/https?:\/\/|www\./i.test(name + " " + text)) return json({ error: "Ulasan tidak boleh berisi link" }, 400);

    const rk = "rl-" + (await sha(ipOf(req))).slice(0, 24);
    const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
    const rl = (await store.get(rk, { type: "json" })) || { d: today, n: 0, t: 0 };
    if (rl.d !== today) { rl.d = today; rl.n = 0; }
    if (now - rl.t < 60000 || rl.n >= 5) return json({ error: "Terlalu sering, coba lagi nanti ya" }, 429);
    rl.n++; rl.t = now;
    await store.setJSON(rk, rl);

    const cfg = (await getStore("sunny").get("config", { type: "json" })) || {};
    const status = cfg.revAuto ? "approved" : "pending";
    const id = "rev-" + String(now).padStart(14, "0") + "-" + Math.random().toString(36).slice(2, 7);
    await store.setJSON(id, { id, name, rating, text, ts: now, status });
    return json({ ok: true, status });
  }

  if (req.method === "PATCH") {
    if (!(await isAdmin(req))) return json({ error: "Tidak diizinkan" }, 401);
    let b;
    try { b = await req.json(); } catch { return json({ error: "Data tidak valid" }, 400); }
    if (!String(b.id || "").startsWith("rev-") || !["approved", "hidden"].includes(b.status)) return json({ error: "Data tidak valid" }, 400);
    const cur = await store.get(b.id, { type: "json" });
    if (!cur) return json({ error: "Tidak ditemukan" }, 404);
    cur.status = b.status;
    await store.setJSON(b.id, cur);
    return json({ ok: true });
  }

  if (req.method === "DELETE") {
    if (!(await isAdmin(req))) return json({ error: "Tidak diizinkan" }, 401);
    const id = url.searchParams.get("id") || "";
    if (!id.startsWith("rev-")) return json({ error: "Data tidak valid" }, 400);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
};
