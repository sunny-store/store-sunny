import { getStore } from "../db.mjs";
import { ENV } from "../env.mjs";

// Menyiapkan daftar langganan yang perlu diingatkan HARI INI (zona Asia/Jakarta).
// Tidak mengirim WhatsApp ke buyer. Hanya menyusun daftar + tautan click-to-chat,
// lalu (opsional) mengirimkannya ke Telegram ADMIN. Admin yang menekan kirim di WhatsApp.
const DAY = 864e5, jd = (ms) => Math.floor((ms + 7 * 36e5) / DAY);
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const dlong = (ms) => { const d = new Date(ms + 7 * 36e5); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
const TPL = "Hai Kak {nama}! ♡ Kami dari Sunny Store mau mengingatkan bahwa masa aktif langganan {app} paket {paket} akan berakhir pada {tanggal}. Jika Kakak ingin memperpanjang, silakan hubungi admin Sunny Store melalui WhatsApp ini ya. Terima kasih sudah berlangganan! ☀️";
const DAYS_SET = [7, 3, 1, 0, -1, -7]; // H-7, H-3, H-1, hari H, lewat 1 hari, lewat 7 hari

export const tgReady = () => !!(ENV("TELEGRAM_BOT_TOKEN") && ENV("TELEGRAM_CHAT_ID"));

export function buildDigest(subs, now = Date.now()) {
  const out = [];
  for (const s of subs) {
    if (!s || s.archivedAt || s.status === "dibatalkan") continue;
    const dd = jd(s.end) - jd(now);
    if (!DAYS_SET.includes(dd)) continue;
    const last = (s.reminders || []).slice(-1)[0];
    if (last && now - last.t < DAY) continue; // sudah diingatkan <24 jam lalu
    const n = String(s.wa || "").replace(/\D/g, "").replace(/^0/, "62");
    const ok = /^628\d{7,12}$/.test(n);
    const msg = TPL.replace("akan berakhir pada", dd < 0 ? "sudah berakhir pada" : "akan berakhir pada").replace("{nama}", s.nama).replace("{app}", s.app).replace("{paket}", s.plan || "-").replace("{tanggal}", dlong(s.end));
    out.push({ id: s.id, nama: s.nama, app: s.app, plan: s.plan || "", end: s.end, dd, hasWa: ok, link: ok ? "https://wa.me/" + n + "?text=" + encodeURIComponent(msg) : null });
  }
  return out.sort((a, b) => a.end - b.end);
}

function text(items) {
  const L = ["☀️ Sunny Store — " + items.length + " langganan perlu diingatkan hari ini", ""];
  for (const x of items.slice(0, 15)) {
    const st = x.dd > 0 ? "berakhir " + dlong(x.end) + " (" + x.dd + " hari lagi)" : x.dd === 0 ? "berakhir HARI INI" : "sudah berakhir " + -x.dd + " hari";
    L.push("• " + x.app + (x.plan ? " " + x.plan : "") + " — " + x.nama, "  " + st, "  " + (x.link || "(nomor WA belum ada, lengkapi di Rekap)"), "");
  }
  if (items.length > 15) L.push("+" + (items.length - 15) + " lagi, buka Rekap → Langganan.");
  return L.join("\n");
}

export async function runDigest({ notify = true } = {}) {
  const store = getStore("finance");
  const subs = await store.all("sb-", 2000);
  const items = buildDigest(subs);
  const last = { at: Date.now(), items: items.map(({ link, ...r }) => r), sent: false, err: "" };
  if (notify && items.length && tgReady()) {
    try {
      const r = await fetch("https://api.telegram.org/bot" + ENV("TELEGRAM_BOT_TOKEN") + "/sendMessage", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: ENV("TELEGRAM_CHAT_ID"), text: text(items), disable_web_page_preview: true }),
      });
      last.sent = r.ok;
      if (!r.ok) last.err = "Telegram menolak (kode " + r.status + ")";
    } catch { last.err = "Gagal menghubungi Telegram"; }
  }
  await store.setJSON("dg-last", last);
  return last;
}
