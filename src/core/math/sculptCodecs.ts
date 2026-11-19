import { GRID_POINT_COUNT } from '../../schema/geometry.types';

/** 定点量化倍率：0.1 m 一格 */
export const SCULPT_QUANT = 10;
/** 微雕增量硬限幅（米），保证 Int16 量化不溢出 */
export const SCULPT_MAX_ABS_M = 3200;
/** 理论最大量化误差 0.05 m，留 0.001 m 浮点余量 */
export const SCULPT_MAX_ERROR_M = 0.051;

/** 必须为 3 的倍数，否则逐块 btoa 的填充符会污染拼接结果 */
const CHUNK = 8190;

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    out += globalThis.btoa(String.fromCharCode(...slice));
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Float32Array(66049) -> Int16 小端 0.1m 定点 Base64。
 * 全零增量返回空串 `""`，未微雕工程持久化占 0 字节。
 */
export function encodeSculptDelta(delta: Float32Array): string {
  let nonZero = false;
  for (let i = 0; i < delta.length; i += 1) {
    if ((delta[i] ?? 0) !== 0) {
      nonZero = true;
      break;
    }
  }
  if (!nonZero) return '';
  const q = new Int16Array(delta.length);
  for (let i = 0; i < delta.length; i += 1) {
    const v = delta[i] ?? 0;
    const clamped = Math.max(-SCULPT_MAX_ABS_M, Math.min(SCULPT_MAX_ABS_M, v));
    q[i] = Math.round(clamped * SCULPT_QUANT);
  }
  return bytesToBase64(new Uint8Array(q.buffer, q.byteOffset, q.byteLength));
}

/**
 * Base64 -> Float32Array(66049)，空串或异常输入返回全零场。
 * 往返最大量化误差严格 <= 0.051 m。
 */
export function decodeSculptDelta(
  base64Str: string | null | undefined,
  expectedLen: number = GRID_POINT_COUNT,
): Float32Array {
  const out = new Float32Array(expectedLen);
  if (typeof base64Str !== 'string' || base64Str.length === 0) return out;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64Str);
  } catch {
    return out;
  }
  const count = Math.min(Math.floor(bytes.length / 2), expectedLen);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getInt16(i * 2, true) / SCULPT_QUANT;
  }
  return out;
}

/** 数值数组或 Float32Array 统一编码，供 V1.2.2 旧字段 `sculptDelta` 归一化使用 */
export function encodeSculptDeltaFromUnknown(
  raw: ReadonlyArray<number> | Float32Array,
  expectedLen: number = GRID_POINT_COUNT,
): string {
  const buf = new Float32Array(expectedLen);
  const n = Math.min(raw.length, expectedLen);
  for (let i = 0; i < n; i += 1) {
    const v = raw[i];
    if (typeof v === 'number' && Number.isFinite(v)) buf[i] = v;
  }
  return encodeSculptDelta(buf);
}
