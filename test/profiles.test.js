'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/main/profiles.js');

const BASE_A = { eyeWidth: 0.14, neckLength: 2.1 };
const BASE_B = { eyeWidth: 0.11, neckLength: 2.6 };

const fresh = () => P.normalize({});

test('sin nada guardado se arranca con un perfil por defecto', () => {
  const s = fresh();
  assert.equal(s.profiles.length, 1);
  assert.equal(s.activeProfileId, s.profiles[0].id);
  assert.equal(P.baselineOf(s), null);
});

test('migra la base suelta de las versiones anteriores a los perfiles', () => {
  // Antes de los perfiles la base era un campo de primer nivel. Perderla al
  // actualizar obligaria a recalibrar sin explicacion.
  const s = P.normalize({ baseline: BASE_A });
  assert.equal(s.profiles.length, 1);
  assert.deepEqual(P.baselineOf(s), BASE_A);
});

test('un settings.json corrupto no deja la app sin perfiles', () => {
  for (const roto of [
    { profiles: [] },
    { profiles: 'no soy un array' },
    { profiles: [null, { sinId: true }] },
    { profiles: null, activeProfileId: 'fantasma' },
  ]) {
    const s = P.normalize(roto);
    assert.ok(s.profiles.length >= 1, 'siempre queda al menos uno');
    assert.ok(s.profiles.some((p) => p.id === s.activeProfileId), 'y el activo existe');
  }
});

test('un activeProfileId que no existe se corrige solo', () => {
  const s = P.normalize({
    profiles: [{ id: 'a', name: 'A', baseline: null }],
    activeProfileId: 'borrado-hace-tiempo',
  });
  assert.equal(s.activeProfileId, 'a');
});

test('crear un perfil lo deja activo, porque toca calibrarlo', () => {
  const s = P.add(fresh(), 'Portatil', 'p2', 1000);
  assert.equal(s.profiles.length, 2);
  assert.equal(s.activeProfileId, 'p2');
  assert.equal(P.find(s).name, 'Portatil');
  assert.equal(P.baselineOf(s), null, 'nace sin calibrar');
});

test('un nombre vacio recibe uno automatico', () => {
  assert.match(P.find(P.add(fresh(), '   ', 'p2', 0)).name, /^Perfil \d+$/);
});

test('calibrar solo toca el perfil activo', () => {
  let s = P.withBaseline(fresh(), BASE_A, 100);
  s = P.add(s, 'Mesa alta', 'p2', 200);
  s = P.withBaseline(s, BASE_B, 300);

  const escritorio = s.profiles.find((p) => p.id === 'default');
  const mesaAlta = s.profiles.find((p) => p.id === 'p2');
  assert.deepEqual(escritorio.baseline, BASE_A, 'el otro perfil no se toca');
  assert.deepEqual(mesaAlta.baseline, BASE_B);
  assert.equal(mesaAlta.calibratedAt, 300);
});

test('cambiar de perfil cambia la base que se usa', () => {
  // Es el motivo entero de que existan los perfiles: un clic y la referencia
  // pasa a ser la del montaje en el que estas sentado ahora.
  let s = P.withBaseline(fresh(), BASE_A, 100);
  s = P.withBaseline(P.add(s, 'Portatil', 'p2', 200), BASE_B, 300);

  assert.deepEqual(P.baselineOf(s), BASE_B);
  assert.deepEqual(P.baselineOf(P.activate(s, 'default')), BASE_A);
});

test('activar un perfil inexistente no rompe el estado', () => {
  const s = fresh();
  assert.deepEqual(P.activate(s, 'no-existe'), s);
});

test('renombrar respeta los nombres vacios', () => {
  const s = P.rename(fresh(), 'default', '  Mesa del salon  ');
  assert.equal(P.find(s).name, 'Mesa del salon', 'se recortan los espacios');
  assert.equal(P.find(P.rename(s, 'default', '   ')).name, 'Mesa del salon', 'vacio se ignora');
});

test('no se puede borrar el ultimo perfil', () => {
  const s = fresh();
  assert.deepEqual(P.remove(s, s.activeProfileId), s, 'siempre queda uno');
});

test('borrar el perfil activo pasa el testigo a otro', () => {
  let s = P.add(fresh(), 'Portatil', 'p2', 100);
  s = P.remove(s, 'p2');
  assert.equal(s.profiles.length, 1);
  assert.equal(s.activeProfileId, 'default', 'el activo sigue existiendo');
});

test('borrar un perfil que no es el activo no cambia el activo', () => {
  let s = P.add(fresh(), 'Portatil', 'p2', 100); // p2 queda activo
  s = P.remove(s, 'default');
  assert.equal(s.activeProfileId, 'p2');
});

test('cada perfil conserva su calibracion al ir y volver', () => {
  let s = P.withBaseline(fresh(), BASE_A, 100);
  s = P.withBaseline(P.add(s, 'Portatil', 'p2', 200), BASE_B, 300);

  s = P.activate(s, 'default');
  s = P.activate(s, 'p2');
  s = P.activate(s, 'default');

  assert.deepEqual(P.baselineOf(s), BASE_A, 'nada se ha mezclado por el camino');
});
