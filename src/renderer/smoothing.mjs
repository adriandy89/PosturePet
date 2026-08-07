/**
 * Media movil exponencial sobre un objeto de numeros, con alpha por clave.
 *
 * Se aplica a las DESVIACIONES, antes de puntuar. Suavizar el score final
 * no sirve igual: una metrica ruidosa arrastraria a las demas al pasar por
 * la rampa no lineal.
 *
 * Cada metrica lleva su propio alpha porque no todas tienen el mismo ruido:
 * las de angulo (inclinacion de hombros, ladeo) salen de puntos que MediaPipe
 * coloca con bastante temblor, asi que van tres veces mas lentas. A 4 Hz,
 * alpha 0.25 ~ 1 s de constante de tiempo; alpha 0.08 ~ 3 s.
 */
export class EMA {
  /**
   * @param alphas numero (mismo para todo) u objeto {clave: alpha}
   * @param fallback alpha para las claves no listadas
   */
  constructor(alphas = 0.25, fallback = 0.25) {
    this.alphas = typeof alphas === 'number' ? {} : alphas;
    this.fallback = typeof alphas === 'number' ? alphas : fallback;
    this.state = null;
  }

  update(sample) {
    if (!sample) return this.state;

    if (!this.state) {
      // El primer frame se adopta tal cual: arrancar desde cero haria que el
      // score entrase subiendo desde "postura pesima" durante unos segundos.
      this.state = { ...sample };
      return this.state;
    }

    for (const k of Object.keys(sample)) {
      const prev = this.state[k];
      if (prev === undefined) {
        this.state[k] = sample[k];
        continue;
      }
      const a = this.alphas[k] ?? this.fallback;
      this.state[k] = a * sample[k] + (1 - a) * prev;
    }
    return this.state;
  }

  reset() {
    this.state = null;
  }
}

/**
 * Ventana de gracia para las miradas hacia abajo.
 *
 * El problema: mirar al teclado para escribir baja la nariz respecto a los
 * hombros igual que encorvarse, asi que headDrop -- la metrica de mas peso --
 * penalizaba una accion perfectamente legitima.
 *
 * La solucion nace de la propia biomecanica: la postura adelantada de cabeza
 * es una TRASLACION del craneo, mientras que mirar abajo es una FLEXION
 * cervical. `pitchDown` mide el escorzo facial y solo reacciona a la segunda.
 *
 * Asi que mientras estas mirando abajo se perdona headDrop... pero solo
 * durante un rato. Pasado `graceMs` vuelve a contar, porque estar con la
 * cabeza gacha varios minutos seguidos SI es tension cervical, mires lo que
 * mires. Con graceMs = 0 la gracia queda desactivada.
 */
export class GlanceGate {
  #startedAt = null;

  constructor({ graceMs = 25_000, threshold = 0.16 } = {}) {
    this.graceMs = graceMs;
    this.threshold = threshold;
  }

  configure({ graceMs, threshold }) {
    if (graceMs !== undefined) this.graceMs = graceMs;
    if (threshold !== undefined) this.threshold = threshold;
  }

  /**
   * @returns {{glancing: boolean, forgiven: boolean, heldMs: number}}
   *   glancing: estas mirando hacia abajo ahora mismo
   *   forgiven: ademas, sigue dentro de la ventana de gracia
   */
  update(pitchDown, now) {
    const glancing = this.graceMs > 0 && pitchDown > this.threshold;

    if (!glancing) {
      this.#startedAt = null;
      return { glancing: false, forgiven: false, heldMs: 0 };
    }

    this.#startedAt ??= now;
    const heldMs = now - this.#startedAt;
    return { glancing: true, forgiven: heldMs < this.graceMs, heldMs };
  }

  reset() {
    this.#startedAt = null;
  }
}

// La histeresis vive en src/main/hysteresis.js: es una decision de politica
// (cuando declarar mala la postura), no de percepcion.
