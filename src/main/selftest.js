'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { t } = require('../shared/i18n.js');

/**
 * `npm run selftest` -- comprueba la cadena entera contra la camara real:
 * captura -> landmarks -> calibracion -> metricas -> score, y da un informe.
 *
 * Sirve para dos cosas: verificar que el montaje funciona sin tener que mirar
 * la interfaz, y diagnosticar despues por que la app "no detecta nada"
 * (camara ocupada, mala luz, hombros fuera de encuadre...).
 *
 * El informe se escribe ademas a un archivo porque el .exe empaquetado es una
 * app de ventana sin consola: ahi console.log no lo lee nadie, que es justo
 * cuando mas falta hace un diagnostico.
 */

const OBSERVE_MS = 4_000; // mirar antes de calibrar
const MEASURE_MS = 6_000; // medir despues de calibrar

class SelfTest {
  #phase = 'observando';
  #seen = 0;
  #withPerson = 0;
  #scores = [];
  #lastBreakdown = null;
  #error = null;
  #calibrationMs;
  #previewFrames = 0;
  #previewBytes = 0;

  #lines = [];

  constructor({ startCalibration, quit, setPreview, calibrationMs = 3_000 }) {
    this.startCalibration = startCalibration;
    this.quit = quit;
    this.setPreview = setPreview ?? (() => {});
    this.#calibrationMs = calibrationMs;
    this.logPath = path.join(app.getPath('userData'), 'selftest.log');
  }

  /**
   * Un fotograma del relay de la calibracion.
   *
   * Se cuenta aqui porque ese relay es el eslabon mas nuevo y el que mas
   * silenciosamente puede romperse: si el canvas o el codificado fallan, la
   * pantalla de calibracion se queda en negro y todo lo demas sigue
   * funcionando, asi que no hay ningun otro sitio donde se note.
   */
  observePreview(dataUrl) {
    this.#previewFrames++;
    this.#previewBytes += dataUrl?.length ?? 0;
  }

  /** A la consola (si la hay) y al buffer que acaba en el archivo. */
  #log(text = '') {
    console.log(text);
    this.#lines.push(text);
  }

  #flush() {
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      fs.writeFileSync(this.logPath, `${this.#lines.join('\n')}\n`, 'utf8');
      console.log(`\n${t('selftest.saved', { path: this.logPath })}`);
    } catch (err) {
      console.error(t('selftest.saveFailed'), err.message);
    }
  }

  start() {
    this.#log(`\n${t('selftest.header')}`);
    this.#log(t('selftest.phase1', { s: OBSERVE_MS / 1000 }));
    this.setPreview(true);
    setTimeout(() => this.#calibrate(), OBSERVE_MS);
  }

  observe(frame) {
    if (frame.cameraError) {
      this.#error = frame.cameraError;
      return;
    }
    this.#seen++;
    // Sin base, un frame con persona llega como needsCalibration; con base,
    // trae score. Cualquiera de los dos significa que la camara te ve.
    if (frame.needsCalibration || frame.score !== null) this.#withPerson++;
    if (frame.score !== null) this.#scores.push(frame.score);
    if (frame.breakdown) this.#lastBreakdown = frame.breakdown;
  }

  #calibrate() {
    if (this.#error) return this.#report();

    this.#log(t('selftest.frames', { seen: this.#seen, withPerson: this.#withPerson }));
    if (this.#withPerson === 0) return this.#report();

    this.#log(t('selftest.phase2', { s: this.#calibrationMs / 1000 }));
    this.#phase = 'calibrando';
    this.startCalibration();
  }

  onCalibration(result) {
    // Solo cuenta la primera. El diagnostico escucha el canal general de
    // calibracion, asi que cualquier otra fuente (la ventana de ajustes, por
    // ejemplo) no debe reiniciar la medicion a mitad.
    if (this.#phase !== 'calibrando') return;

    if (!result.ok) {
      // El fallo llega como clave de catalogo, no como texto: quien calibra es
      // el renderer del personaje, que no sabe en que idioma corre la app.
      this.#error = result.errorKey ? t(result.errorKey) : t('errors.calibrationNoSubject');
      return this.#report();
    }
    const b = result.baseline;
    // Se formatea a la defensiva: si el modelo de metricas cambia, el
    // diagnostico debe seguir dando su informe en vez de morirse aqui.
    const n = (v) => (typeof v === 'number' ? v.toFixed(3) : '?');
    this.#log(t('selftest.baseline', { n: b.sampleCount }));
    this.#log(t('selftest.baselineDetail', {
      eye: n(b.eyeWidth),
      neck: n(b.neckLength),
      span: n(b.shoulderSpan),
    }));
    this.#log(t('selftest.phase3', { s: MEASURE_MS / 1000 }));
    this.#phase = 'midiendo';
    this.#scores = [];
    setTimeout(() => this.#report(), MEASURE_MS);
  }

  /** Vuelca el informe y termina. Todos los caminos de salida pasan por aqui. */
  #finish(code) {
    this.setPreview(false);
    this.#flush();
    this.quit(code);
  }

  #report() {
    this.#log(`\n${t('selftest.result')}`);
    this.#reportPreview();

    if (this.#error) {
      this.#log(t('selftest.failCamera', { error: this.#error }));
      this.#log(`\n${t('selftest.failCameraHelp1')}`);
      this.#log(t('selftest.failCameraHelp2'));
      return this.#finish(1);
    }

    if (this.#withPerson === 0) {
      this.#log(t('selftest.failNobody'));
      this.#log(t('selftest.failNobodyHelp'));
      return this.#finish(1);
    }

    if (this.#scores.length === 0) {
      this.#log(t('selftest.failNoScore'));
      return this.#finish(1);
    }

    const min = Math.min(...this.#scores);
    const max = Math.max(...this.#scores);
    const avg = this.#scores.reduce((a, b) => a + b, 0) / this.#scores.length;
    const fps = (this.#seen / ((OBSERVE_MS + MEASURE_MS + this.#calibrationMs) / 1000)).toFixed(1);

    this.#log(t('selftest.ok', { fps }));
    this.#log(t('selftest.scores', {
      min, max, avg: avg.toFixed(1), n: this.#scores.length,
    }));

    if (this.#lastBreakdown) {
      this.#log(`\n${t('selftest.deviations')}`);
      for (const [name, m] of Object.entries(this.#lastBreakdown)) {
        const barra = '#'.repeat(Math.round(m.badness * 20)).padEnd(20, '.');
        // El nombre visible ya no viaja en el desglose: se resuelve aqui desde
        // el catalogo, con la clave de la metrica.
        this.#log(`    ${t(`metrics.${name}`).padEnd(24)} ${barra} ${m.deviation.toFixed(3)}`);
      }
    }

    if (max - min < 3) {
      this.#log(`\n${t('selftest.flatWarning1')}`);
      this.#log(t('selftest.flatWarning2'));
    }

    this.#finish(0);
  }

  /**
   * El relay de la pantalla de calibracion. Va antes que el resto del informe
   * porque es independiente de que se te detecte: los fotogramas llegan aunque
   * no haya nadie delante, asi que separa "la camara no da imagen" de "el
   * detector no te ve", que son dos averias distintas.
   */
  #reportPreview() {
    if (this.#previewFrames === 0) {
      this.#log(t('selftest.previewNone'));
      return;
    }
    const kb = Math.round(this.#previewBytes / this.#previewFrames / 1024);
    this.#log(t('selftest.preview', { n: this.#previewFrames, kb }));
  }
}

module.exports = { SelfTest };
