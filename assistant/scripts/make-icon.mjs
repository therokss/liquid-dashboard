// Genera claude_assistant/icon.png e logo.png senza dipendenze: quadrato arrotondato con
// gradiente ciano→viola (palette Liquid Glass) e un fumetto bianco con una scintilla.
//   node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const SS = 4 // supersampling per bordi morbidi

const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r
  const qy = Math.abs(y - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r
// Scintilla a quattro punte: |x|^p + |y|^p con p < 1.
const inSparkle = (x, y, cx, cy, s) => {
  const dx = Math.abs(x - cx) / s
  const dy = Math.abs(y - cy) / s
  return Math.pow(dx, 0.5) + Math.pow(dy, 0.5) <= 1
}
// Punta del fumetto: triangolo in basso a sinistra.
const inTail = (x, y) => {
  const ax = 78, ay = 168, bx = 112, by = 168, cx = 66, cy = 200
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry)
  const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, cx, cy), d3 = s(x, y, cx, cy, ax, ay)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

function shade(x, y) {
  if (sdRoundRect(x, y, 128, 128, 120, 120, 56) > 0) return [0, 0, 0, 0]
  const t = (x + y) / (2 * SIZE)
  const bg = [0 + (181 - 0) * t, 219 + (110 - 219) * t, 231 + (255 - 231) * t]
  const bubble = sdRoundRect(x, y, 128, 118, 76, 58, 34) <= 0 || inTail(x, y)
  if (!bubble) {
    const glow = Math.max(0, 1 - sdCircle(x, y, 60, 40, 0) / 150) * 0.25
    return [bg[0] + (255 - bg[0]) * glow, bg[1] + (255 - bg[1]) * glow, bg[2] + (255 - bg[2]) * glow, 255]
  }
  if (inSparkle(x, y, 128, 118, 34) || inSparkle(x, y, 164, 92, 12)) return [bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 255]
  return [255, 255, 255, 255]
}

function render() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3]
        }
      const a = acc[3] / (SS * SS)
      const o = y * (SIZE * 4 + 1) + 1 + x * 4
      raw[o] = a ? acc[0] / acc[3] : 0
      raw[o + 1] = a ? acc[1] / acc[3] : 0
      raw[o + 2] = a ? acc[2] / acc[3] : 0
      raw[o + 3] = Math.round(a)
    }
  }
  return raw
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(render(), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const addon = resolve(dirname(fileURLToPath(import.meta.url)), '../../claude_assistant')
writeFileSync(resolve(addon, 'icon.png'), png)
writeFileSync(resolve(addon, 'logo.png'), png)
console.log(`icon.png e logo.png scritti (${png.length} byte)`)
