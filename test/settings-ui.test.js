'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../src/shared/i18n.js');
const tuning = require('../src/main/tuning.js');

/**
 * La ventana de ajustes no se puede montar en un test (no hay DOM ni Electron),
 * y sus fallos tipicos no hacen ruido: un id renombrado deja un boton muerto,
 * una clave de traduccion mal escrita deja "settings.foo.bar" escrito en
 * pantalla, y un deslizador sin limites llega hasta un valor que el backend
 * recorta despues.
 *
 * Nada de eso lanza una excepcion. Asi que se cruzan los tres archivos como
 * texto: es lo unico que separa un renombrado descuidado de un boton que no
 * hace nada.
 */

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', p), 'utf8');

const HTML = read('settings.html');
const MJS = read('settings.mjs');

const HTML_IDS = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const at = (obj, keyPath) => keyPath.split('.').reduce((n, k) => n?.[k], obj);

test('todo $(id) del script existe en el HTML', () => {
  for (const [, id] of MJS.matchAll(/\$\('([^']+)'\)/g)) {
    // Los ids compuestos ($(`${id}-out`)) se comprueban con los deslizadores,
    // mas abajo: aqui solo entran los literales.
    assert.ok(HTML_IDS.has(id), `settings.mjs busca #${id}, que no esta en settings.html`);
  }
});

test('todo id que el script compone para las pestanas existe', () => {
  // selectTab() arma `tab-${id}` y `panel-${id}` a partir de la lista TABS.
  const tabs = MJS.match(/const TABS = \[([^\]]+)\]/)[1]
    .split(',')
    .map((s) => s.trim().replace(/'/g, ''))
    .filter(Boolean);

  assert.ok(tabs.length >= 2, 'deberia haber varias pestanas');
  for (const tab of tabs) {
    assert.ok(HTML_IDS.has(`tab-${tab}`), `falta el boton #tab-${tab}`);
    assert.ok(HTML_IDS.has(`panel-${tab}`), `falta el panel #panel-${tab}`);
  }
});

test('cada deslizador tiene su <output> y una clave de ajustes real', () => {
  const conocidas = new Set(Object.keys(tuning.DEFAULTS));
  const enlazados = [...MJS.matchAll(/bindSlider\('([^']+)',\s*'([^']+)'/g)];

  assert.ok(enlazados.length > 10, 'se esperaban bastantes deslizadores');

  for (const [, id, key] of enlazados) {
    assert.ok(HTML_IDS.has(id), `el deslizador #${id} no esta en el HTML`);
    // Sin el <output>, bindSlider peta al pintar el valor.
    assert.ok(HTML_IDS.has(`${id}-out`), `al deslizador #${id} le falta su <output id="${id}-out">`);
    assert.ok(conocidas.has(key), `#${id} escribe en "${key}", que no es un ajuste`);
    assert.ok(tuning.LIMITS[key], `"${key}" no tiene rango en LIMITS: el deslizador no tendria min/max`);
  }
});

test('todo ajuste con rango tiene deslizador en la ventana', () => {
  // Al reves: un ajuste con limites que nadie puede tocar es un rango escrito
  // para nada, y contradice que "todo se configura desde la ventana".
  const enlazadas = new Set([...MJS.matchAll(/bindSlider\('[^']+',\s*'([^']+)'/g)].map((m) => m[1]));
  const sinControl = Object.keys(tuning.LIMITS).filter((k) => !enlazadas.has(k));
  assert.deepEqual(sinControl, [], 'estos ajustes no se pueden cambiar desde la ventana');
});

test('cada grupo de restauracion tiene su boton, y cada boton su grupo', () => {
  const enHtml = new Set([...HTML.matchAll(/data-reset="([^"]+)"/g)].map((m) => m[1]));
  const enCodigo = new Set(Object.keys(tuning.RESET_GROUPS));

  for (const grupo of enCodigo) {
    assert.ok(enHtml.has(grupo), `el grupo "${grupo}" no tiene boton de restaurar`);
  }
  for (const grupo of enHtml) {
    assert.ok(enCodigo.has(grupo), `el boton data-reset="${grupo}" no corresponde a ningun grupo`);
  }
});

test('cada interruptor data-alert corresponde a una alerta real', () => {
  const enHtml = [...HTML.matchAll(/data-alert="([^"]+)"/g)].map((m) => m[1]);
  const reales = Object.keys(tuning.DEFAULTS.alerts);

  assert.deepEqual([...enHtml].sort(), [...reales].sort(),
    'los interruptores del HTML y las alertas de tuning.js no coinciden');
});

test('todas las claves de traduccion del HTML existen en los catalogos', () => {
  const claves = [...HTML.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(claves.length > 40, 'el HTML deberia estar entero traducido');

  for (const [code, cat] of Object.entries(i18n.CATALOGS)) {
    for (const clave of claves) {
      assert.equal(typeof at(cat, clave), 'string',
        `falta "${clave}" en el catalogo "${code}"`);
    }
  }
});

test('todas las claves que usa el script existen en los catalogos', () => {
  // Solo las literales: las compuestas (`metrics.${key}`) las cubre
  // messages.test.mjs, que cruza METRICS contra los catalogos.
  const claves = [...MJS.matchAll(/\bt\('([a-z][\w.]+)'/gi)].map((m) => m[1]);
  assert.ok(claves.length > 20, 'se esperaban bastantes textos traducidos');

  for (const [code, cat] of Object.entries(i18n.CATALOGS)) {
    for (const clave of claves) {
      assert.notEqual(at(cat, clave), undefined, `falta "${clave}" en el catalogo "${code}"`);
    }
  }
});

test('el HTML no lleva texto suelto sin traducir', () => {
  // Un <button>Guardar</button> escrito a mano se queda en espanol para
  // siempre, y no falla nada. Los unicos textos literales admitidos son el
  // nombre propio de la app.
  const sueltos = [...HTML.matchAll(/<(h1|h2|p|button|label|strong|em)\b([^>]*)>([^<]+)</g)]
    .filter(([, , attrs, text]) => text.trim() && !/data-i18n/.test(attrs))
    .map(([, tag, , text]) => `<${tag}>${text.trim()}`)
    .filter((s) => !s.includes('PosturePet'));

  assert.deepEqual(sueltos, [], 'estos textos no pasan por el catalogo');
});
