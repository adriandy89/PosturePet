/**
 * Las cuatro fases de la calibracion guiada, sin DOM.
 *
 * Vive separado de settings.mjs por dos razones. La primera es que se puede
 * testear: `now` se inyecta, asi que una cuenta atras de tres segundos cuesta
 * microsegundos. La segunda es que la regla que de verdad importa aqui es facil
 * de romper sin darse cuenta al mezclarla con codigo de interfaz --
 *
 *   SI SE PIERDE UNA COMPROBACION A MITAD DE LA CUENTA, SE ABORTA.
 *
 * -- porque el fallo que evita es silencioso: seguir contando mientras el
 * usuario se ha girado fija una base que corresponde a una postura que nadie
 * mantiene. La app sigue puntuando, solo que mal, y no hay nada que mirar para
 * averiguar por que.
 */

export const PHASE = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing', // esperando a que el detector te vea
  COUNTDOWN: 'countdown', // 3, 2, 1
  CAPTURING: 'capturing', // promediando muestras
  DONE: 'done',
});

/** En orden de utilidad para el usuario: lo primero que falla es lo que se dice. */
export const CHECKS = Object.freeze([
  'seen',
  'shouldersInFrame',
  'facingCamera',
  'distanceOk',
]);

const NOT_READY = Object.freeze({
  seen: false,
  shouldersInFrame: false,
  facingCamera: false,
  distanceOk: false,
  allReady: false,
});

export class CalibrationFlow {
  #phase = PHASE.IDLE;
  #countdownMs;
  #captureMs;
  #countdownStartedAt = null;
  #captureStartedAt = null;
  #readiness = NOT_READY;
  #lostCheck = null;
  #result = null;

  constructor({ countdownMs = 3_000, captureMs = 3_000 } = {}) {
    this.#countdownMs = countdownMs;
    this.#captureMs = captureMs;
  }

  configure({ countdownMs, captureMs }) {
    if (Number.isFinite(countdownMs)) this.#countdownMs = countdownMs;
    if (Number.isFinite(captureMs)) this.#captureMs = captureMs;
  }

  get phase() { return this.#phase; }
  get readiness() { return this.#readiness; }
  get result() { return this.#result; }
  /** Que comprobacion tumbo la cuenta atras, para poder explicarlo. */
  get lostCheck() { return this.#lostCheck; }
  get active() { return this.#phase !== PHASE.IDLE; }

  open() {
    this.#phase = PHASE.PREPARING;
    this.#countdownStartedAt = null;
    this.#captureStartedAt = null;
    this.#readiness = NOT_READY;
    this.#lostCheck = null;
    this.#result = null;
  }

  cancel() {
    this.#phase = PHASE.IDLE;
    this.#countdownStartedAt = null;
    this.#captureStartedAt = null;
    this.#readiness = NOT_READY;
    this.#lostCheck = null;
    this.#result = null;
  }

  /** Vuelve a la preparacion conservando la capa abierta ("Reintentar"). */
  retry() {
    this.open();
  }

  /**
   * Un latido. La interfaz llama a esto con la ultima telemetria y el reloj.
   *
   * @param readiness los booleanos de posture.readiness(), o null si aun no ha
   *   llegado ningun frame
   * @returns {{startCapture: boolean}} lo unico que la interfaz debe ejecutar:
   *   pedir la calibracion de verdad al proceso principal
   */
  update({ readiness, now }) {
    if (readiness) this.#readiness = readiness;
    const ready = Boolean(this.#readiness.allReady);

    if (this.#phase === PHASE.PREPARING) {
      if (!ready) return { startCapture: false };

      this.#lostCheck = null;
      // Con la cuenta atras desactivada se captura directamente: quien la pone
      // a cero esta pidiendo justo eso, no una cuenta de cero segundos.
      if (this.#countdownMs <= 0) return this.#beginCapture(now);

      this.#phase = PHASE.COUNTDOWN;
      this.#countdownStartedAt = now;
      return { startCapture: false };
    }

    if (this.#phase === PHASE.COUNTDOWN) {
      if (!ready) {
        // La regla de arriba. Se recuerda cual fallo para poder decirlo.
        this.#lostCheck = CHECKS.find((c) => !this.#readiness[c]) ?? null;
        this.#phase = PHASE.PREPARING;
        this.#countdownStartedAt = null;
        return { startCapture: false };
      }
      if (now - this.#countdownStartedAt >= this.#countdownMs) return this.#beginCapture(now);
    }

    // Durante la captura no se aborta por perder una comprobacion: los huecos
    // breves son normales y el promediado ya exige que la mitad de las muestras
    // sean validas. Abortar aqui haria imposible calibrar con un detector que
    // parpadea de vez en cuando.
    return { startCapture: false };
  }

  #beginCapture(now) {
    this.#phase = PHASE.CAPTURING;
    this.#captureStartedAt = now;
    return { startCapture: true };
  }

  /** El resultado que devuelve el proceso principal. */
  finish(result) {
    // Una respuesta que llega despues de cancelar se descarta: si no, la capa
    // volveria a abrirse sola para ensenar el resultado de algo que el usuario
    // ya habia abandonado.
    if (this.#phase !== PHASE.CAPTURING) return false;
    this.#phase = PHASE.DONE;
    this.#result = result;
    return true;
  }

  /** Segundos que faltan, ya redondeados para pintarlos: 3, 2, 1. */
  countdownSeconds(now) {
    if (this.#phase !== PHASE.COUNTDOWN) return null;
    const left = this.#countdownMs - (now - this.#countdownStartedAt);
    return Math.max(1, Math.ceil(left / 1000));
  }

  /** Progreso de la captura, 0-1, para el anillo. */
  captureProgress(now) {
    if (this.#phase !== PHASE.CAPTURING || this.#captureMs <= 0) return 0;
    const done = (now - this.#captureStartedAt) / this.#captureMs;
    return Math.min(1, Math.max(0, done));
  }
}
