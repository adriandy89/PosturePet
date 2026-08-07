'use strict';

/**
 * Comparar versiones. Puro y sin dependencias, para poder testearlo.
 *
 * Existe porque la comparacion evidente esta mal: como cadenas, '0.10.0' es
 * MENOR que '0.9.0', asi que la app se quedaria callada justo en la
 * actualizacion que mas importa -- la que cruza la decena.
 *
 * Regla que manda sobre todas: ante la duda, NO hay actualizacion. Un dato que
 * no se entiende no debe convertirse en un aviso de version nueva, porque
 * llevaria al usuario a descargar algo que a lo mejor no existe.
 */

/** 'v0.1.0', '0.1', '1.2.3-beta' -> [mayor, menor, parche]. null si no cuela. */
function parse(version) {
  if (typeof version !== 'string') return null;

  // Se ignora lo que venga detras del numero ('-beta', '+build'): distinguir
  // preversiones exigiria las reglas de precedencia enteras de semver para un
  // proyecto que no publica ninguna. Una preversion queda igual que su
  // version final, y por tanto no se anuncia como nueva.
  const match = version.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;

  return [match[1], match[2] ?? '0', match[3] ?? '0'].map(Number);
}

/**
 * -1 si a < b, 0 si son la misma, 1 si a > b. null si alguna no se entiende.
 */
function compare(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

/** Hay algo mas nuevo que lo que tengo instalado? */
const isNewer = (candidate, current) => compare(candidate, current) === 1;

module.exports = { parse, compare, isNewer };
