'use strict';

const { protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/**
 * Sirve los archivos de la app bajo `app://bundle/...` en vez de `file://`.
 *
 * No es cosmetico: MediaPipe carga su WASM con fetch(), y Chromium bloquea
 * fetch sobre file://. Un esquema propio marcado como `standard` y `secure`
 * se comporta como https a efectos de origen, asi que fetch funciona, el CSP
 * se puede escribir con 'self', y no hay que desactivar webSecurity.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEME = 'app';

/** Debe llamarse ANTES de app.whenReady(). */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true, // el .wasm se sirve por streaming
        corsEnabled: true,
      },
    },
  ]);
}

/** Debe llamarse DESPUES de app.whenReady(). */
function handleScheme() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const target = path.join(ROOT, decodeURIComponent(pathname));

    // Sin esto, `app://bundle/../../../Windows/...` leeria fuera del proyecto.
    const rel = path.relative(ROOT, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Ruta de la app -> URL cargable. */
const url = (relative) => `${SCHEME}://bundle/${relative.split(path.sep).join('/')}`;

const isAppUrl = (value) => typeof value === 'string' && value.startsWith(`${SCHEME}://`);

module.exports = { registerScheme, handleScheme, url, isAppUrl, SCHEME };
