import { makeToken, safeEq, json } from "../lib/auth.mjs";
import { ENV } from "../env.mjs";
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const pw = ENV("ADMIN_PASSWORD");
  if (!pw) return json({ error: "ADMIN_PASSWORD belum diatur di Cloudflare (Settings → Variables and Secrets)" }, 500);
  let body = {};
  try { body = await req.json(); } catch {}
  await new Promise((r) => setTimeout(r, 600)); // memperlambat tebak-tebakan password
  if (!safeEq(body.password || "", pw)) return json({ error: "Password salah" }, 401);
  return json({ token: await makeToken(12) });
};
