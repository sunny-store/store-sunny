import { ENV } from "../env.mjs";
const te = new TextEncoder(), td = new TextDecoder();
const secret = () => ENV("TOKEN_SECRET") || ENV("ADMIN_PASSWORD") || "";
export const b64u = (buf) => { let s = ""; for (const c of new Uint8Array(buf)) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
let _k, _s;
const hkey = async () => { const sec = secret(); if (_k && _s === sec) return _k; _s = sec; return (_k = await crypto.subtle.importKey("raw", te.encode(sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])); };
const sign = async (p) => b64u(await crypto.subtle.sign("HMAC", await hkey(), te.encode(p)));
export function safeEq(a, b) { // perbandingan waktu-tetap
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
// claims: {r:"a"} untuk admin, {r:"c",u:"username"} untuk pelanggan
export async function makeToken(hours = 12, claims = { r: "a" }) {
  const p = b64u(te.encode(JSON.stringify({ ...claims, exp: Date.now() + hours * 3600e3 })));
  return p + "." + (await sign(p));
}
async function parse(t) {
  if (!secret() || !t || !t.includes(".")) return null;
  const [p, sig] = t.split(".");
  if (!safeEq(sig, await sign(p))) return null;
  try { const d = JSON.parse(td.decode(unb64u(p))); return d.exp > Date.now() ? d : null; } catch { return null; }
}
export const verifyToken = async (t) => { const d = await parse(t); return !!d && d.r === "a"; };
export const verifyCust = async (t) => { const d = await parse(t); return d && d.r === "c" && d.u ? d : null; };
export const bearer = (req) => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
