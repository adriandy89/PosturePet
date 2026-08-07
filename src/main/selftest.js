'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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

  #lines = [];

  constructor({ startCalibration, quit }) {
    this.startCalibration = startCalibration;
    this.quit = quit;
    this.logPath = path.join(app.getPath('userData'), 'selftest.log');
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
      console.log(`\nInforme guardado en: ${this.logPath}`);
    } catch (err) {
      console.error('No se pudo guardar el informe:', err.message);
    }
  }

  start() {
    this.#log('\n=== Autodiagnostico de PosturePet ===');
    this.#log(`Fase 1: observando la camara ${OBSERVE_MS / 1000} s...`);
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

    if (this.#withPerson === 0) {
      this.#log(`  frames recibidos: ${this.#seen}, con persona detectada: 0`);
      return this.#report();
    }

    this.#log(`  frames recibidos: ${this.#seen}, con persona detectada: ${this.#withPerson}`);
    this.#log('Fase 2: calibrando (3 s)...');
    this.#phase = 'calibrando';
    this.startCalibration();
  }

  onCalibration(result) {
    // Solo cuenta la primera. El diagnostico escucha el canal general de
    // calibracion, asi que cualquier otra fuente (la ventana de ajustes, por
    // ejemplo) no debe reiniciar la medicion a mitad.
    if (this.#phase !== 'calibrando') return;

    if (!result.ok) {
      this.#error = result.error;
      return this.#report();
    }
    const b = result.baseline;
    // Se formatea a la defensiva: si el modelo de metricas cambia, el
    // diagnostico debe seguir dando su informe en vez de morirse aqui.
    const n = (v) => (typeof v === 'number' ? v.toFixed(3) : '?');
    this.#log(`  base fijada con ${b.sampleCount} muestras`);
    this.#log(`    separacion de ojos ${n(b.eyeWidth)} (unidad de escala)  ` +
                `cuello ${n(b.neckLength)}  ` +
                `hombros/cara ${n(b.shoulderSpan)}`);
    this.#log(`Fase 3: midiendo ${MEASURE_MS / 1000} s. Muevete para ver reaccionar las metricas.`);
    this.#phase = 'midiendo';
    this.#scores = [];
    setTimeout(() => this.#report(), MEASURE_MS);
  }

  /** Vuelca el informe y termina. Todos los caminos de salida pasan por aqui. */
  #finish(code) {
    this.#flush();
    this.quit(code);
  }

  #report() {
    this.#log('\n--- Resultado ---');

    if (this.#error) {
      this.#log(`FALLO: ${this.#error}`);
      this.#log('\nRevisa: Privacidad y seguridad > Camara > Permitir el acceso a');
      this.#log('aplicaciones de escritorio. Y que no la tenga ocupada otra app.');
      return this.#finish(1);
    }

    if (this.#withPerson === 0) {
      this.#log('FALLO: la camara da imagen, pero no se detecta a nadie.');
      this.#log('Colocate de frente, con los dos hombros dentro del encuadre y luz suficiente.');
      return this.#finish(1);
    }

    if (this.#scores.length === 0) {
      this.#log('FALLO: no se ha llegado a puntuar ningun frame.');
      return this.#finish(1);
    }

    const min = Math.min(...this.#scores);
    const max = Math.max(...this.#scores);
    const avg = this.#scores.reduce((a, b) => a + b, 0) / this.#scores.length;
    const fps = (this.#seen / ((OBSERVE_MS + MEASURE_MS + 3000) / 1000)).toFixed(1);

    this.#log(`OK: cadena completa funcionando a ~${fps} fps`);
    this.#log(`  score  min ${min}  medio ${avg.toFixed(1)}  max ${max}  (${this.#scores.length} frames)`);

    if (this.#lastBreakdown) {
      this.#log('\n  Ultimas desviaciones por metrica:');
      for (const [name, m] of Object.entries(this.#lastBreakdown)) {
        const barra = '#'.repeat(Math.round(m.badness * 20)).padEnd(20, '.');
        this.#log(`    ${m.label.padEnd(24)} ${barra} ${m.deviation.toFixed(3)}`);
      }
    }

    if (max - min < 3) {
      this.#log('\n  Aviso: el score apenas ha variado. Si no te has movido es normal;');
      this.#log('  si te has movido, revisa que la camara te vea de frente.');
    }

    this.#finish(0);
  }
}

module.exports = { SelfTest };
