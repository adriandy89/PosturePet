import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { METRICS } from '../src/renderer/posture.mjs';

const require = createRequire(import.meta.url);
const i18n = require('../src/shared/i18n.js');

/**
 * El toast nombra la metrica que peor esta: "sientate bien" es facil de
 * ignorar, "llevas los hombros encogidos" te dice que corregir.
 *
 * Eso obliga a que exista un mensaje para CADA metrica, EN CADA IDIOMA. Si una
 * se queda sin el, el aviso cae al texto generico sin que nadie se entere --
 * que es exactamente lo que paso al renombrar las metricas.
 *
 * Antes esto se comprobaba leyendo el codigo de notifier.js con expresiones
 * regulares. Ahora los textos viven en los catalogos, asi que se pueden
 * inspeccionar como datos.
 */

const IDIOMAS = Object.entries(i18n.CATALOGS);

const at = (obj, path) => path.split('.').reduce((n, k) => n?.[k], obj);

test('cada metrica puntuable tiene mensajes propios en todos los idiomas', () => {
  for (const [code, cat] of IDIOMAS) {
    for (const name of Object.keys(METRICS)) {
      const entry = at(cat, `notify.metric.${name}`);
      assert.ok(entry, `falta "${name}" en notify.metric del catalogo "${code}"`);
    }
  }
});

test('el catalogo no conserva mensajes de metricas que ya no existen', () => {
  // Al reves tambien importa: una entrada huerfana es texto que se traduce y
  // se mantiene sin que nadie lo lea nunca.
  const conocidas = new Set(Object.keys(METRICS));
  for (const [code, cat] of IDIOMAS) {
    for (const name of Object.keys(cat.notify.metric)) {
      assert.ok(conocidas.has(name), `"${name}" ya no es una metrica (catalogo "${code}")`);
    }
  }
});

test('las metricas de dos sentidos ofrecen mensaje para cada signo', () => {
  // shoulderHeight significa cosas opuestas segun el signo: escurrirse hacia
  // abajo o encoger los hombros hacia arriba. Un solo consejo seria erroneo
  // la mitad de las veces. El resto (angulos) son simetricos y un unico
  // mensaje vale para ambos lados.
  for (const [code, cat] of IDIOMAS) {
    const entry = cat.notify.metric.shoulderHeight;
    assert.ok(Array.isArray(entry.up) && entry.up.length, `${code}: falta el sentido "up"`);
    assert.ok(Array.isArray(entry.down) && entry.down.length, `${code}: falta el sentido "down"`);
  }
});

test('ningun mensaje se queda en una lista vacia', () => {
  // Una lista vacia no falla al guardarla, pero el notificador acabaria
  // mostrando `undefined` al indexarla.
  for (const [code, cat] of IDIOMAS) {
    assert.ok(cat.notify.generic.length, `${code}: notify.generic esta vacio`);
    for (const [name, entry] of Object.entries(cat.notify.metric)) {
      const listas = Array.isArray(entry) ? [entry] : Object.values(entry);
      for (const lista of listas) {
        assert.ok(lista.length, `${code}: "${name}" tiene una lista de mensajes vacia`);
      }
    }
  }
});

test('cada metrica tiene nombre visible en todos los idiomas', () => {
  // El panel de depuracion y el autodiagnostico los resuelven por clave; sin
  // entrada mostrarian "metrics.neckLength" en crudo.
  for (const [code, cat] of IDIOMAS) {
    for (const name of Object.keys(METRICS)) {
      assert.equal(typeof cat.metrics?.[name], 'string', `${code}: falta metrics.${name}`);
    }
  }
});

test('la peor metrica es la que mas contribuye, no la mas desviada', async () => {
  // El mensaje se elige por `contribution` (desviacion x peso), no por la
  // desviacion cruda: una metrica ruidosa y de poco peso no debe secuestrar
  // el consejo.
  const { score } = await import('../src/renderer/posture.mjs');
  const devs = {
    neckLength: -0.5, // mucho peso
    proximity: 0,
    shoulderHeight: 0,
    shoulderTilt: 60, // desviacion enorme pero peso pequeno
    headRoll: 0,
    driftX: 0,
  };
  const { breakdown } = score(devs);

  const peor = Object.entries(breakdown).sort((a, b) => b[1].contribution - a[1].contribution)[0][0];
  assert.equal(peor, 'neckLength');
  assert.ok(
    breakdown.shoulderTilt.badness === 1,
    'aunque la inclinacion este saturada, pesa menos'
  );
});
