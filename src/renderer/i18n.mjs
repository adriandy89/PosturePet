/**
 * Lado del navegador de la traduccion.
 *
 * No carga nada: el catalogo llega ya resuelto desde el proceso principal (ver
 * src/shared/i18n.js). Aqui solo se busca por clave y se aplica al DOM.
 *
 * En el HTML, cada texto lleva su clave en un atributo:
 *
 *   <h2 data-i18n="settings.alerts.title"></h2>
 *   <input data-i18n-placeholder="settings.profiles.namePlaceholder" />
 *   <button data-i18n-title="settings.sound.test"></button>
 *
 * Asi el HTML se queda sin una sola cadena traducible y cambiar de idioma es
 * volver a recorrerlo, sin reconstruir nada.
 */

let catalog = {};

export function setCatalog(next) {
  catalog = next ?? {};
}

function lookup(key) {
  let node = catalog;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Traduce. Si la clave no existe se devuelve la clave misma: en pantalla se ve
 * "settings.foo.bar", que es feo pero se localiza de un vistazo. Una cadena
 * vacia dejaria un hueco mudo, mucho peor de diagnosticar.
 */
export function t(key, vars) {
  const value = lookup(key);
  if (typeof value !== 'string') return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

/** Aplica las claves del DOM. Idempotente: se puede llamar en cada cambio. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
}

/** El idioma tambien es informacion para el navegador: guiones, lectores... */
export function applyHtmlLang(lang) {
  if (lang) document.documentElement.lang = lang;
}
