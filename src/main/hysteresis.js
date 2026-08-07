'use strict';

/**
 * Histeresis: distintos umbrales para entrar y para salir del estado malo.
 *
 * Con un solo umbral, quedarte justo en el limite hace parpadear el estado
 * varias veces por segundo -- y con el, el icono de bandeja y el personaje.
 * La banda muerta entre `enterBelow` y `exitAbove` lo elimina.
 */
class Hysteresis {
  constructor({ enterBelow = 60, exitAbove = 70 } = {}) {
    if (exitAbove < enterBelow) {
      throw new Error('exitAbove debe ser >= enterBelow');
    }
    this.enterBelow = enterBelow;
    this.exitAbove = exitAbove;
    this.bad = false;
  }

  update(score) {
    if (this.bad) {
      if (score >= this.exitAbove) this.bad = false;
    } else if (score < this.enterBelow) {
      this.bad = true;
    }
    return this.bad;
  }

  reset() {
    this.bad = false;
  }
}

module.exports = { Hysteresis };
