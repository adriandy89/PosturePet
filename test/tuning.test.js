'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const T = require('../src/main/tuning.js');

/**
 * settings.json es un archivo de texto en el perfil del usuario, y cada
 * deslizador nuevo es una oportunidad mas de guardar algo absurdo. Lo que se
 * comprueba aqui no es que sanitize() recorte -- eso es evidente -- sino que
 * ningun ajuste se quede fuera de sus redes: sin limites, sin grupo de
 * restauracion, o con un rango que no contiene su propio valor de fabrica.
 */

test('cada valor de fabrica cae dentro de su propio rango', () => {
  // Un defecto fuera de rango significa que la app arranca ya recortada, con
  // un deslizador que no puede volver a donde estaba.
  for (const [key, [min, max]] of Object.entries(T.LIMITS)) {
    const value = T.DEFAULTS[key];
    assert.equal(typeof value, 'number', `${key} no tiene valor por defecto numerico`);
    assert.ok(value >= min && value <= max, `${key} = ${value} esta fuera de [${min}, ${max}]`);
  }
});

test('todo ajuste con limites pertenece a algun grupo de restauracion', () => {
  // Es el fallo silencioso que este archivo viene a evitar: anadir un ajuste,
  // olvidar meterlo en su grupo, y quedarte con un boton "Restaurar" que
  // restaura casi todo.
  const agrupados = new Set(Object.values(T.RESET_GROUPS).flat());
  const huerfanos = Object.keys(T.LIMITS).filter((k) => !agrupados.has(k));
  assert.deepEqual(huerfanos, [], 'estos ajustes no los restaura ningun boton');
});

test('ningun grupo nombra un ajuste inexistente', () => {
  const conocidos = new Set([...Object.keys(T.LIMITS), 'alerts']);
  for (const [grupo, claves] of Object.entries(T.RESET_GROUPS)) {
    for (const clave of claves) {
      assert.ok(conocidos.has(clave), `el grupo "${grupo}" nombra "${clave}", que ya no existe`);
    }
  }
});

test('ningun ajuste esta en dos grupos a la vez', () => {
  // Restaurar una seccion no debe mover deslizadores de otra pestana.
  const vistos = new Set();
  for (const clave of Object.values(T.RESET_GROUPS).flat()) {
    assert.ok(!vistos.has(clave), `"${clave}" aparece en mas de un grupo`);
    vistos.add(clave);
  }
});

test('los valores fuera de rango se recortan', () => {
  const s = T.sanitize({ ...T.DEFAULTS, dwellMs: 999_999, sensitivity: -3 });
  assert.equal(s.dwellMs, T.LIMITS.dwellMs[1]);
  assert.equal(s.sensitivity, T.LIMITS.sensitivity[0]);
});

test('la basura vuelve al valor de fabrica, nunca a NaN', () => {
  // NaN es el peor caso posible: no falla, solo hace que todas las
  // comparaciones den false y la app deje de avisar sin decir por que.
  for (const basura of [undefined, null, 'diez', {}, NaN, Infinity]) {
    const s = T.sanitize({ ...T.DEFAULTS, dwellMs: basura });
    assert.equal(s.dwellMs, T.DEFAULTS.dwellMs, `dwellMs = ${String(basura)}`);
  }
});

test('el umbral de salida se mantiene por encima del de entrada', () => {
  // Invertidos, la histeresis deja de existir y el estado oscila en cada frame.
  const s = T.sanitize({ ...T.DEFAULTS, enterBadBelow: 80, exitBadAbove: 40 });
  assert.ok(s.exitBadAbove >= s.enterBadBelow + T.MIN_HYSTERESIS_GAP);
});

test('subir el umbral de entrada arrastra al de salida', () => {
  const s = T.sanitize({ ...T.DEFAULTS, enterBadBelow: 90, exitBadAbove: 70 });
  assert.ok(s.exitBadAbove > 90, 'el de salida sube con el de entrada');
  assert.ok(s.exitBadAbove <= T.LIMITS.exitBadAbove[1], 'sin salirse de su propio rango');
});

test('un idioma sin catalogo vuelve a seguir al sistema', () => {
  assert.equal(T.sanitize({ ...T.DEFAULTS, locale: 'kl' }).locale, null);
  assert.equal(T.sanitize({ ...T.DEFAULTS, locale: 'en' }).locale, 'en');
  assert.equal(T.sanitize({ ...T.DEFAULTS, locale: 'es-MX' }).locale, 'es', 'se normaliza');
});

test('restaurar un grupo solo toca ese grupo', () => {
  const patch = T.resetPatch('sound');
  assert.deepEqual(Object.keys(patch).sort(), [...T.RESET_GROUPS.sound].sort());
  assert.equal(patch.soundVolume, T.DEFAULTS.soundVolume);
});

test('restaurar sin grupo devuelve todo lo restaurable', () => {
  const patch = T.resetPatch();
  for (const key of Object.keys(T.LIMITS)) {
    assert.ok(key in patch, `${key} no se restaura`);
  }
});

test('restaurar no toca perfiles, calibracion ni idioma', () => {
  // Perder la calibracion por haber tocado un deslizador seria un castigo
  // desproporcionado, y el idioma no es un "valor por defecto" recuperable.
  const patch = T.resetPatch();
  for (const intocable of ['profiles', 'activeProfileId', 'locale', 'cameraId',
    'mascotPosition', 'autoStart']) {
    assert.ok(!(intocable in patch), `restaurar no debe tocar "${intocable}"`);
  }
});

test('un grupo desconocido no restaura nada', () => {
  assert.equal(T.resetPatch('inventado'), null);
});

test('restaurar alerts devuelve una copia, no la referencia congelada', () => {
  // DEFAULTS.alerts esta congelado; devolverlo tal cual haria que el primer
  // toggle fallase en silencio (o lanzase en modo estricto).
  const patch = T.resetPatch('alerts');
  patch.alerts.tray = false;
  assert.equal(T.DEFAULTS.alerts.tray, true, 'los valores de fabrica siguen intactos');
});
