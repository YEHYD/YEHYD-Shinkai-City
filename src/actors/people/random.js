// FNV-1a string hash, copied from yans_little_town (MIT).
// The people modules key every look off a string id, so the hash has to be stable
// across sessions: same resident id, same face, same coat.

export function hash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A number in [0, 1) from a key.
export function unit(key) {
  return hash(key) / 4294967296;
}