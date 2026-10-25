// Salted commitment sha256(salt_32B ‖ content), computed in the browser (security DAT-2).
// The salt and the content stay off-chain; only the hash goes to the contract as BytesN<32>.
export async function commit(content: Uint8Array): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const buf = new Uint8Array(salt.length + content.length);
  buf.set(salt);
  buf.set(content, salt.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return { salt: hex(salt), hash: hex(digest) };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
