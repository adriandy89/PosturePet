/**
 * Genera build/icon.png (512x512) con la silueta del personaje.
 *
 * Se dibuja en codigo por la misma razon que los iconos de bandeja: evita
 * meter binarios en el repo y mantiene el icono y el muneco en sintonia.
 * electron-builder convierte este PNG al .ico de Windows por su cuenta.
 */

import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');

const VERDE = [76, 175, 80];
const VERDE_OSCURO = [53, 122, 56];
const OJO = [23, 32, 42];

// ------------------------------------------------------------------ dibujo

/** Cobertura suavizada: 1 dentro, 0 fuera, rampa de `aa` px en el borde. */
const cover = (d, aa = 1.5) => Math.max(0, Math.min(1, 0.5 - d / aa));

const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

/** Distancia con signo a un rectangulo redondeado. */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - hw + r;
  const dy = Math.abs(y - cy) - hh + r;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const s = SIZE / 512;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Tronco: capsula ancha en la mitad inferior.
      const torso = sdRoundRect(x, y, 256 * s, 355 * s, 118 * s, 105 * s, 78 * s);
      // Cabeza: circulo grande, ligeramente solapado con el tronco.
      const head = sdCircle(x, y, 256 * s, 205 * s, 132 * s);
      const body = Math.min(torso, head);

      let r = 0, g = 0, b = 0, a = 0;

      const bodyA = cover(body, 2 * s);
      if (bodyA > 0) {
        // Degradado vertical suave para que no quede plano.
        const t = Math.min(1, Math.max(0, (y - 80 * s) / (380 * s)));
        r = VERDE[0] * (1 - t) + VERDE_OSCURO[0] * t;
        g = VERDE[1] * (1 - t) + VERDE_OSCURO[1] * t;
        b = VERDE[2] * (1 - t) + VERDE_OSCURO[2] * t;
        a = bodyA;
      }

      // Los ojos se pintan encima, mezclados por cobertura.
      const eyes = Math.min(
        sdCircle(x, y, 208 * s, 196 * s, 21 * s),
        sdCircle(x, y, 304 * s, 196 * s, 21 * s)
      );
      const eyeA = cover(eyes, 2 * s);
      if (eyeA > 0) {
        r = r * (1 - eyeA) + OJO[0] * eyeA;
        g = g * (1 - eyeA) + OJO[1] * eyeA;
        b = b * (1 - eyeA) + OJO[2] * eyeA;
        a = Math.max(a, eyeA);
      }

      const i = (y * SIZE + x) * 4;
      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// -------------------------------------------------------------------- PNG

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function toPng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  // 10, 11, 12 quedan a 0: compresion deflate, filtro estandar, sin entrelazar.

  // Cada linea va precedida de su byte de filtro; 0 = sin filtro.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const src = y * SIZE * 4;
    const dst = y * (SIZE * 4 + 1);
    raw[dst] = 0;
    pixels.copy(raw, dst + 1, src, src + SIZE * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(dirname(OUT), { recursive: true });
const png = toPng(render());
writeFileSync(OUT, png);
console.log(`  ok  build/icon.png  (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);
