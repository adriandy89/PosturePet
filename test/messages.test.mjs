import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS, score } from '../src/renderer/posture.mjs';

/**
 * El toast nombra la metrica que peor esta: "sientate bien" es facil de
 * ignorar, "llevas los hombros encogidos" te dice que corregir.
 *
 * Eso obliga a que exista un mensaje para CADA metrica. Si una se queda sin
 * el, el aviso cae al texto generico sin que nadie se entere -- que es
 * exactamente lo que paso al renombrar las metricas.
 */

// Se lee la tabla del notificador sin arrastrar Electron a los tests.
const { readFileSync } = await import('node:fs');
const source = readFileSync(new URL('../src/main/notifier.js', import.meta.url), 'utf8');

test('cada metrica puntuable tiene mensajes propios en el notificador', () => {
  for (const name of Object.keys(METRICS)) {
    assert.ok(
      new RegExp(`^\\s{2}${name}:`, 'm').test(source),
      `falta la entrada "${name}" en POR_METRICA de notifier.js`
    );
  }
});

test('el notificador no conserva metricas que ya no existen', () => {
  // Al reves tambien importa: una entrada huerfana es codigo muerto que
  // aparenta cubrir un caso.
  const entradas = [...source.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((m) => m[1]);
  const conocidas = new Set(Object.keys(METRICS));
  for (const e of entradas) {
    assert.ok(conocidas.has(e), `"${e}" ya no es una metrica`);
  }
});

test('las metricas de dos sentidos ofrecen mensaje para cada signo', () => {
  // shoulderHeight significa cosas opuestas segun el signo: escurrirse hacia
  // abajo o encoger los hombros hacia arriba. Un solo consejo seria erroneo
  // la mitad de las veces.
  for (const [name, cfg] of Object.entries(METRICS)) {
    if (cfg.dir !== 'both') continue;
    const bloque = source.match(new RegExp(`^ {2}${name}:([\\s\\S]*?)^ {2}[a-zA-Z]+:|^ {2}${name}:([\\s\\S]*?)^\\};`, 'm'));
    if (!bloque) continue;
    const texto = bloque[0];
    // Solo shoulderHeight distingue signo hoy; el resto (angulos) son
    // simetricos y un unico mensaje vale para ambos lados.
    if (name === 'shoulderHeight') {
      assert.match(texto, /up:/, `${name} necesita mensajes para el sentido positivo`);
      assert.match(texto, /down:/, `${name} necesita mensajes para el sentido negativo`);
    }
  }
});

test('la peor metrica es la que mas contribuye, no la mas desviada', () => {
  // El mensaje se elige por `contribution` (desviacion x peso), no por la
  // desviacion cruda: una metrica ruidosa y de poco peso no debe secuestrar
  // el consejo.
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
