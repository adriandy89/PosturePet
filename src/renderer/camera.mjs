import { FilesetResolver, PoseLandmarker } from '../../vendor/tasks-vision/vision_bundle.mjs';
import {
  ALPHAS,
  REFERENCE_ALPHA,
  MAX_YAW,
  YAW_SENSITIVE,
  PITCH_DOWN_THRESHOLD,
  LM,
  rawFeatures,
  averageFeatures,
  deviations,
  pitchDown,
  readiness,
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
const VIDEO = { width: 640, height: 480 };

// Valores de partida. Los definitivos llegan de los ajustes por configure();
// estos solo cubren el arranque, antes del primer config:update.
const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_CALIBRATION_MS = 3_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_PREVIEW_INTERVAL_MS = 100;

/**
 * Tamano y calidad del fotograma que se manda a la ventana de ajustes.
 *
 * 320x240 comprimido a JPEG 0.55 son ~10 KB. A 10 fps eso es 100 KB/s por un
 * canal de IPC dentro del mismo proceso: irrelevante. Subirlo a 640x480 lo
 * cuadruplica sin que se note en un recuadro de este tamano.
 */
const PREVIEW = { width: 320, height: 240, quality: 0.55 };

/** Lineas del esqueleto, por pares de landmarks. */
const SKELETON = [
  [LM.LEFT_EYE, LM.RIGHT_EYE],
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
];

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

  #intervalMs = DEFAULT_INTERVAL_MS;
  #calibrationMs = DEFAULT_CALIBRATION_MS;
  #staleMs = DEFAULT_STALE_MS;
  // El suavizado se pide en milisegundos y se traduce a alphas; hay que
  // recordarlo porque cambiar el intervalo obliga a rehacer esa traduccion.
  #smoothingMs = 1_000;

  // Preview. Todo esto solo existe mientras la capa de calibracion esta
  // abierta: apagado no hay canvas, ni temporizador, ni landmarks retenidos.
  #previewIntervalMs = DEFAULT_PREVIEW_INTERVAL_MS;
  #previewTimer = null;
  #previewCanvas = null;
  #previewCtx = null;
  // Los landmarks se guardan SOLO para dibujar el esqueleto, y no salen de esta
  // ventana: se pintan sobre el canvas antes de codificar, asi que lo que cruza
  // el IPC es una imagen, nunca coordenadas. Es la misma regla que documenta
  // serialize() en mascot.mjs.
  #lastLandmarks = null;

  /** @param onResult recibe {score, breakdown, deviations, raw} o {score:null} */
  constructor(onResult, onError) {
    this.onResult = onResult;
    this.onError = onError ?? ((e) => console.error(e));
    /** @type {?(dataUrl: string) => void} */
    this.onPreview = null;
  }

  configure({
    baseline, sensitivity, glanceGraceMs, smoothingMs, cameraId,
    calibrationMs, detectionIntervalMs, staleAfterMs, previewIntervalMs,
  }) {
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
    if (calibrationMs !== undefined) this.#calibrationMs = calibrationMs;
    if (staleAfterMs !== undefined) this.#staleMs = staleAfterMs;

    if (previewIntervalMs !== undefined && previewIntervalMs !== this.#previewIntervalMs) {
      this.#previewIntervalMs = previewIntervalMs;
      if (this.#previewTimer) this.#restartPreviewLoop();
    }

    // Cambiar el ritmo de analisis obliga a rehacer los alphas: el mismo alpha
    // a otra cadencia significa otra constante de tiempo, y el deslizador de
    // estabilidad dejaria de valer lo que dice.
    if (detectionIntervalMs !== undefined && detectionIntervalMs !== this.#intervalMs) {
      this.#intervalMs = detectionIntervalMs;
      this.#applySmoothing();
      if (this.#timer) this.#restartLoop();
    }

    if (smoothingMs !== undefined) {
      this.#smoothingMs = smoothingMs;
      this.#applySmoothing();
    }
  }

  /**
   * Constante de tiempo (ms) -> alpha por metrica.
   *
   * El usuario ajusta una constante de tiempo, que es intuitiva; aqui se
   * traduce con la relacion estandar del filtro de primer orden,
   * alpha = 1 - e^(-dt/tau). Las proporciones entre metricas se conservan:
   * todas escalan respecto al mismo alpha de referencia, asi que las de angulo
   * siguen siendo tres veces mas lentas que las demas.
   */
  #applySmoothing() {
    const target = 1 - Math.exp(-this.#intervalMs / Math.max(120, this.#smoothingMs));
    const factor = target / REFERENCE_ALPHA;
    this.#ema.alphas = Object.fromEntries(
      Object.entries(ALPHAS).map(([k, a]) => [k, Math.min(0.9, a * factor)])
    );
  }

  #restartLoop() {
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.#tick(), this.#intervalMs);
  }

  // ------------------------------------------------------------- preview

  /**
   * Enciende o apaga el envio de fotogramas a la ventana de ajustes.
   *
   * Va en un temporizador propio, no en el de deteccion: a 4 Hz el video se ve
   * a tirones, y subir la deteccion a 10 Hz solo para que el preview luzca bien
   * seria pagar inferencia de mas durante toda la sesion. Aqui el trabajo extra
   * es un drawImage y un JPEG, y solo mientras la capa esta abierta.
   */
  enablePreview(enabled) {
    if (Boolean(enabled) === Boolean(this.#previewTimer)) return;

    if (!enabled) {
      clearInterval(this.#previewTimer);
      this.#previewTimer = null;
      // Se sueltan el canvas y los landmarks: apagado no debe quedar nada de
      // la imagen retenido en memoria.
      this.#previewCanvas = null;
      this.#previewCtx = null;
      this.#lastLandmarks = null;
      return;
    }

    this.#restartPreviewLoop();
  }

  #restartPreviewLoop() {
    clearInterval(this.#previewTimer);
    this.#previewTimer = setInterval(() => this.#emitPreview(), this.#previewIntervalMs);
  }

  #emitPreview() {
    const video = this.#video;
    if (!this.onPreview || !video || video.readyState < 2) return;

    if (!this.#previewCanvas) {
      this.#previewCanvas = document.createElement('canvas');
      this.#previewCanvas.width = PREVIEW.width;
      this.#previewCanvas.height = PREVIEW.height;
      // El canvas se lee entero cada frame con toDataURL: avisarlo deja a
      // Chromium elegir un respaldo que no penalice esas lecturas.
      this.#previewCtx = this.#previewCanvas.getContext('2d', { willReadFrequently: true });
    }

    const ctx = this.#previewCtx;
    ctx.drawImage(video, 0, 0, PREVIEW.width, PREVIEW.height);
    if (this.#lastLandmarks) this.#drawSkeleton(ctx);

    try {
      this.onPreview(this.#previewCanvas.toDataURL('image/jpeg', PREVIEW.quality));
    } catch (err) {
      // Un canvas "tainted" no deberia ocurrir con un stream propio, pero si
      // ocurriera, fallar en bucle cada 100 ms seria peor que apagar el preview.
      console.warn('No se pudo generar el preview:', err.message);
      this.enablePreview(false);
    }
  }

  /**
   * Cabeza y hombros sobre el fotograma. No es decoracion: es la respuesta a
   * "me esta viendo?", que es justo lo que no se podia saber antes de calibrar.
   *
   * Las coordenadas de MediaPipe son fracciones del encuadre, asi que escalan
   * al canvas sin tocar el factor de aspecto -- ese solo hace falta para medir
   * angulos, no para pintar.
   */
  #drawSkeleton(ctx) {
    const lm = this.#lastLandmarks;
    const at = (i) => ({ x: lm[i].x * PREVIEW.width, y: lm[i].y * PREVIEW.height });

    const lEye = at(LM.LEFT_EYE);
    const rEye = at(LM.RIGHT_EYE);
    const lSh = at(LM.LEFT_SHOULDER);
    const rSh = at(LM.RIGHT_SHOULDER);

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(76, 154, 255, 0.9)';
    ctx.lineCap = 'round';

    for (const [a, b] of SKELETON) {
      const p = at(a);
      const q = at(b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }

    // El cuello: de la linea de los ojos a la de los hombros. Es la metrica de
    // mas peso, asi que verla dibujada ayuda a entender que mide la app.
    ctx.beginPath();
    ctx.moveTo((lEye.x + rEye.x) / 2, (lEye.y + rEye.y) / 2);
    ctx.lineTo((lSh.x + rSh.x) / 2, (lSh.y + rSh.y) / 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(76, 154, 255, 0.95)';
    for (const i of [LM.NOSE, LM.LEFT_EYE, LM.RIGHT_EYE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER]) {
      const p = at(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  async start(deviceId) {
    if (deviceId !== undefined) this.#cameraId = deviceId;
    await this.#initLandmarker();
    await this.#openCamera(this.#cameraId);
    this.#restartLoop();
  }

  /**
   * Camaras disponibles. Solo devuelve nombres si ya se concedio el permiso,
   * asi que se llama despues de abrir el stream.
   */
  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Sin etiqueta se manda el indice y el nombre lo compone la ventana de
    // ajustes, que es la que sabe en que idioma corre la interfaz.
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || '', index: i + 1 }));
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

    // Solo se retienen si hay que dibujarlos; ver el comentario del campo.
    if (this.#previewTimer) this.#lastLandmarks = landmarks;

    // Las comprobaciones de preparacion viajan en TODOS los caminos de salida,
    // tambien mientras se calibra: la capa las sigue mostrando durante la
    // captura, y quedarse sin ellas a mitad las dejaria congeladas en verde.
    const ready = readiness(landmarks, aspect, raw);

    if (this.#calibrating) {
      this.#calibrating.samples.push(raw);
      if (performance.now() >= this.#calibrating.until) this.#finishCalibration();
      return { score: null, calibrating: true, ready };
    }

    if (!raw) {
      // Sin persona no se limpia el EMA: un parpadeo del detector no debe
      // borrar el contexto acumulado. De la ausencia larga ya se ocupa la
      // auto-pausa en policy.js.
      return { score: null, breakdown: null, deviations: null, raw: null, ready };
    }

    if (!this.#baseline) return { score: null, needsCalibration: true, raw, ready };

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
      ready,
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
    // El umbral se cuenta en frames, pero se configura en tiempo: asi cambiar
    // la frecuencia de analisis no altera cuanto tarda en avisar.
    return this.#staleFrames >= Math.ceil(this.#staleMs / this.#intervalMs);
  }

  /** Promedia ~3 s de frames para fijar la linea base personal. */
  startCalibration() {
    // Una peticion que llega con otra en curso se ignora en vez de reiniciar
    // la cuenta. Reiniciar produciria dos resultados para una sola peticion, y
    // quien la pidio ya no sabria cual es el bueno.
    if (this.#calibrating) return false;
    this.#calibrating = { samples: [], until: performance.now() + this.#calibrationMs };
    return true;
  }

  /**
   * Tira las muestras y no avisa a nadie.
   *
   * Sin esto, cancelar solo cerraria la capa: la captura seguiria hasta el
   * final y acabaria guardando la base igualmente. El usuario habria pulsado
   * "Cancelar" y su calibracion anterior estaria pisada de todos modos.
   */
  abortCalibration() {
    if (!this.#calibrating) return false;
    this.#calibrating = null;
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
      // Se manda la clave, no el texto: este modulo no sabe -- ni debe saber --
      // en que idioma corre la interfaz que acabara mostrando el fallo.
      this.onCalibrationDone?.({ ok: false, errorKey: 'errors.calibrationNoSubject' });
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
    this.enablePreview(false);
    this.#stopStream();
  }
}
