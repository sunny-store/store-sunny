import { ENV } from "../env.mjs";
import { b64u, unb64u } from "./auth.mjs";
const te = new TextEncoder(), td = new TextDecoder();
export const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
export const ipOf = (req) => req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "x";
export const rhex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export const rb64u = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(String(s)))), (b) => b.toString(16).padStart(2, "0")).join("");
// pembatas sederhana: maksimal `max` kali per `windowMs` untuk satu kunci
export async function limit(store, key, max, windowMs) {
  const k = "rl-" + (await sha(key)).slice(0, 24), now = Date.now();
  const r = (await store.get(k, { type: "json" })) || { t: now, n: 0 };
  if (now - r.t > windowMs) { r.t = now; r.n = 0; }
  if (r.n >= max) return false;
  r.n++;
  await store.setJSON(k, r);
  return true;
}
// ---- enkripsi data akun (email/password/PIN) sebelum disimpan: AES-256-GCM, kunci dari TOKEN_SECRET ----
let _ek, _es;
const ekey = async () => {
  const sec = ENV("TOKEN_SECRET") || ENV("ADMIN_PASSWORD");
  if (_ek && _es === sec) return _ek;
  _es = sec;
  return (_ek = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", te.encode("sunny-acc-v2:" + sec)), "AES-GCM", false, ["encrypt", "decrypt"]));
};
export async function enc(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await ekey(), te.encode(JSON.stringify(obj)));
  return b64u(iv) + "." + b64u(ct);
}
export async function dec(s) {
  try {
    const [a, b] = String(s).split(".");
    return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(a) }, await ekey(), unb64u(b))));
  } catch { return null; }
}
