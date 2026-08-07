import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { AVATARS, DEFAULT_AVATAR, avatarSvg, isKnownAvatar } from '../src/renderer/avatars.mjs';

const require = createRequire(import.meta.url);
const i18n = require('../src/shared/i18n.js');

/**
 * Los personajes son datos, no codigo: no hay nada que ejecutar y por tanto
 * nada que falle de forma ruidosa. Un avatar al que le falte una pieza
 * simplemente aparece sin ojos, o tieso, o encorvandose desde el ombligo -- y
 * eso no se descubre hasta que alguien lo elige.
 *
 * Estos tests son lo unico que impide que anadir el septimo personaje rompa
 * el contrato de coordenadas que documenta avatars.mjs.
 */

const svgs = AVATARS.map((a) => ({ id: a.id, svg: avatarSvg(a.id) }));

test('cada personaje tiene un id distinto', () => {
  const ids = AVATARS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('el que viene de fabrica existe y va primero', () => {
  assert.ok(isKnownAvatar(DEFAULT_AVATAR));
  // Quien no quiera elegir no deberia tener que buscarlo.
  assert.equal(AVATARS[0].id, DEFAULT_AVATAR);
});

test('hay elenco de sobra para que elegir tenga sentido', () => {
  assert.ok(AVATARS.length >= 5, `solo hay ${AVATARS.length}`);
});

test('un personaje desconocido cae al de fabrica en vez de dejar el hueco', () => {
  // Pasa de verdad: un settings.json con un avatar que se retiro en una
  // version posterior. Sin esto, la ventana del personaje se queda en blanco.
  assert.equal(isKnownAvatar('unicornio'), false);
  assert.equal(avatarSvg('unicornio'), avatarSvg(DEFAULT_AVATAR));
  assert.equal(avatarSvg(undefined), avatarSvg(DEFAULT_AVATAR));
});

test('todos comparten el mismo sistema de coordenadas', () => {
  // El CSS que los anima esta escrito en numeros absolutos. Otro viewBox
  // significa que la cabeza pivota donde no debe.
  for (const { id, svg } of svgs) {
    assert.match(svg, /viewBox="0 0 120 140"/, id);
  }
});

test('la sombra y el grupo que se inclina los pone el envoltorio', () => {
  // Si cada personaje tuviera que acordarse, uno se olvidaria y se quedaria
  // tieso mientras los demas respiran.
  for (const { id, svg } of svgs) {
    assert.match(svg, /class="shadow"/, id);
    assert.match(svg, /<g class="creature">/, id);
  }
});

test('a ninguno le falta una pieza que el CSS da por hecha', () => {
  const REQUIRED = ['head', 'face', 'eye-group', 'eye', 'pupil', 'mouth', 'brows'];
  for (const { id, svg } of svgs) {
    for (const piece of REQUIRED) {
      assert.match(svg, new RegExp(`class="[^"]*\\b${piece}\\b`), `${id} no tiene .${piece}`);
    }
  }
});

test('todos tienen dos ojos, y donde toca', () => {
  // El parpadeo aplasta cada ojo sobre su centro, y ese centro esta escrito a
  // mano en avatar.css. Un ojo desplazado parpadearia por la oreja.
  for (const { id, svg } of svgs) {
    assert.equal((svg.match(/class="eye"/g) ?? []).length, 2, `${id}: no hay dos ojos`);
    assert.equal((svg.match(/class="pupil"/g) ?? []).length, 2, `${id}: no hay dos pupilas`);
    assert.match(svg, /class="eye" cx="49" cy="40"/, `${id}: ojo izquierdo fuera de sitio`);
    assert.match(svg, /class="eye" cx="71" cy="40"/, `${id}: ojo derecho fuera de sitio`);
  }
});

test('todos traen las piezas de los estados de pausa y sin vista', () => {
  for (const { id, svg } of svgs) {
    assert.match(svg, /class="sweat"/, `${id}: sin gota de sudor`);
    assert.match(svg, /class="zzz"/, `${id}: sin zZz para la pausa`);
    assert.match(svg, /class="lost"/, `${id}: sin interrogacion para cuando no te ve`);
  }
});

test('NINGUN personaje usa id: solo clases', () => {
  // La regla que mas facil se rompe y peor se nota. La ventana de ajustes
  // pinta los seis a la vez; un id repetido seis veces solo le aplicaria al
  // primero y el resto se quedarian sin cara, sin que nada falle.
  for (const { id, svg } of svgs) {
    const ids = svg.match(/\sid="[^"]*"/g) ?? [];
    assert.deepEqual(ids, [], `${id} usa ids: ${ids.join(', ')}`);
  }
});

test('el SVG no lleva estilos en linea', () => {
  // El CSP de la ventana de ajustes es `style-src 'self'` sin unsafe-inline:
  // un atributo style se bloquearia y la pieza se veria en negro.
  for (const { id, svg } of svgs) {
    assert.doesNotMatch(svg, /\sstyle="/, `${id} lleva un atributo style`);
  }
});

test('el color sale siempre de la paleta, nunca escrito a mano', () => {
  // Todo pasa por --tone para que cambiar de estado sea cambiar una variable.
  // Un relleno fijo se quedaria verde con la postura ya en rojo.
  const PERMITIDOS = ['#7ec8f5', '#ffd54f']; // gota de sudor y chispa del robot
  for (const { id, svg } of svgs) {
    const colores = (svg.match(/#[0-9a-fA-F]{3,6}/g) ?? []).filter((c) => !PERMITIDOS.includes(c));
    assert.deepEqual(colores, [], `${id} tiene colores fijos: ${colores.join(', ')}`);
  }
});

test('cada personaje tiene nombre y descripcion en todos los idiomas', () => {
  // Sin entrada en el catalogo, la tarjeta mostraria "settings.avatar.names.gato".
  for (const [code, cat] of Object.entries(i18n.CATALOGS)) {
    for (const { id } of AVATARS) {
      assert.equal(typeof cat.settings?.avatar?.names?.[id], 'string',
        `falta el nombre de "${id}" en ${code}`);
      assert.equal(typeof cat.settings?.avatar?.notes?.[id], 'string',
        `falta la descripcion de "${id}" en ${code}`);
    }
  }
});

test('el catalogo no describe personajes que ya no existen', () => {
  const conocidos = new Set(AVATARS.map((a) => a.id));
  for (const [code, cat] of Object.entries(i18n.CATALOGS)) {
    for (const key of Object.keys(cat.settings.avatar.names)) {
      assert.ok(conocidos.has(key), `"${key}" ya no es un personaje (catalogo ${code})`);
    }
  }
});
