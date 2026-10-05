// Binary glTF (GLB) containers in memory. Hosts that allow fetching only the page's own files
// refuse `data:` and `blob:` URLs, so embedded buffers are unpacked here instead of by the loader.

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export type GltfJson = Record<string, any>;

export function base64Bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** JSON + binary chunk -> GLB; buffer 0 becomes the GLB's own binary chunk. */
export function packGLB(json: GltfJson, bin: Uint8Array): ArrayBuffer {
  const doc = { ...json, buffers: [{ byteLength: bin.byteLength }] };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(doc));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const binPad = (4 - (bin.byteLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.byteLength + jsonPad + 8 + bin.byteLength + binPad;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength + jsonPad, true);
  dv.setUint32(16, JSON_CHUNK, true);
  u8.set(jsonBytes, 20);
  u8.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonBytes.byteLength + jsonPad);
  const o = 20 + jsonBytes.byteLength + jsonPad;
  dv.setUint32(o, bin.byteLength + binPad, true);
  dv.setUint32(o + 4, BIN_CHUNK, true);
  u8.set(bin, o + 8);
  return out;
}

export function readGLB(buf: ArrayBuffer): { json: GltfJson; bin: Uint8Array } {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file');
  let o = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (o < dv.byteLength) {
    const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
    const data = new Uint8Array(buf, o + 8, len);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === BIN_CHUNK) bin = data;
    o += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON');
  return { json, bin };
}
