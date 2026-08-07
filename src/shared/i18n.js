'use strict';

/**
 * Traduccion. Un solo catalogo por idioma, compartido por los dos lados:
 *
 *   proceso principal  ->  require('../shared/i18n.js') y t() directo
 *   renderers          ->  reciben el catalogo ya resuelto por IPC
 *
 * Los renderers NO cargan archivos de idioma. Su Content-Security-Policy es
 * `default-src 'none'`, asi que un fetch() del catalogo exigiria abrir
 * connect-src; y un import() dinamico obligaria a duplicar los catalogos en
 * ESM. Mandarlos por IPC evita las dos cosas y garantiza que main y renderer
 * nunca discrepan sobre que idioma esta activo.
 *
 * ANADIR UN IDIOMA
 *   1. Copiar locales/en.js a locales/<codigo>.js y traducir los valores.
 *   2. Anadirlo a CATALOGS aqui debajo.
 * Nada mas: el desplegable de ajustes se construye desde available().
 */

const CATALOGS = {
  es: require('./locales/es.js'),
  en: require('./locales/en.js'),
};

/**
 * Idioma de ultimo recurso. Es tambien la referencia de completitud: una clave
 * que falte en otro catalogo se sirve desde aqui en vez de dejar la interfaz
 * con huecos. El test de i18n comprueba que ninguno se quede corto.
 */
const FALLBACK = 'es';

let current = FALLBACK;

const has = (code) => Object.prototype.hasOwnProperty.call(CATALOGS, code);

/** Para el desplegable: cada idioma se nombra EN SI MISMO, nunca traducido. */
const available = () =>
  Object.entries(CATALOGS).map(([code, cat]) => ({ code, name: cat.meta.name }));

/** 'es-ES', 'ES_es' -> 'es'. Devuelve null si no hay catalogo para el. */
function normalizeCode(code) {
  if (typeof code !== 'string' || !code) return null;
  const base = code.toLowerCase().split(/[-_]/)[0];
  return has(base) ? base : null;
}

/**
 * Que idioma usar. `preferred` es la eleccion explicita del usuario y manda;
 * null significa "seguir al sistema", que es lo que hace un recien instalado.
 */
const resolve = (preferred, systemLocale) =>
  normalizeCode(preferred) ?? normalizeCode(systemLocale) ?? FALLBACK;

function setLocale(code) {
  current = has(code) ? code : FALLBACK;
  return current;
}

const locale = () => current;

/** Recorre 'settings.alerts.title' sobre el objeto anidado. */
function lookup(catalog, key) {
  let node = catalog;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

const raw = (key, code = current) =>
  lookup(CATALOGS[code] ?? {}, key) ?? lookup(CATALOGS[FALLBACK], key);

/** Sustituye {nombre} por su valor. Un marcador sin valor se deja tal cual. */
function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

/**
 * Traduce. Si la clave no existe en ningun catalogo se devuelve la clave: en
 * pantalla se ve "settings.foo.bar", que es feo pero localizable de un vistazo.
 * Devolver una cadena vacia dejaria un hueco mudo, mucho peor de diagnosticar.
 */
function t(key, vars) {
  const value = raw(key);
  return typeof value === 'string' ? interpolate(value, vars) : key;
}

/** Variantes de un mismo aviso (el notificador rota entre ellas). */
function list(key) {
  const value = raw(key);
  return Array.isArray(value) ? value : [];
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Mezcla profunda: lo que falte en `over` se hereda de `base`. */
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = isObject(v) && isObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/**
 * El catalogo completo de un idioma, ya con los huecos rellenos desde el de
 * reserva. Es lo que viaja a los renderers: asi el lado del navegador se limita
 * a buscar claves, sin logica de fallback duplicada.
 */
const catalogFor = (code = current) =>
  code === FALLBACK
    ? CATALOGS[FALLBACK]
    : deepMerge(CATALOGS[FALLBACK], CATALOGS[code] ?? {});

module.exports = {
  FALLBACK,
  CATALOGS,
  available,
  normalizeCode,
  resolve,
  setLocale,
  locale,
  t,
  list,
  raw,
  catalogFor,
};
