// Membaca variabel rahasia (Secret) dari Cloudflare. Tidak bergantung pada flag nodejs_compat.
export const ENV = (k) =>
  (globalThis.__ENV && globalThis.__ENV[k]) || (typeof process !== "undefined" && process.env && process.env[k]) || "";
