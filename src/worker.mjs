import { bindDb, hasDb } from "./db.mjs";
import { json } from "./lib/auth.mjs";
import { runDigest } from "./lib/digest.mjs";
import config from "./api/config.mjs";
import login from "./api/login.mjs";
import reviews from "./api/reviews.mjs";
import accounts from "./api/accounts.mjs";
import orders from "./api/orders.mjs";
import finance from "./api/finance.mjs";
import importer from "./api/import.mjs";

const routes = { "/api/config": config, "/api/login": login, "/api/reviews": reviews, "/api/account": accounts, "/api/orders": orders, "/api/finance": finance, "/api/import": importer };

export default {
  async fetch(req, env) {
    globalThis.__ENV = env; bindDb(env);
    const u = new URL(req.url);
    if (u.pathname === "/admin" || u.pathname === "/admin/") return Response.redirect(u.origin + "/#admin", 302);
    const h = routes[u.pathname];
    if (!h) return env.ASSETS ? env.ASSETS.fetch(req) : json({ error: "Tidak ditemukan" }, 404);
    if (!hasDb()) return json({ error: "Database D1 belum terhubung (binding DB). Lihat README langkah 3." }, 500);
    try { return await h(req); }
    catch (e) { console.error(e && e.stack || e); return json({ error: "Terjadi kesalahan di server, coba lagi" }, 500); }
  },
  // Cron harian 01:00 UTC = 08:00 WIB (lihat wrangler.jsonc)
  async scheduled(_event, env, ctx) {
    globalThis.__ENV = env; bindDb(env);
    if (hasDb()) ctx.waitUntil(runDigest({ notify: true }));
  },
};
