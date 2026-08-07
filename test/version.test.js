'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, compare, isNewer } = require('../src/shared/version.js');
// updates.js desestructura electron, que fuera de Electron es una cadena: los
// campos salen undefined pero nadie los llama, y safeUrl es aritmetica de
// texto. Asi se puede testear la parte que importa sin arrancar la app.
const { safeUrl, RELEASES_PAGE } = require('../src/main/updates.js');

/**
 * El fallo que este archivo existe para impedir: comparar versiones como
 * cadenas. Con esa comparacion '0.10.0' es MENOR que '0.9.0', asi que la app
 * se quedaria callada justo en la actualizacion que mas importa.
 *
 * Y el segundo, mas sutil: anunciar una version nueva a partir de una respuesta
 * que no se ha entendido. Eso manda al usuario a descargar algo que a lo mejor
 * ni existe, y no hay forma de que se de cuenta.
 */

test('la decena se compara como numero, no como texto', () => {
  assert.equal(isNewer('0.10.0', '0.9.0'), true, 'alfabeticamente saldria al reves');
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
  assert.equal(isNewer('0.2.10', '0.2.9'), true);
});

test('el prefijo v es opcional y da igual como venga', () => {
  // Los tags de GitHub llevan 'v'; app.getVersion() no.
  assert.deepEqual(parse('v0.1.0'), [0, 1, 0]);
  assert.deepEqual(parse('0.1.0'), [0, 1, 0]);
  assert.deepEqual(parse('V2.3.4'), [2, 3, 4]);
  assert.equal(compare('v1.2.3', '1.2.3'), 0);
});

test('las versiones incompletas se rellenan con ceros', () => {
  assert.deepEqual(parse('1'), [1, 0, 0]);
  assert.deepEqual(parse('1.2'), [1, 2, 0]);
  assert.equal(compare('1.2', '1.2.0'), 0);
  assert.equal(isNewer('1.2.1', '1.2'), true);
});

test('la misma version no es una actualizacion', () => {
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
  assert.equal(compare('0.1.0', '0.1.0'), 0);
});

test('una version anterior tampoco lo es', () => {
  // Pasa de verdad: instalar una compilacion mas nueva que la ultima release.
  assert.equal(isNewer('0.1.0', '0.2.0'), false);
  assert.equal(compare('0.1.0', '0.2.0'), -1);
});

test('una preversion no se anuncia como version nueva', () => {
  // Distinguirlas exigiria las reglas de precedencia enteras de semver para un
  // proyecto que no publica ninguna; quedan igual que su version final.
  assert.deepEqual(parse('1.2.3-beta.1'), [1, 2, 3]);
  assert.equal(isNewer('1.2.3-beta', '1.2.3'), false);
});

test('ante la duda NO hay actualizacion', () => {
  // La regla que manda sobre todas. Cualquier basura debe callar, no avisar.
  for (const basura of [null, undefined, '', '   ', 'latest', 'v', {}, 42, [], 'no-soy-una-version']) {
    assert.equal(isNewer(basura, '0.1.0'), false, `candidato ${JSON.stringify(basura)}`);
    assert.equal(isNewer('9.9.9', basura), false, `actual ${JSON.stringify(basura)}`);
    assert.equal(compare(basura, '0.1.0'), null, `compare ${JSON.stringify(basura)}`);
  }
});

/**
 * La URL que se abre en el navegador viene de la RED. shell.openExternal no
 * solo abre paginas web, asi que aceptarla sin comprobar seria dejar que la
 * respuesta de un servidor decida que se ejecuta en el equipo del usuario.
 */
test('solo se abren URLs del repositorio del proyecto', () => {
  const buena = 'https://github.com/adriandy89/PosturePet/releases/tag/v0.2.0';
  assert.equal(safeUrl(buena), buena);
});

test('cualquier otra URL cae a la pagina de versiones', () => {
  for (const hostil of [
    'https://github.com/otro/repo/releases',
    'https://github.com.evil.example/adriandy89/PosturePet/',
    'https://evil.example.com/adriandy89/PosturePet/',
    'http://github.com/adriandy89/PosturePet/', // sin TLS
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    42,
    { toString: () => 'https://github.com/adriandy89/PosturePet/' },
  ]) {
    assert.equal(safeUrl(hostil), RELEASES_PAGE, JSON.stringify(String(hostil)));
  }
});

test('parse devuelve null en vez de un array con NaN', () => {
  // Un NaN dentro del array no falla: hace que todas las comparaciones den
  // false y la version nueva no se anuncie nunca, sin decir por que.
  assert.equal(parse('abc'), null);
  assert.equal(parse(undefined), null);
  for (const bueno of ['1.2.3', 'v0.0.1']) {
    assert.ok(parse(bueno).every(Number.isInteger), bueno);
  }
});
