'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');

const AVATAR_CSS = read('avatar.css');
const SETTINGS_HTML = read('settings.html');

/**
 * avatar.css se carga ENTERO dentro de la ventana de ajustes, para que la
 * rejilla de seleccion ensene exactamente lo que se vera despues.
 *
 * El precio es que sus clases son palabras corrientes -- `head`, `face`,
 * `panel`, `shadow` -- sueltas en un documento que tiene las suyas. Ya paso:
 * cada pestana de ajustes es un `<div class="panel">`, y una regla
 * `.panel path { fill: none }` escrita para el pecho del robot dejo huecos los
 * cuerpos de los seis avatares. No fallo nada, no hubo error en consola; solo
 * se veian mal, y eso solo se descubre mirando.
 *
 * De ahi la regla: todo selector de avatar.css empieza por `.pet`.
 */

/** Quita comentarios y bloques, y deja la lista de selectores. */
function selectors(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/@media[^{]*\{/g, '')
    .split('}')
    .map((block) => block.split('{')[0].trim())
    .filter(Boolean)
    .flatMap((group) => group.split(',').map((s) => s.trim()))
    .filter((s) => s && !s.startsWith('@') && !/^\d/.test(s));
}

test('todo selector de avatar.css esta encerrado bajo .pet', () => {
  const sueltos = selectors(AVATAR_CSS).filter((s) => !s.startsWith('.pet'));
  assert.deepEqual(sueltos, [], 'estas reglas escapan a la ventana de ajustes');
});

test('ninguna clase de avatar.css colisiona con las de la ventana de ajustes', () => {
  // Cinturon ademas de tirantes: aunque el aislamiento las contenga, compartir
  // nombre entre el pecho del robot y las pestanas de ajustes hace el CSS
  // ilegible para quien venga despues.
  // Sin comentarios: ahi se nombran clases justamente para explicar por que NO
  // se usan, y contarlas convertiria la explicacion en el fallo.
  const css = AVATAR_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const enAvatares = new Set(
    [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1])
      .filter((c) => c !== 'pet' && !c.startsWith('state-') && !c.startsWith('avatar-'))
  );
  const enAjustes = new Set(
    [...SETTINGS_HTML.matchAll(/class="([^"]+)"/g)]
      .flatMap((m) => m[1].split(/\s+/))
      // Las tarjetas de la rejilla llevan `pet` y `avatar-<id>` a proposito.
      .filter((c) => c && c !== 'pet' && !c.startsWith('avatar-'))
  );

  const chocan = [...enAvatares].filter((c) => enAjustes.has(c));
  assert.deepEqual(chocan, [], 'mismo nombre de clase en los dos sitios');
});

test('avatar.css no usa ids', () => {
  // En la rejilla hay seis personajes a la vez: un id repetido solo le
  // aplicaria al primero y los demas se quedarian sin cara.
  const ids = selectors(AVATAR_CSS).filter((s) => s.includes('#'));
  assert.deepEqual(ids, []);
});

test('la ventana del personaje y la de ajustes cargan el mismo CSS', () => {
  // Si una de las dos se lo saltara, la miniatura ensenaria algo distinto del
  // personaje que acabas de elegir.
  for (const file of ['mascot.html', 'settings.html']) {
    assert.match(read(file), /href="\.\/avatar\.css"/, `${file} no carga avatar.css`);
  }
});
