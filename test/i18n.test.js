'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const i18n = require('../src/shared/i18n.js');

/**
 * Un catalogo incompleto no rompe la app: las claves que faltan caen al
 * espanol y la ventana se queda medio traducida, que es peor que un fallo
 * ruidoso porque nadie lo nota hasta que lo ve un usuario. Estos tests son lo
 * unico que mantiene honestos a los catalogos.
 */

const FALLBACK = i18n.CATALOGS[i18n.FALLBACK];
const OTHERS = Object.entries(i18n.CATALOGS).filter(([code]) => code !== i18n.FALLBACK);

/** Todas las rutas de hoja: 'settings.alerts.title', 'notify.generic'... */
function paths(node, prefix = '') {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

const at = (obj, path) => path.split('.').reduce((n, k) => n?.[k], obj);

/** Los {marcadores} que espera una entrada, en orden alfabetico y sin repetir. */
function placeholders(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value);
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

test('todos los idiomas declaran su nombre en si mismos', () => {
  for (const [code, cat] of Object.entries(i18n.CATALOGS)) {
    assert.ok(cat.meta?.name, `${code} no declara meta.name`);
    assert.ok(cat.meta?.htmlLang, `${code} no declara meta.htmlLang`);
  }
});

test('ningun catalogo tiene claves de menos', () => {
  const esperadas = paths(FALLBACK);
  for (const [code, cat] of OTHERS) {
    const faltan = esperadas.filter((p) => at(cat, p) === undefined);
    assert.deepEqual(faltan, [], `a "${code}" le faltan claves`);
  }
});

test('ningun catalogo tiene claves de mas', () => {
  // Una clave que solo existe en un idioma es texto que nadie ve nunca, o peor:
  // una traduccion de algo que ya se renombro y quedo huerfano.
  const conocidas = new Set(paths(FALLBACK));
  for (const [code, cat] of OTHERS) {
    const sobran = paths(cat).filter((p) => !conocidas.has(p));
    assert.deepEqual(sobran, [], `"${code}" tiene claves que no existen en el idioma de reserva`);
  }
});

test('la forma de cada entrada coincide entre idiomas', () => {
  // Una lista traducida como cadena suelta hace que el notificador rote entre
  // los caracteres del texto en vez de entre variantes del mensaje.
  for (const p of paths(FALLBACK)) {
    const base = at(FALLBACK, p);
    for (const [code, cat] of OTHERS) {
      const otro = at(cat, p);
      assert.equal(
        Array.isArray(base), Array.isArray(otro),
        `"${p}" es lista en ${i18n.FALLBACK} pero no en ${code} (o al reves)`
      );
    }
  }
});

test('los marcadores sobreviven a la traduccion', () => {
  // Traducir '{s} s' como 'segundos' deja el dato fuera del mensaje sin que
  // nada falle: el texto sale, solo que sin el numero.
  for (const p of paths(FALLBACK)) {
    const esperados = placeholders(at(FALLBACK, p));
    for (const [code, cat] of OTHERS) {
      assert.deepEqual(
        placeholders(at(cat, p)), esperados,
        `"${p}" no usa los mismos marcadores en ${code}`
      );
    }
  }
});

test('t() interpola y no deja marcadores sin valor a la vista', () => {
  i18n.setLocale('es');
  assert.equal(i18n.t('status.bad', { s: 12 }), 'Postura mala desde hace 12 s.');
  // Un marcador sin valor se deja tal cual: se ve en pantalla y se arregla.
  assert.match(i18n.t('status.bad', {}), /\{s\}/);
});

test('una clave desconocida se devuelve tal cual, no vacia', () => {
  // Un hueco mudo en la interfaz es mucho mas dificil de localizar que ver
  // "settings.no.existe" escrito en la ventana.
  assert.equal(i18n.t('settings.no.existe'), 'settings.no.existe');
});

test('el idioma se resuelve desde el sistema y la eleccion manda', () => {
  assert.equal(i18n.resolve(null, 'en-GB'), 'en', 'sin eleccion, sigue al sistema');
  assert.equal(i18n.resolve('es', 'en-GB'), 'es', 'la eleccion explicita gana');
  assert.equal(i18n.resolve(null, 'fr-FR'), i18n.FALLBACK, 'idioma sin catalogo -> reserva');
  assert.equal(i18n.resolve('pt', 'en-US'), 'en', 'eleccion invalida -> sistema');
});

test('catalogFor rellena los huecos desde el idioma de reserva', () => {
  // Es lo que viaja a la ventana de ajustes: si llegase con huecos, el
  // renderer necesitaria su propia logica de reserva.
  const en = i18n.catalogFor('en');
  for (const p of paths(FALLBACK)) {
    assert.notEqual(at(en, p), undefined, `catalogFor('en') pierde "${p}"`);
  }
});

test('cambiar de idioma cambia lo que devuelve t()', () => {
  i18n.setLocale('en');
  const ingles = i18n.t('settings.profiles.add');
  i18n.setLocale('es');
  assert.notEqual(ingles, i18n.t('settings.profiles.add'));
});
