import { getStore } from "../db.mjs";
import { verifyToken, bearer, json } from "../lib/auth.mjs";
export default async (req) => {
  const store = getStore("sunny");
  if (req.method === "GET") {
    const txt = await store.get("config"); // teks mentah: tidak di-parse ulang (hemat CPU, config bisa berukuran MB)
    return txt ? new Response(txt, { headers: { "content-type": "application/json", "cache-control": "no-store" } }) : json({ empty: true }, 404);
  }
  if (req.method === "PUT") {
    if (!(await verifyToken(bearer(req)))) return json({ error: "Tidak diizinkan, login admin dulu" }, 401);
    const txt = await req.text();
    let data;
    try { data = JSON.parse(txt); } catch { return json({ error: "JSON tidak valid" }, 400); }
    if (!data || typeof data !== "object" || !data.shop || !Array.isArray(data.products)) return json({ error: "Data konfigurasi tidak lengkap" }, 400);
    await store.set("config", txt);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
};
