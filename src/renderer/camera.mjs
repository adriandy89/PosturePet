import { FilesetResolver, PoseLandmarker } from '../../vendor/tasks-vision/vision_bundle.mjs';
import {
  ALPHAS,
  REFERENCE_ALPHA,
  MAX_YAW,
  YAW_SENSITIVE,
  PITCH_DOWN_THRESHOLD,
  rawFeatures,
  averageFeatures,
  deviations,
  pitchDown,
  baselineLooksStale,
  score,
} from './posture.mjs';
import { EMA, GlanceGate } from './smoothing.mjs';

/**
 * Webcam -> landmarks -> score, a 4 Hz.
 *
 * Dos decisiones de rendimiento que importan:
 *
 *   setInterval, NO requestAnimationFrame. rAF se frena a ~1 Hz en cuanto la
 *   ventana deja de estar en primer plano, incluso con backgroundThrottling
 *   desactivado (electron#9567). setInterval sobrevive.
 *
 *   4 FPS, no 30. Encorvarse tarda segundos, no milisegundos. Un frame cada
 *   250 ms basta de sobra y deja la CPU practicamente libre.
 */

const WASM_PATH = '../../vendor/tasks-vision/wasm';
const MODEL_PATH = '../../vendor/models/pose_landmarker_lite.task';
const INTERVAL_MS = 250;
const VIDEO = { width: 640, height: 480 };
const CALIBRATION_MS = 3_000;
// 30 s seguidos con el torso a otra escala antes de sugerir recalibrar.
const STALE_FRAMES_NEEDED = 120;

export class PostureCamera {
  #landmarker = null;
  #video = null;
  #stream = null;
  #timer = null;
  #ema = new EMA(ALPHAS);
  // El umbral vive en posture.mjs, junto a la definicion de facePitch: es una
  // propiedad de la medida, no de la ventana de gracia.
  #glance = new GlanceGate({ threshold: PITCH_DOWN_THRESHOLD });
  #staleFrames = 0;
  #lastTimestamp = -1;

  #baseline = null;
  #sensitivity = 1;
  #cameraId = undefined;
  #calibrating = null;

  /** @param onResult recibe {score, breakdown, deviations, raw} o {score:null} */
  constructor(onResult, onError) {
    this.onResult = onResult;
    this.onError = onError ?? ((e) => console.error(e));
  }

  configure({ baseline, sensitivity, glanceGraceMs, smoothingMs, cameraId }) {
    // Cambiar de camara obliga a reabrir el stream. La base deja de valer:
    // otra camara es otro angulo y otra distancia, o sea otro montaje.
    if (cameraId !== undefined && cameraId !== this.#cameraId) {
      const primera = this.#cameraId === undefined;
      this.#cameraId = cameraId;
      if (!primera && this.#stream) {
        this.#openCamera(cameraId).catch((err) => this.onError(err));
      }
    }

    // Cambiar la base invalida el historial suavizado: las desviaciones pasan
    // a medirse contra otra referencia.
    if (baseline !== undefined && baseline !== this.#baseline) {
      this.#baseline = baseline;
      this.#ema.reset();
      this.#glance.reset();
      this.#staleFrames = 0;
    }
    if (sensitivity !== undefined) this.#sensitivity = sensitivity;
    if (glanceGraceMs !== undefined) this.#glance.configure({ graceMs: glanceGraceMs });

    if (smoothingMs !== undefined) {
      // El usuario ajusta una constante de tiempo en ms, que es intuitiva;
      // aqui se traduce a alpha con la relacion estandar del filtro de primer
      // orden, alpha = 1 - e^(-dt/tau). Las proporciones entre metricas se
      // conservan: todas escalan respecto al mismo alpha de referencia, asi que
      // las de angulo siguen siendo tres veces mas lentas que las demas.
      const target = 1 - Math.exp(-INTERVAL_MS / Math.max(120, smoothingMs));
      const factor = target / REFERENCE_ALPHA;
      this.#ema.alphas = Object.fromEntries(
        Object.entries(ALPHAS).map(([k, a]) => [k, Math.min(0.9, a * factor)])
      );
    }
  }

  async start(deviceId) {
    if (deviceId !== undefined) this.#cameraId = deviceId;
    await this.#initLandmarker();
    await this.#openCamera(this.#cameraId);

    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.#tick(), INTERVAL_MS);
  }

  /**
   * Camaras disponibles. Solo devuelve nombres si ya se concedio el permiso,
   * asi que se llama despues de abrir el stream.
   */
  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Camara ${i + 1}` }));
  }

  async #initLandmarker() {
    if (this.#landmarker) return;

    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    };

    try {
      this.#landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    } catch (err) {
      // Algunos portatiles con graficas hibridas fallan al inicializar WebGL
      // en una ventana transparente. En CPU el modelo lite va sobrado a 4 FPS.
      console.warn('Delegado GPU no disponible, se usa CPU:', err.message);
      options.baseOptions.delegate = 'CPU';
      this.#landmarker = await PoseLandmarker.createFromOptions(fileset, options);
    }
  }

  async #openCamera(deviceId) {
    this.#stopStream();

    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, ...VIDEO }
        : { facingMode: 'user', ...VIDEO },
    };

    try {
      this.#stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (deviceId) {
        // La camara guardada ya no esta (desconectada, o cambio de indice).
        console.warn('La camara elegida no responde, se prueba la de por defecto');
        this.#stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', ...VIDEO },
        });
      } else {
        throw err;
      }
    }

    if (!this.#video) {
      this.#video = document.createElement('video');
      this.#video.playsInline = true;
      this.#video.muted = true;
    }
    this.#video.srcObject = this.#stream;
    await this.#video.play();
  }

  #tick() {
    try {
      const result = this.#detect();
      if (result) this.onResult(result);
    } catch (err) {
      this.onError(err);
    }
  }

  #detect() {
    const video = this.#video;
    if (!this.#landmarker || !video || video.readyState < 2) return null;

    // detectForVideo exige marcas de tiempo estrictamente crecientes; si el
    // video no ha avanzado, repetir el timestamp lanza una excepcion.
    const ts = Math.max(this.#lastTimestamp + 1, Math.round(performance.now()));
    this.#lastTimestamp = ts;

    const detection = this.#landmarker.detectForVideo(video, ts);
    const landmarks = detection?.landmarks?.[0] ?? null;
    const aspect = video.videoWidth / video.videoHeight || 4 / 3;

    const raw = landmarks ? rawFeatures(landmarks, aspect) : null;

    if (this.#calibrating) {
      this.#calibrating.samples.push(raw);
      if (performance.now() >= this.#calibrating.until) this.#finishCalibration();
      return { score: null, calibrating: true };
    }

    if (!raw) {
      // Sin persona no se limpia el EMA: un parpadeo del detector no debe
      // borrar el contexto acumulado. De la ausencia larga ya se ocupa la
      // auto-pausa en policy.js.
      return { score: null, breakdown: null, deviations: null, raw: null };
    }

    if (!this.#baseline) return { score: null, needsCalibration: true, raw };

    // Miras al teclado? Entonces el cuello se acorta por flexion cervical, no
    // por encorvarte, y penalizarlo seria injusto. La gracia caduca: con la
    // cabeza gacha mucho rato vuelve a contar.
    const down = pitchDown(raw, this.#baseline);
    const glance = this.#glance.update(down, performance.now());

    // Con la cara girada, la separacion entre ojos se escorza -- y es nuestra
    // unidad de escala. Todo lo que dependa de ella deja de valer este frame.
    const turned = raw.faceYaw > MAX_YAW;

    const suppress = [
      ...(glance.forgiven ? ['neckLength'] : []),
      ...(turned ? YAW_SENSITIVE : []),
    ];

    const smoothed = this.#ema.update(deviations(raw, this.#baseline));
    const s = score(smoothed, {
      sensitivity: this.#sensitivity,
      suppress: suppress.length ? suppress : null,
    });

    return {
      score: s.value,
      breakdown: s.breakdown,
      deviations: smoothed,
      raw,
      turned,
      stale: this.#trackStaleness(raw),
      glance: { ...glance, pitchDown: down },
    };
  }

  /**
   * La base se queda obsoleta al cambiar de sitio (otra mesa, otra silla, la
   * camara movida). Un frame suelto no significa nada, asi que solo se avisa
   * tras verlo sostenido: si no, girarse a hablar lo dispararia.
   */
  #trackStaleness(raw) {
    if (baselineLooksStale(raw, this.#baseline)) this.#staleFrames++;
    else this.#staleFrames = Math.max(0, this.#staleFrames - 2); // se olvida rapido
    return this.#staleFrames >= STALE_FRAMES_NEEDED;
  }

  /** Promedia ~3 s de frames para fijar la linea base personal. */
  startCalibration() {
    // Una peticion que llega con otra en curso se ignora en vez de reiniciar
    // la cuenta. Reiniciar produciria dos resultados para una sola peticion, y
    // quien la pidio ya no sabria cual es el bueno.
    if (this.#calibrating) return false;
    this.#calibrating = { samples: [], until: performance.now() + CALIBRATION_MS };
    return true;
  }

  #finishCalibration() {
    const { samples } = this.#calibrating;
    this.#calibrating = null;

    const baseline = averageFeatures(samples);
    const validos = samples.filter(Boolean).length;

    // Con menos de la mitad de frames buenos la base saldria sesgada por los
    // pocos instantes en que el detector si te vio.
    if (!baseline || validos < samples.length / 2) {
      this.onCalibrationDone?.({
        ok: false,
        error: 'No se te ve bien. Colocate de frente, con los hombros visibles y buena luz.',
      });
      return;
    }

    this.#baseline = baseline;
    this.#ema.reset();
    this.onCalibrationDone?.({ ok: true, baseline });
  }

  #stopStream() {
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#stream = null;
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#stopStream();
  }
}
