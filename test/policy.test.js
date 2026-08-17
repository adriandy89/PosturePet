'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { PosturePolicy, STATE, LEVEL } = require('../src/main/policy.js');

const CONFIG = {
  enterBadBelow: 60,
  exitBadAbove: 70,
  mascotDelayMs: 3_000,
  dwellMs: 8_000,
  nagCooldownMs: 90_000,
  awayAfterMs: 5_000,
};

const FRAME_MS = 250; // 4 Hz, como la app real

/**
 * Simula una tanda de frames al mismo score y devuelve todas las decisiones.
 * El reloj se inyecta, asi que media hora de sesion cuesta microsegundos.
 */
function run(policy, { score, ms, clock }) {
  const out = [];
  const end = clock.t + ms;
  while (clock.t < end) {
    out.push(policy.update({ score, now: clock.t }));
    clock.t += FRAME_MS;
  }
  return out;
}

const newRun = () => ({ policy: new PosturePolicy(CONFIG), clock: { t: 0 } });
const anyToast = (frames) => frames.some((f) => f.surfaces.toast);
const lastOf = (frames) => frames[frames.length - 1];

test('arranca en pausa hasta que aparece alguien', () => {
  const { policy, clock } = newRun();
  assert.equal(policy.state, STATE.PAUSED);
  const frames = run(policy, { score: 95, ms: 1_000, clock });
  assert.equal(lastOf(frames).state, STATE.GOOD);
});

test('la buena postura no enciende ninguna superficie', () => {
  const { policy, clock } = newRun();
  const frames = run(policy, { score: 92, ms: 60_000, clock });
  assert.ok(frames.every((f) => !f.surfaces.dim && !f.surfaces.toast && !f.surfaces.sound));
  assert.equal(lastOf(frames).level, LEVEL.NONE);
});

test('el escalado respeta el orden: bandeja -> personaje -> oscurecer+toast', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });

  const early = run(policy, { score: 40, ms: 2_000, clock });
  assert.equal(lastOf(early).level, LEVEL.TRAY, 'primeros 2 s: solo bandeja');
  assert.ok(!anyToast(early));

  const mid = run(policy, { score: 40, ms: 3_000, clock });
  assert.equal(lastOf(mid).level, LEVEL.MASCOT, 'a los ~4 s: el personaje');
  assert.ok(!lastOf(mid).surfaces.dim, 'aun sin oscurecer');
  assert.ok(!anyToast(mid));

  const late = run(policy, { score: 40, ms: 5_000, clock });
  assert.equal(lastOf(late).level, LEVEL.FULL, 'pasada la permanencia: todo');
  assert.ok(lastOf(late).surfaces.dim);
  assert.ok(anyToast(late), 'el toast salta una vez');
});

test('un gesto breve de mala postura no avisa (beber cafe)', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 2_000, clock });
  const gesto = run(policy, { score: 30, ms: 4_000, clock }); // menos que dwell
  const vuelta = run(policy, { score: 95, ms: 2_000, clock });

  assert.ok(!anyToast(gesto) && !anyToast(vuelta), 'nada de toasts');
  assert.ok(!gesto.some((f) => f.surfaces.dim), 'no llega a oscurecer');
  assert.equal(lastOf(vuelta).level, LEVEL.NONE, 'el temporizador se reinicia');
});

test('el toast salta una sola vez por enfriamiento aunque sigas mal', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });

  const primera = run(policy, { score: 30, ms: 60_000, clock });
  assert.equal(primera.filter((f) => f.surfaces.toast).length, 1, 'un toast en el primer minuto');

  const segunda = run(policy, { score: 30, ms: 60_000, clock });
  assert.equal(segunda.filter((f) => f.surfaces.toast).length, 1, 'otro tras el enfriamiento');
});

test('corregir y volver a encorvarse no re-avisa dentro del enfriamiento', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });
  assert.ok(anyToast(run(policy, { score: 30, ms: 10_000, clock })), 'primer aviso');

  run(policy, { score: 95, ms: 20_000, clock }); // te enderezas
  const recaida = run(policy, { score: 30, ms: 15_000, clock }); // y recaes

  assert.ok(!anyToast(recaida), 'sin toast: el enfriamiento sigue activo');
  assert.ok(lastOf(recaida).surfaces.dim, 'pero oscurecer si, es ambiental');
});

test('la histeresis evita el parpadeo en el limite', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });

  run(policy, { score: 58, ms: 500, clock }); // entra en malo
  assert.equal(lastOf(run(policy, { score: 65, ms: 500, clock })).state, STATE.BAD,
    '65 esta en la banda muerta: sigue malo');
  assert.equal(lastOf(run(policy, { score: 72, ms: 500, clock })).state, STATE.GOOD,
    'solo sale por encima de 70');
});

test('irse del escritorio pausa y limpia los avisos', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });
  run(policy, { score: 30, ms: 12_000, clock }); // mal, avisando

  const ido = run(policy, { score: null, ms: 8_000, clock });
  const fin = lastOf(ido);
  assert.equal(fin.state, STATE.PAUSED);
  assert.ok(!fin.surfaces.dim && !fin.surfaces.mascotAlarmed, 'todo apagado');
  assert.equal(fin.score, null);
});

test('un hueco breve de deteccion no reinicia la permanencia', () => {
  // Girar la cabeza un segundo pierde los landmarks. Si eso reiniciase el
  // temporizador, una mala postura sostenida no llegaria a avisar nunca.
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });
  run(policy, { score: 30, ms: 6_000, clock });
  run(policy, { score: null, ms: 1_500, clock }); // parpadeo del detector
  const tras = run(policy, { score: 30, ms: 3_000, clock });

  assert.equal(lastOf(tras).state, STATE.BAD);
  assert.ok(anyToast(tras), 'la permanencia sobrevive al hueco');
});

test('al volver al escritorio no se avisa de inmediato', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });
  run(policy, { score: null, ms: 10_000, clock }); // te vas

  const vuelta = run(policy, { score: 30, ms: 2_000, clock }); // vuelves mal sentado
  assert.ok(!vuelta.some((f) => f.surfaces.dim), 'la permanencia empieza de cero');
  assert.ok(lastOf(vuelta).badForMs < CONFIG.dwellMs);
});

test('reconfigure aplica umbrales nuevos sin perder el estado', () => {
  const { policy, clock } = newRun();
  run(policy, { score: 95, ms: 1_000, clock });
  run(policy, { score: 65, ms: 1_000, clock });
  assert.equal(policy.state, STATE.GOOD, '65 no es malo con el umbral 60');

  policy.reconfigure({ ...CONFIG, enterBadBelow: 80, exitBadAbove: 85 });
  assert.equal(lastOf(run(policy, { score: 65, ms: 500, clock })).state, STATE.BAD,
    'con el umbral 80 si lo es');
});

// -------------------------------------------------- reanudar tras una pausa

test('reanudar no dispara el nivel maximo por la pausa entera', () => {
  // Pausar en mala postura, comer, volver y seguir encorvado. Sin reset(), el
  // `badSince` de antes de la pausa hacia que `badFor` valiese media hora: el
  // primer frame al volver saltaba a FULL -- oscurecer, toast y sonido -- sin
  // la permanencia que existe justo para eso.
  const { policy, clock } = newRun();
  const antes = run(policy, { score: 30, ms: 20_000, clock });
  assert.equal(lastOf(antes).level, LEVEL.FULL, 'deberia haber llegado a FULL antes de pausar');

  // Media hora de pausa: durante ella no llega ningun frame.
  policy.reset();
  clock.t += 30 * 60_000;

  const primero = policy.update({ score: 30, now: clock.t });
  // La mala postura se reconoce al instante -- eso es correcto, el icono de la
  // bandeja tiene que decir la verdad. Lo que NO puede pasar es que la
  // permanencia venga ya cumplida.
  assert.equal(primero.state, STATE.BAD);
  assert.equal(primero.level, LEVEL.TRAY, 'la permanencia venia ya cumplida por la pausa');
  assert.equal(primero.badForMs, 0, 'el cronometro de permanencia arranca de cero');
  assert.equal(primero.surfaces.dim, false);
  assert.equal(primero.surfaces.toast, false);
  assert.equal(primero.surfaces.sound, false);

  // Y el escalado vuelve a recorrerse entero, con sus tiempos.
  const tras2s = run(policy, { score: 30, ms: 2_000, clock });
  assert.equal(lastOf(tras2s).level, LEVEL.TRAY, 'aun no toca inquietar al personaje');
  const hastaElFinal = run(policy, { score: 30, ms: 10_000, clock });
  assert.equal(lastOf(hastaElFinal).level, LEVEL.FULL);
});

test('reset conserva el enfriamiento de los avisos', () => {
  // El enfriamiento sigue corriendo durante la pausa. Reiniciarlo permitiria un
  // toast a los pocos segundos de volver, justo despues de haber avisado.
  const { policy, clock } = newRun();
  const antes = run(policy, { score: 30, ms: 20_000, clock });
  assert.ok(anyToast(antes), 'tiene que haber avisado antes de pausar');

  policy.reset();
  clock.t += 2_000; // pausa corta, dentro del enfriamiento

  // Se vuelve a encorvar y se cumple la permanencia otra vez.
  const despues = run(policy, { score: 30, ms: 20_000, clock });
  assert.equal(lastOf(despues).level, LEVEL.FULL, 'la permanencia si vuelve a cumplirse');
  assert.equal(anyToast(despues), false, 'el enfriamiento se ha perdido con el reset');
});

test('reset deja la ausencia contando de nuevo', () => {
  // `lastPoseAt` tambien se limpia: si no, al reanudar tras una pausa larga el
  // primer frame sin nadie delante vendria ya "ausente desde hace media hora".
  const { policy, clock } = newRun();
  run(policy, { score: 90, ms: 2_000, clock });

  policy.reset();
  assert.equal(policy.lastPoseAt, null);
  assert.equal(policy.state, STATE.PAUSED);
});
