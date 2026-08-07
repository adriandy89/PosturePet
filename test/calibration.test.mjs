import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOVEMENT_LIMIT,
  readiness,
  movementSpread,
  averageFeatures,
  rawFeatures,
} from '../src/renderer/posture.mjs';
import { CalibrationFlow, PHASE, CHECKS } from '../src/renderer/calibration.mjs';
import { ASPECT, makePose } from './pose-fixture.mjs';

/**
 * La calibracion es la operacion sin la cual la app no puntua nada, y la que
 * mas facil falla en silencio: una base fijada mientras el usuario se giraba
 * sigue puntuando, solo que mal, y no hay nada que mirar para averiguarlo.
 *
 * Estos tests cubren las tres redes que lo impiden: comprobar antes de contar,
 * abortar si se pierde la comprobacion a mitad, y medir cuanto se ha movido.
 */

const readyOf = (opts) => readiness(makePose(opts), ASPECT);
const rawOf = (opts) => rawFeatures(makePose(opts), ASPECT);

// ------------------------------------------------ comprobaciones previas

test('una postura de frente y centrada esta lista para calibrar', () => {
  const r = readyOf();
  assert.equal(r.allReady, true, JSON.stringify(r));
  for (const check of CHECKS) assert.equal(r[check], true, check);
});

test('sin landmarks no se cumple ninguna comprobacion', () => {
  const r = readiness(null, ASPECT);
  assert.equal(r.seen, false);
  assert.equal(r.allReady, false);
  // Ninguna debe quedarse en undefined: la interfaz las pinta todas.
  for (const check of CHECKS) assert.equal(typeof r[check], 'boolean', check);
});

test('un hombro fuera del encuadre lo detecta', () => {
  // Desplazar el cuerpo hasta sacar un hombro por el borde derecho.
  const r = readyOf({ dx: 0.36 });
  assert.equal(r.shouldersInFrame, false);
  assert.equal(r.allReady, false);
});

test('la cara girada lo detecta', () => {
  const r = readyOf({ yaw: 0.1 });
  assert.equal(r.facingCamera, false);
  assert.equal(r.allReady, false);
  assert.equal(r.seen, true, 'te sigue viendo: lo que falla es el angulo');
});

test('estar demasiado lejos o demasiado cerca lo detecta', () => {
  assert.equal(readyOf({ scale: 0.3 }).distanceOk, false, 'demasiado lejos');
  assert.equal(readyOf({ scale: 2.6 }).distanceOk, false, 'demasiado cerca');
});

test('la banda de distancia es ancha: no estorba en el uso normal', () => {
  // Su trabajo es cazar los dos extremos absurdos, no opinar sobre lo de en
  // medio. Una banda estrecha bloquearia la calibracion, que es peor que no
  // tenerla.
  for (const scale of [0.6, 0.8, 1, 1.3, 1.8]) {
    assert.equal(readyOf({ scale }).distanceOk, true, `scale ${scale}`);
  }
});

// -------------------------------------------------------- dispersion

test('quedarse quieto da dispersion practicamente cero', () => {
  const samples = Array.from({ length: 12 }, (_, i) => rawOf({ drop: i * 0.0005 }));
  assert.ok(movementSpread(samples) < MOVEMENT_LIMIT, 'un temblor minimo no es moverse');
});

test('recolocarse a mitad de la calibracion se nota', () => {
  // La media de dos posturas distintas no corresponde a ninguna de las dos.
  const samples = [
    ...Array.from({ length: 6 }, () => rawOf()),
    ...Array.from({ length: 6 }, () => rawOf({ drop: 0.18 })),
  ];
  assert.ok(movementSpread(samples) > MOVEMENT_LIMIT);
});

test('acercarse a la camara tambien cuenta como moverse', () => {
  const samples = [
    ...Array.from({ length: 6 }, () => rawOf()),
    ...Array.from({ length: 6 }, () => rawOf({ scale: 1.5 })),
  ];
  assert.ok(movementSpread(samples) > MOVEMENT_LIMIT);
});

test('los huecos de deteccion no cuentan como movimiento', () => {
  // Un frame en el que el detector no te vio llega como null; tratarlo como un
  // cero seria un salto enorme y falso.
  const quieto = Array.from({ length: 8 }, () => rawOf());
  assert.equal(movementSpread([...quieto, null, null]), movementSpread(quieto));
});

test('con menos de dos muestras no se inventa una dispersion', () => {
  assert.equal(movementSpread([]), 0);
  assert.equal(movementSpread([rawOf()]), 0);
});

test('la base incluye cuantas muestras la formaron y cuanto te moviste', () => {
  const base = averageFeatures([rawOf(), rawOf(), null]);
  assert.equal(base.sampleCount, 2, 'los nulos no cuentan');
  assert.equal(typeof base.spread, 'number');
});

// ------------------------------------------------------ maquina de estados

const READY = { seen: true, shouldersInFrame: true, facingCamera: true, distanceOk: true, allReady: true };
const NOT_FACING = { ...READY, facingCamera: false, allReady: false };

const flowAt = (opts) => new CalibrationFlow({ countdownMs: 3_000, captureMs: 3_000, ...opts });

test('no cuenta mientras no te vea', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: NOT_FACING, now: 0 });
  assert.equal(flow.phase, PHASE.PREPARING);
  flow.update({ readiness: NOT_FACING, now: 10_000 });
  assert.equal(flow.phase, PHASE.PREPARING, 'por mucho que pase el tiempo');
});

test('en cuanto estas listo empieza la cuenta atras', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  assert.equal(flow.phase, PHASE.COUNTDOWN);
  assert.equal(flow.countdownSeconds(0), 3);
  assert.equal(flow.countdownSeconds(1_500), 2);
  assert.equal(flow.countdownSeconds(2_900), 1);
});

test('la cuenta atras termina en captura', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  const antes = flow.update({ readiness: READY, now: 2_999 });
  assert.equal(antes.startCapture, false);
  const justo = flow.update({ readiness: READY, now: 3_000 });
  assert.equal(justo.startCapture, true);
  assert.equal(flow.phase, PHASE.CAPTURING);
});

test('la captura se pide UNA sola vez', () => {
  // Dos peticiones para una sola calibracion dejarian dos resultados en vuelo y
  // quien la pidio ya no sabria cual es el bueno.
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });
  for (const now of [3_050, 3_100, 5_000]) {
    assert.equal(flow.update({ readiness: READY, now }).startCapture, false);
  }
});

test('girarse a mitad de cuenta la aborta y dice cual fallo', () => {
  // La regla entera de este archivo: seguir contando fijaria una base que
  // corresponde a una postura que nadie mantiene.
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: NOT_FACING, now: 1_000 });

  assert.equal(flow.phase, PHASE.PREPARING);
  assert.equal(flow.lostCheck, 'facingCamera');
  assert.equal(flow.countdownSeconds(1_000), null);
});

test('la cuenta atras vuelve a empezar entera tras abortar', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: NOT_FACING, now: 2_900 });
  flow.update({ readiness: READY, now: 3_000 });

  assert.equal(flow.phase, PHASE.COUNTDOWN);
  assert.equal(flow.countdownSeconds(3_000), 3, 'no se reanuda donde se quedo');
  assert.equal(flow.update({ readiness: READY, now: 5_900 }).startCapture, false);
  assert.equal(flow.update({ readiness: READY, now: 6_000 }).startCapture, true);
});

test('perder la comprobacion durante la captura NO la aborta', () => {
  // Los huecos breves del detector son normales, y el promediado ya exige que
  // la mitad de las muestras sean validas. Abortar aqui haria imposible
  // calibrar con una camara que parpadea de vez en cuando.
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });
  flow.update({ readiness: NOT_FACING, now: 3_500 });
  assert.equal(flow.phase, PHASE.CAPTURING);
});

test('con la cuenta atras a cero se captura de inmediato', () => {
  const flow = flowAt({ countdownMs: 0 });
  flow.open();
  const action = flow.update({ readiness: READY, now: 0 });
  assert.equal(action.startCapture, true);
  assert.equal(flow.phase, PHASE.CAPTURING, 'no una cuenta de cero segundos');
});

test('el progreso de la captura va de 0 a 1 y no se pasa', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });

  assert.equal(flow.captureProgress(3_000), 0);
  assert.ok(Math.abs(flow.captureProgress(4_500) - 0.5) < 1e-9);
  assert.equal(flow.captureProgress(6_000), 1);
  assert.equal(flow.captureProgress(99_000), 1, 'no se desborda');
});

test('cancelar deja el estado limpio en cualquier fase', () => {
  for (const cancelAt of [0, 1_000, 3_500]) {
    const flow = flowAt();
    flow.open();
    flow.update({ readiness: READY, now: 0 });
    flow.update({ readiness: READY, now: cancelAt });
    flow.cancel();

    assert.equal(flow.phase, PHASE.IDLE);
    assert.equal(flow.active, false);
    assert.equal(flow.result, null);
    assert.equal(flow.lostCheck, null);
    assert.equal(flow.readiness.allReady, false, 'no se queda en verde de antes');
  }
});

test('un resultado que llega despues de cancelar se descarta', () => {
  // Si no, la capa se reabriria sola para ensenar el resultado de algo que el
  // usuario ya habia abandonado.
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });
  flow.cancel();

  assert.equal(flow.finish({ ok: true, baseline: {} }), false);
  assert.equal(flow.phase, PHASE.IDLE);
  assert.equal(flow.result, null);
});

test('el resultado de una captura en curso si se acepta', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });

  assert.equal(flow.finish({ ok: true, baseline: { sampleCount: 11 } }), true);
  assert.equal(flow.phase, PHASE.DONE);
  assert.equal(flow.result.baseline.sampleCount, 11);
});

test('reintentar vuelve a la preparacion sin arrastrar el resultado', () => {
  const flow = flowAt();
  flow.open();
  flow.update({ readiness: READY, now: 0 });
  flow.update({ readiness: READY, now: 3_000 });
  flow.finish({ ok: false, errorKey: 'errors.calibrationNoSubject' });
  flow.retry();

  assert.equal(flow.phase, PHASE.PREPARING);
  assert.equal(flow.result, null);
  assert.equal(flow.active, true, 'la capa sigue abierta');
});

test('sin haber abierto la capa nada se mueve', () => {
  const flow = flowAt();
  assert.equal(flow.active, false);
  assert.equal(flow.update({ readiness: READY, now: 0 }).startCapture, false);
  assert.equal(flow.phase, PHASE.IDLE);
});
