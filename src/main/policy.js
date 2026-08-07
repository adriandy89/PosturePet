'use strict';

/**
 * Decide CUANDO molestarte y CON QUE. Es el archivo que determina si acabas
 * usando la app o desinstalandola: el detector puede ser perfecto y aun asi
 * resultar insufrible si avisa cada vez que alcanzas la taza de cafe.
 *
 * Cuatro mecanismos, cada uno contra un modo de fallo concreto:
 *
 *   Histeresis   -> quedarte justo en el umbral no hace parpadear el estado
 *   Permanencia  -> gestos breves (beber, girarte a hablar) no avisan
 *   Escalado     -> primero avisos ambientales, la interrupcion al final
 *   Enfriamiento -> encorvarte sin parar no se traduce en toasts sin parar
 *
 * Puro y determinista: `now` se inyecta, no se lee del reloj. Asi se puede
 * simular una sesion de media hora en un test de milisegundos.
 */

const { Hysteresis } = require('./hysteresis.js');

const STATE = Object.freeze({
  PAUSED: 'paused', // no hay nadie delante
  GOOD: 'good',
  BAD: 'bad',
});

/** Niveles de escalado dentro de BAD. Cada uno enciende mas superficies. */
const LEVEL = Object.freeze({
  NONE: 0,
  TRAY: 1, // instantaneo: el icono cambia de color
  MASCOT: 2, // a los ~3 s: el personaje se inquieta
  FULL: 3, // al cumplirse la permanencia: oscurecer + toast + sonido
});

class PosturePolicy {
  constructor(config) {
    this.config = config;
    this.hysteresis = new Hysteresis({
      enterBelow: config.enterBadBelow,
      exitAbove: config.exitBadAbove,
    });

    this.state = STATE.PAUSED;
    this.badSince = null;
    this.lastPoseAt = null;
    this.lastNagAt = null;
    this.lastScore = null;
  }

  /** Reajusta umbrales en caliente, sin perder el estado en curso. */
  reconfigure(config) {
    this.config = config;
    this.hysteresis.enterBelow = config.enterBadBelow;
    this.hysteresis.exitAbove = config.exitBadAbove;
  }

  /**
   * Un frame. `score` es null cuando no se detecta a nadie.
   * Devuelve que superficies deben estar activas AHORA mismo.
   */
  update({ score, now }) {
    const c = this.config;

    if (score === null || score === undefined) {
      // Los huecos breves de deteccion son normales -- te tapas la cara, giras
      // la cabeza, cambia la luz. No reiniciamos nada hasta que el hueco sea
      // largo de verdad, o el temporizador de permanencia no llegaria nunca a
      // cumplirse en una postura mala mantenida.
      const away = this.lastPoseAt === null || now - this.lastPoseAt >= c.awayAfterMs;
      if (away) this.#pause();
      return this.#decision(now);
    }

    this.lastPoseAt = now;
    this.lastScore = score;

    if (this.state === STATE.PAUSED) {
      // Al volver al escritorio se empieza de cero: nadie merece un aviso en el
      // primer segundo por como se ha sentado.
      this.hysteresis.reset();
      this.badSince = null;
      this.state = STATE.GOOD;
    }

    const bad = this.hysteresis.update(score);

    if (bad) {
      this.state = STATE.BAD;
      if (this.badSince === null) this.badSince = now;
    } else {
      this.state = STATE.GOOD;
      this.badSince = null;
    }

    return this.#decision(now);
  }

  #pause() {
    this.state = STATE.PAUSED;
    this.badSince = null;
    this.lastScore = null;
    this.hysteresis.reset();
  }

  #decision(now) {
    const c = this.config;
    const level = this.#level(now);

    // El toast y el sonido interrumpen, asi que van sujetos a enfriamiento.
    // Oscurecer y el personaje son ambientales: acompanan al estado mientras
    // dure, sin limite de repeticion.
    let nag = false;
    if (level === LEVEL.FULL && (this.lastNagAt === null || now - this.lastNagAt >= c.nagCooldownMs)) {
      nag = true;
      this.lastNagAt = now;
    }

    return {
      state: this.state,
      level,
      score: this.lastScore,
      badForMs: this.badSince === null ? 0 : now - this.badSince,
      surfaces: {
        tray: this.state, // el icono refleja siempre el estado real
        mascotAlarmed: level >= LEVEL.MASCOT,
        dim: level >= LEVEL.FULL,
        toast: nag,
        sound: nag,
      },
    };
  }

  #level(now) {
    if (this.state !== STATE.BAD || this.badSince === null) return LEVEL.NONE;
    const badFor = now - this.badSince;
    if (badFor >= this.config.dwellMs) return LEVEL.FULL;
    if (badFor >= this.config.mascotDelayMs) return LEVEL.MASCOT;
    return LEVEL.TRAY;
  }
}

module.exports = { PosturePolicy, STATE, LEVEL };
