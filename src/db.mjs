// Penyimpanan key-value di atas Cloudflare D1 (SQLite). Strongly consistent, dan 1 query bisa
// mengambil banyak baris sekaligus (penting: paket gratis hanya mengizinkan 50 subrequest per permintaan).
// Nilai besar (mis. konfigurasi toko berisi gambar) otomatis dipecah karena batas 2 MB per baris D1.
let DB = null, ready = null;
export const bindDb = (env) => { DB = env.DB || null; };
export const hasDb = () => !!DB;
const CH = 400000;
const init = () => ready || (ready = DB.prepare("CREATE TABLE IF NOT EXISTS kv (s TEXT NOT NULL, k TEXT NOT NULL, i INTEGER NOT NULL DEFAULT 0, v TEXT NOT NULL, PRIMARY KEY (s, k, i))").run().catch((e) => { ready = null; throw e; }));
const parts = (t) => { const a = []; for (let o = 0; o < t.length || o === 0; o += CH) a.push(t.slice(o, o + CH)); return a; };
const group = (rows) => { const m = new Map(); for (const r of rows) m.set(r.k, (m.get(r.k) || "") + r.v); return m; };
const J = (t) => { try { return JSON.parse(t); } catch { return null; } };

export function getStore(name) {
  const st = {
    async get(k, opt) {
      await init();
      const { results } = await DB.prepare("SELECT v FROM kv WHERE s=? AND k=? ORDER BY i").bind(name, k).all();
      if (!results.length) return null;
      const t = results.map((r) => r.v).join("");
      return opt && opt.type === "json" ? J(t) : t;
    },
    async set(k, text) {
      await init();
      await DB.batch([
        DB.prepare("DELETE FROM kv WHERE s=? AND k=?").bind(name, k),
        ...parts(String(text)).map((p, i) => DB.prepare("INSERT INTO kv (s,k,i,v) VALUES (?,?,?,?)").bind(name, k, i, p)),
      ]);
    },
    setJSON: (k, o) => st.set(k, JSON.stringify(o)),
    async delete(k) { await init(); await DB.prepare("DELETE FROM kv WHERE s=? AND k=?").bind(name, k).run(); },
    // semua nilai (JSON) dengan awalan kunci tertentu, 1 query
    async all(prefix, limit = 2000, desc = false) {
      await init();
      const q = "SELECT k, v FROM kv WHERE s=? AND k>=? AND k<? ORDER BY k " + (desc ? "DESC" : "ASC") + ", i LIMIT ?";
      const { results } = await DB.prepare(q).bind(name, prefix, prefix + "\uffff", limit * 3).all();
      return [...group(results).values()].slice(0, limit).map(J).filter((x) => x != null);
    },
    // sama seperti all(), tapi dengan pola LIKE (hanya karakter _ dan % sebagai wildcard)
    async allLike(pattern, limit = 2000) {
      await init();
      const { results } = await DB.prepare("SELECT k, v FROM kv WHERE s=? AND k LIKE ? ORDER BY k, i LIMIT ?").bind(name, pattern, limit * 3).all();
      return [...group(results).values()].slice(0, limit).map(J).filter((x) => x != null);
    },
    async many(keys) {
      await init();
      const out = [];
      for (let i = 0; i < keys.length; i += 80) {
        const ks = keys.slice(i, i + 80);
        const { results } = await DB.prepare("SELECT k, v FROM kv WHERE s=? AND k IN (" + ks.map(() => "?").join(",") + ") ORDER BY k, i").bind(name, ...ks).all();
        for (const v of group(results).values()) { const o = J(v); if (o != null) out.push(o); }
      }
      return out;
    },
    // tulis banyak sekaligus (batch), dipakai impor data
    async setMany(entries) {
      await init();
      const stmts = [];
      for (const [k, text] of entries) {
        stmts.push(DB.prepare("DELETE FROM kv WHERE s=? AND k=?").bind(name, k));
        parts(String(text)).forEach((p, i) => stmts.push(DB.prepare("INSERT INTO kv (s,k,i,v) VALUES (?,?,?,?)").bind(name, k, i, p)));
      }
      for (let i = 0; i < stmts.length; i += 90) await DB.batch(stmts.slice(i, i + 90));
    },
    // himpunan kunci (dari daftar) yang sudah ada
    async existing(keys) {
      await init();
      const out = new Set();
      for (let i = 0; i < keys.length; i += 80) {
        const ks = keys.slice(i, i + 80);
        const { results } = await DB.prepare("SELECT DISTINCT k FROM kv WHERE s=? AND i=0 AND k IN (" + ks.map(() => "?").join(",") + ")").bind(name, ...ks).all();
        results.forEach((r) => out.add(r.k));
      }
      return out;
    },
    // daftar kunci saja (tanpa isi)
    async keys(prefix, limit = 5000) {
      await init();
      const { results } = await DB.prepare("SELECT DISTINCT k FROM kv WHERE s=? AND k>=? AND k<? AND i=0 ORDER BY k LIMIT ?").bind(name, prefix, prefix + "\uffff", limit).all();
      return results.map((r) => r.k);
    },
  };
  return st;
}
