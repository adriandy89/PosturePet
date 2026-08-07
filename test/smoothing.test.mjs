import test from 'node:test';
import assert from 'node:assert/strict';

import { EMA, GlanceGate } from '../src/renderer/smoothing.mjs';

// ------------------------------------------------------------------ EMA

test('el primer frame se adopta tal cual, sin arrancar desde cero', () => {
  // Si el EMA empezase en 0, el score entraria subiendo desde "postura
  // pesima" durante el primer segundo cada vez que recalibras.
  const ema = new EMA(0.25);
  assert.deepEqual(ema.update({ a: 10 }), { a: 10 });
});

test('converge hacia el valor de entrada', () => {
  const ema = new EMA(0.25);
  ema.update({ a: 0 });
  for (let i = 0; i < 50; i++) ema.update({ a: 10 });
  assert.ok(Math.abs(ema.state.a - 10) < 0.01);
});

test('cada metrica puede tener su propia velocidad', () => {
  // Las metricas de angulo van mas lentas porque sus landmarks tiemblan mas.
  const ema = new EMA({ rapida: 0.5, lenta: 0.08 });
  ema.update({ rapida: 0, lenta: 0 });
  for (let i = 0; i < 4; i++) ema.update({ rapida: 10, lenta: 10 });

  assert.ok(ema.state.rapida > 9, `rapida=${ema.state.rapida}`);
  assert.ok(ema.state.lenta < 3, `lenta=${ema.state.lenta}`);
});

test('las claves sin alpha propio usan el de reserva', () => {
  const ema = new EMA({ conocida: 0.5 }, 0.1);
  ema.update({ conocida: 0, otra: 0 });
  ema.update({ conocida: 10, otra: 10 });
  assert.equal(ema.state.conocida, 5);
  assert.ok(Math.abs(ema.state.otra - 1) < 1e-9);
});

test('un pico aislado apenas mueve una metrica lenta', () => {
  const ema = new EMA({ tilt: 0.08 });
  ema.update({ tilt: 0 });
  ema.update({ tilt: 30 }); // un frame en el que MediaPipe se ha equivocado
  assert.ok(ema.state.tilt < 3, `un pico de 30 deja ${ema.state.tilt}`);
});

// ----------------------------------------------------------- GlanceGate

const GRACE = 25_000;

test('mirar al teclado se perdona durante la ventana de gracia', () => {
  const gate = new GlanceGate({ graceMs: GRACE, threshold: 0.16 });

  const r = gate.update(0.3, 0);
  assert.equal(r.glancing, true);
  assert.equal(r.forgiven, true);

  assert.equal(gate.update(0.3, 10_000).forgiven, true, 'a los 10 s sigue perdonado');
});

test('la gracia caduca: la cabeza gacha mucho rato vuelve a contar', () => {
  // Estar con el cuello flexionado varios minutos es tension cervical, mires
  // el teclado o no. Perdonarlo indefinidamente vaciaria de sentido la app.
  const gate = new GlanceGate({ graceMs: GRACE, threshold: 0.16 });
  gate.update(0.3, 0);

  const r = gate.update(0.3, GRACE + 1_000);
  assert.equal(r.glancing, true, 'sigue mirando abajo');
  assert.equal(r.forgiven, false, 'pero ya no se le perdona');
});

test('levantar la vista reinicia la ventana', () => {
  const gate = new GlanceGate({ graceMs: GRACE, threshold: 0.16 });
  gate.update(0.3, 0);
  assert.equal(gate.update(0.3, 20_000).forgiven, true);

  gate.update(0.0, 21_000); // levantas la cabeza un momento

  const r = gate.update(0.3, 22_000); // y vuelves a mirar abajo
  assert.equal(r.forgiven, true, 'la gracia empieza de cero');
  assert.equal(r.heldMs, 0);
});

test('por debajo del umbral no se considera mirada abajo', () => {
  const gate = new GlanceGate({ graceMs: GRACE, threshold: 0.16 });
  assert.equal(gate.update(0.1, 0).glancing, false);
});

test('encorvarse (pitchDown ~ 0) nunca activa la gracia', () => {
  const gate = new GlanceGate({ graceMs: GRACE, threshold: 0.16 });
  for (let t = 0; t < 60_000; t += 250) {
    assert.equal(gate.update(0.01, t).forgiven, false);
  }
});

test('con graceMs = 0 la gracia queda desactivada', () => {
  const gate = new GlanceGate({ graceMs: 0, threshold: 0.16 });
  const r = gate.update(0.9, 0);
  assert.equal(r.glancing, false);
  assert.equal(r.forgiven, false);
});

test('configure ajusta la ventana en caliente', () => {
  const gate = new GlanceGate({ graceMs: 5_000, threshold: 0.16 });
  gate.update(0.3, 0);
  assert.equal(gate.update(0.3, 8_000).forgiven, false, '8 s > 5 s de gracia');

  gate.configure({ graceMs: 30_000 });
  assert.equal(gate.update(0.3, 9_000).forgiven, true, 'con la ventana ampliada si');
});
