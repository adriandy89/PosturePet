import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LM,
  METRICS,
  MAX_YAW,
  rawFeatures,
  averageFeatures,
  deviations,
  pitchDown,
  baselineLooksStale,
  score,
  analyze,
} from '../src/renderer/posture.mjs';

const ASPECT = 16 / 9;

/**
 * Genera 33 landmarks sinteticos de una persona sentada de frente, para poder
 * provocar cada gesto por separado y comprobar que solo se mueve la metrica
 * que toca.
 *
 *   scale     >1 = mas cerca de la camara (escala TODO, cara incluida)
 *   drop      +  = la cabeza baja hacia los hombros (encorvarse)
 *   shrug     +  = los hombros suben hacia las orejas (encogerlos/redondearlos)
 *   span      multiplica solo el ancho de hombros, sin tocar la cara
 *   tilt      grados de giro de la linea de hombros
 *   roll      grados de ladeo de la cabeza
 *   pitch     0..1 = escorzo vertical de la cara (mirar hacia abajo).
 *             Elegido para que `pitch` sea exactamente el pitchDown esperado.
 *   yaw       desplazamiento de la nariz respecto al centro de los ojos (girar la cara)
 *   dx/dy     desplazamiento del cuerpo entero, en coordenadas normalizadas
 */
function makePose({
  scale = 1, drop = 0, shrug = 0, span = 1, tilt = 0, roll = 0,
  pitch = 0, yaw = 0, dx = 0, dy = 0,
} = {}) {
  const cx = 0.5;
  const cy = 0.75; // linea de hombros
  const halfShoulder = 0.15;
  const noseAbove = 0.30;
  const halfEye = 0.04;

  const rot = (px, py, deg, ox, oy) => {
    const r = (deg * Math.PI) / 180;
    // El eje x se escala por el aspect ratio, asi que se rota en ese espacio y
    // luego se deshace -- igual que hace posture.mjs internamente.
    const ax = (px - ox) * ASPECT;
    const ay = py - oy;
    return {
      x: ox + (ax * Math.cos(r) - ay * Math.sin(r)) / ASPECT,
      y: oy + (ax * Math.sin(r) + ay * Math.cos(r)),
    };
  };

  // OJO CON LA MANO: MediaPipe llama "izquierdo" al hombro izquierdo DEL
  // SUJETO, que en una imagen sin espejar cae a la DERECHA del encuadre. Es
  // decir, lSh.x > rSh.x. Generar los puntos al reves hacia que atan2 diese
  // valores cerca de 0 en vez de cerca de +-180, que es donde esta la
  // discontinuidad -- y los tests pasaban mientras la camara real fallaba.
  const shoulderY = cy - shrug * scale;
  const halfW = halfShoulder * span * scale;
  const lSh = { x: cx + halfW, y: shoulderY };
  const rSh = { x: cx - halfW, y: shoulderY };
  const [lShR, rShR] = [
    rot(lSh.x, lSh.y, tilt, cx, shoulderY),
    rot(rSh.x, rSh.y, tilt, cx, shoulderY),
  ];

  // La cabeza cuelga de una altura fija respecto a la LINEA DE HOMBROS SIN
  // ENCOGER, para que `shrug` acorte el cuello sin arrastrar la cara con el.
  const noseY = cy - (noseAbove - drop) * scale;
  const nose = { x: cx + yaw * scale, y: noseY };
  // Mirar hacia abajo acorta la distancia proyectada ojos-nariz sin tocar la
  // separacion horizontal entre ojos: eso es el escorzo que mide facePitch.
  const eyeY = noseY - 0.03 * (1 - pitch) * scale;
  const lEye = { x: cx + halfEye * scale, y: eyeY }; // ojo izquierdo del sujeto
  const rEye = { x: cx - halfEye * scale, y: eyeY };
  const [lEyeR, rEyeR] = [
    rot(lEye.x, lEye.y, roll, cx, noseY),
    rot(rEye.x, rEye.y, roll, cx, noseY),
  ];

  const marks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const put = (i, p) => { marks[i] = { x: p.x + dx, y: p.y + dy, z: 0, visibility: 0.99 }; };

  put(LM.NOSE, nose);
  put(LM.LEFT_EYE, lEyeR);
  put(LM.RIGHT_EYE, rEyeR);
  put(LM.LEFT_SHOULDER, lShR);
  put(LM.RIGHT_SHOULDER, rShR);
  return marks;
}

const BASE = averageFeatures([rawFeatures(makePose(), ASPECT)]);
const rawOf = (opts) => rawFeatures(makePose(opts), ASPECT);
const devsOf = (opts) => deviations(rawOf(opts), BASE);

test('la postura base puntua 100', () => {
  assert.equal(analyze(makePose(), BASE, ASPECT).value, 100);
});

// ------------------------------------- la unidad de escala es rigida

test('alejarse o acercarse no mueve ninguna metrica salvo proximity', () => {
  // Es la prueba de fuego del rediseno: si la unidad de escala fuese el ancho
  // de hombros, todo lo demas se contaminaria con los cambios de postura.
  for (const s of [0.7, 1.4]) {
    const d = devsOf({ scale: s });
    assert.ok(Math.abs(d.neckLength) < 0.02, `neckLength=${d.neckLength} a escala ${s}`);
    assert.ok(Math.abs(d.shoulderHeight) < 0.05, `shoulderHeight=${d.shoulderHeight}`);
    assert.ok(Math.abs(d.shoulderTilt) < 0.5);
    assert.ok(Math.abs(d.driftX) < 0.05);
  }
});

test('el ancho de hombros ya no distorsiona el resto de metricas', () => {
  // Ensanchar los hombros SIN tocar la cara: con el diseno viejo esto habria
  // movido todas las metricas a la vez, porque era el denominador comun.
  const d = devsOf({ span: 1.25 });
  assert.ok(Math.abs(d.neckLength) < 0.02, `neckLength=${d.neckLength}`);
  assert.ok(Math.abs(d.proximity) < 0.01, 'la distancia se mide con la cara');
  assert.ok(Math.abs(d.shoulderHeight) < 0.02);
});

test('acercarse a la pantalla dispara proximity', () => {
  const d = devsOf({ scale: 1.2 });
  assert.ok(d.proximity > 0.15, `proximity=${d.proximity}`);
  assert.ok(score(d).breakdown.proximity.badness > 0.4);
});

test('echarse hacia atras no penaliza (metrica de un solo sentido)', () => {
  const d = devsOf({ scale: 0.8 });
  assert.ok(d.proximity < 0, 'la desviacion es negativa');
  assert.equal(score(d).breakdown.proximity.badness, 0, 'pero no cuenta como fallo');
});

// ------------------------------------------ cuello, hombros y encogerlos

test('encorvarse acorta el cuello aparente', () => {
  const d = devsOf({ drop: 0.08 });
  assert.ok(d.neckLength < -0.3, `neckLength=${d.neckLength}`);
  assert.ok(score(d).breakdown.neckLength.badness > 0.3);
});

test('ENCOGER O REDONDEAR LOS HOMBROS tambien acorta el cuello y penaliza', () => {
  // Este es el caso que antes no se detectaba en absoluto. La protraccion
  // escapular no se puede leer del ancho de hombros (la literatura dice que el
  // efecto en proyeccion frontal es ambiguo), pero SI de su consecuencia:
  // los hombros suben hacia las orejas y el cuello aparente se acorta.
  const d = devsOf({ shrug: 0.05 });
  assert.ok(d.neckLength < -0.3, `neckLength=${d.neckLength}`);
  assert.ok(d.shoulderHeight < 0, 'y los hombros suben');
  assert.ok(score(d).value < 80, `score=${score(d).value}`);
});

test('los hombros penalizan en los DOS sentidos', () => {
  // Hacia abajo es escurrirse en la silla; hacia arriba es tension.
  const escurrido = score(devsOf({ dy: 0.06 })).breakdown.shoulderHeight;
  const encogido = score(devsOf({ shrug: 0.05 })).breakdown.shoulderHeight;
  assert.ok(escurrido.badness > 0, `escurrirse=${escurrido.deviation}`);
  assert.ok(encogido.badness > 0, `encogerse=${encogido.deviation}`);
  assert.ok(escurrido.deviation > 0 && encogido.deviation < 0, 'signos opuestos');
});

test('estirarse un poco mas de lo normal no penaliza el cuello', () => {
  // neckLength solo penaliza al ACORTARSE. Sentarse mas erguido que tu base
  // es una mejora, no un fallo.
  const d = devsOf({ drop: -0.04 });
  assert.ok(d.neckLength > 0, 'el cuello se alarga');
  assert.equal(score(d).breakdown.neckLength.badness, 0);
});

// ------------------------------------------- regresion: envolvente de angulo

test('los angulos salen cerca de 0, no cerca de +-180', () => {
  // Con la mano real (hombro izquierdo del sujeto a la derecha del encuadre),
  // atan2 devuelve valores junto a +-180: justo sobre la discontinuidad. Si no
  // se pliegan a [-90, 90], promediarlos para calibrar da una base absurda.
  const raw = rawOf({});
  assert.ok(Math.abs(raw.shoulderTilt) < 1, `shoulderTilt=${raw.shoulderTilt}`);
  assert.ok(Math.abs(raw.headRoll) < 1, `headRoll=${raw.headRoll}`);
});

test('calibrar con temblor alrededor de la horizontal da una base sana', () => {
  // Reproduce el fallo visto con la webcam: la base salia por los 13 grados y
  // las desviaciones se disparaban a -56, saturando la metrica para siempre.
  const jitter = [0.4, -0.5, 0.3, -0.6, 0.5, -0.2, 0.45, -0.35];
  const base = averageFeatures(jitter.map((t) => rawOf({ tilt: t })));

  assert.ok(Math.abs(base.shoulderTilt) < 1, `base=${base.shoulderTilt}`);

  for (const t of jitter) {
    const d = deviations(rawOf({ tilt: t }), base);
    assert.ok(Math.abs(d.shoulderTilt) < 2, `desviacion=${d.shoulderTilt}`);
    assert.equal(score(d).breakdown.shoulderTilt.badness, 0, 'y no penaliza');
  }
});

test('ladear el torso dispara shoulderTilt con los grados correctos', () => {
  const d = devsOf({ tilt: 10 });
  assert.ok(Math.abs(Math.abs(d.shoulderTilt) - 10) < 0.5, `tilt=${d.shoulderTilt}`);
  assert.ok(Math.abs(d.headRoll) < 0.5, 'la cabeza no se ha movido');
});

test('torcer la cabeza dispara headRoll sin tocar los hombros', () => {
  const d = devsOf({ roll: 12 });
  assert.ok(Math.abs(Math.abs(d.headRoll) - 12) < 0.5, `roll=${d.headRoll}`);
  assert.ok(Math.abs(d.shoulderTilt) < 0.5);
});

// ------------------------------------------------- ruido y peso de angulos

test('los pesos suman exactamente 1', () => {
  const total = Object.values(METRICS).reduce((s, m) => s + m.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `suma=${total}`);
});

test('el temblor tipico de MediaPipe en los hombros no marca nada', () => {
  // El desplazamiento mediano entre frames es ~0.01 normalizado, que sobre un
  // ancho de hombros tipico son ~1,5 grados; la cola llega a 4. Nada de eso
  // debe puntuar, o la app marcaria mala postura sin haberte movido.
  for (const grados of [1.5, 3, 4]) {
    assert.equal(score(devsOf({ tilt: grados })).breakdown.shoulderTilt.badness, 0,
      `${grados} grados no deben penalizar`);
  }
});

test('un hombro algo mas alto por usar el raton apenas afecta al score', () => {
  const r = score(devsOf({ tilt: 12 }));
  assert.ok(r.value > 90, `score=${r.value} con 12 grados de inclinacion`);
});

test('una inclinacion lateral marcada si penaliza', () => {
  assert.ok(score(devsOf({ tilt: 25 })).breakdown.shoulderTilt.badness > 0.9);
});

// ----------------------------------------- mirar al teclado vs encorvarse

test('mirar hacia abajo se detecta por el escorzo de la cara', () => {
  assert.ok(Math.abs(pitchDown(rawOf({ pitch: 0.3 }), BASE) - 0.3) < 0.01);
});

test('encorvarse NO se confunde con mirar hacia abajo', () => {
  // Es la distincion que sostiene toda la gracia del teclado: la postura
  // adelantada es una traslacion del craneo, mirar abajo es flexion cervical.
  // neckLength reacciona a las dos; pitchDown solo a la segunda.
  const encorvado = rawOf({ drop: 0.08 });
  assert.ok(Math.abs(pitchDown(encorvado, BASE)) < 0.02, 'sin escorzo facial');
  assert.ok(deviations(encorvado, BASE).neckLength < -0.3, 'pero si acorta el cuello');

  assert.ok(pitchDown(rawOf({ pitch: 0.35 }), BASE) > 0.3, 'aqui si hay escorzo');
});

test('con la cara muy girada no se fia del cabeceo', () => {
  const raw = rawOf({ pitch: 0.4, yaw: 0.06 });
  assert.ok(raw.faceYaw > MAX_YAW, 'el giro se detecta');
  assert.equal(pitchDown(raw, BASE), 0, 'y desactiva la medida');
});

test('suppress perdona una metrica sin tocar las demas', () => {
  const d = devsOf({ drop: 0.09, scale: 1.2 });
  const normal = score(d);
  const perdonado = score(d, { suppress: ['neckLength'] });

  assert.ok(normal.breakdown.neckLength.badness > 0, 'sin perdon si penaliza');
  assert.equal(perdonado.breakdown.neckLength.badness, 0);
  assert.equal(perdonado.breakdown.neckLength.muted, true);
  assert.equal(
    perdonado.breakdown.proximity.badness,
    normal.breakdown.proximity.badness,
    'el acercamiento se sigue midiendo igual'
  );
  assert.ok(perdonado.value > normal.value);
});

// --------------------------------------------------- base obsoleta

test('cambiar de montaje se detecta como base obsoleta', () => {
  // shoulderSpan (hombros en anchos de cara) es casi una constante anatomica.
  // Que cambie mucho significa otra camara, otra silla u otra persona.
  assert.equal(baselineLooksStale(rawOf({}), BASE), false, 'mismo sitio');
  assert.equal(baselineLooksStale(rawOf({ scale: 1.4 }), BASE), false,
    'acercarse NO es cambiar de sitio');
  assert.equal(baselineLooksStale(rawOf({ span: 1.35 }), BASE), true, 'otro montaje');
  assert.equal(baselineLooksStale(rawOf({ span: 0.7 }), BASE), true);
});

test('girar el torso no se confunde con cambiar de sitio', () => {
  // Girarse estrecha los hombros aparentes, pero es transitorio: avisar de
  // recalibrar cada vez que te giras a hablar seria absurdo.
  assert.equal(baselineLooksStale(rawOf({ span: 0.7, yaw: 0.06 }), BASE), false);
});

// -------------------------------------------------------- casos limite

test('los frames inservibles devuelven null en vez de un score falso', () => {
  assert.equal(rawFeatures(null, ASPECT), null, 'sin landmarks');
  assert.equal(rawFeatures([], ASPECT), null, 'array vacio');

  const oculto = makePose();
  oculto[LM.LEFT_SHOULDER].visibility = 0.1;
  assert.equal(rawFeatures(oculto, ASPECT), null, 'hombro no visible');

  const perfil = makePose();
  perfil[LM.RIGHT_EYE] = { ...perfil[LM.LEFT_EYE] };
  assert.equal(rawFeatures(perfil, ASPECT), null, 'ojos superpuestos: sin escala');
});

test('mas sensibilidad penaliza mas el mismo gesto', () => {
  const d = devsOf({ scale: 1.1 });
  assert.ok(score(d, { sensitivity: 1.6 }).value < score(d, { sensitivity: 1.0 }).value);
});

test('el desglose suma exactamente la penalizacion aplicada', () => {
  const r = score(devsOf({ scale: 1.2, drop: 0.06, tilt: 8, roll: 9 }));
  const total = Object.values(r.breakdown).reduce((s, m) => s + m.contribution, 0);
  assert.equal(r.value, Math.round(Math.max(0, Math.min(100, 100 * (1 - total)))));
});

test('la calibracion promedia frames e ignora los invalidos', () => {
  const avg = averageFeatures([rawOf({ scale: 0.98 }), null, rawOf({ scale: 1.02 })]);
  assert.equal(avg.sampleCount, 2);
  assert.ok(Math.abs(avg.eyeWidth - BASE.eyeWidth) < 1e-3);
});

test('la mala postura combinada hunde el score por debajo del umbral', () => {
  const r = score(devsOf({ scale: 1.25, drop: 0.09, shrug: 0.03, tilt: 10 }));
  assert.ok(r.value < 60, `score=${r.value}`);
});
