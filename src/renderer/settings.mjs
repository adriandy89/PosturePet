import { METRICS, MOVEMENT_LIMIT } from './posture.mjs';
import { CalibrationFlow, PHASE, CHECKS } from './calibration.mjs';
import { AVATARS, DEFAULT_AVATAR, avatarSvg } from './avatars.mjs';
import { t, setCatalog, applyDom, applyHtmlLang } from './i18n.mjs';

/**
 * Ventana de ajustes. Tres trabajos:
 *   - los interruptores y deslizadores de la configuracion, repartidos en
 *     pestanas para que no sea una sola pagina interminable
 *   - el panel de depuracion en vivo, que es la herramienta con la que se
 *     comprueba que cada gesto dispara la metrica que le toca
 *   - traducirse entero en caliente cuando cambia el idioma
 */

const $ = (id) => document.getElementById(id);

/**
 * Mostrar u ocultar por atributo, no por la propiedad `.hidden`.
 *
 * `.hidden` esta definida en HTMLElement, NO en SVGElement: sobre un <svg>,
 * `el.hidden = false` crea una propiedad JavaScript inventada y el atributo se
 * queda como estaba. El elemento no aparece nunca y no falla nada -- que es
 * como el anillo de progreso de la calibracion se quedo invisible mientras el
 * codigo calculaba su arco correctamente.
 */
const setHidden = (el, hide) => el.toggleAttribute('hidden', Boolean(hide));
const RING_LENGTH = 264; // 2*pi*42, el radio del circulo del SVG

let config = null;
let limits = null;
let paused = false;
let cameraList = [];

// --------------------------------------------------------------- pestanas

const TABS = ['posture', 'avatar', 'alerts', 'sensitivity', 'times', 'camera', 'system'];

function selectTab(name) {
  for (const id of TABS) {
    const tab = $(`tab-${id}`);
    const panel = $(`panel-${id}`);
    const active = id === name;
    tab.setAttribute('aria-selected', String(active));
    // tabindex -1 en las inactivas: dentro de un tablist, Tab salta al panel y
    // son las flechas las que recorren las pestanas.
    tab.tabIndex = active ? 0 : -1;
    setHidden(panel, !active);
  }
  // Cada pestana empieza por arriba: heredar el scroll de la anterior deja al
  // usuario mirando la mitad de una seccion sin saber por que.
  document.querySelector('main').scrollTop = 0;
}

for (const [i, id] of TABS.entries()) {
  const tab = $(`tab-${id}`);
  tab.addEventListener('click', () => selectTab(id));
  tab.addEventListener('keydown', (e) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(i + delta + TABS.length) % TABS.length];
    selectTab(next);
    $(`tab-${next}`).focus();
  });
}

// --------------------------------------------------- panel de depuracion

/**
 * Las barras se pintan en todos los contenedores [data-metrics] a la vez.
 * Hay dos: uno en la pestana Postura y otro junto a los deslizadores de
 * sensibilidad, porque ajustar sin ver reaccionar las barras es ajustar a
 * ciegas. Una sola pasada de render alimenta los dos.
 */
const rows = new Map();

for (const key of Object.keys(METRICS)) rows.set(key, []);

for (const box of document.querySelectorAll('[data-metrics]')) {
  for (const key of Object.keys(METRICS)) {
    const row = document.createElement('div');
    row.className = 'metric';
    row.innerHTML =
      '<div class="metric-name"></div>' +
      '<div class="metric-bar"><div class="metric-fill"></div></div>' +
      '<div class="metric-value">--</div>';
    box.append(row);
    rows.get(key).push({
      el: row,
      name: row.querySelector('.metric-name'),
      fill: row.querySelector('.metric-fill'),
      value: row.querySelector('.metric-value'),
    });
  }
}

/** Los nombres de las metricas vienen del catalogo, no del desglose. */
function renderMetricNames() {
  for (const [key, list] of rows) {
    for (const row of list) row.name.textContent = t(`metrics.${key}`);
  }
}

const toneFor = (badness) =>
  badness > 0.66 ? 'var(--bad)' : badness > 0.33 ? 'var(--warn)' : 'var(--good)';

function renderMetrics(breakdown) {
  for (const [key, list] of rows) {
    const m = breakdown?.[key];
    for (const row of list) {
      if (!m) {
        row.fill.style.width = '0%';
        row.value.textContent = '--';
        row.el.classList.remove('muted');
        continue;
      }
      // Una metrica perdonada se marca en vez de ocultarse: si no, parece que
      // el detector ha dejado de funcionar.
      row.el.classList.toggle('muted', Boolean(m.muted));
      row.fill.style.width = `${Math.round(m.badness * 100)}%`;
      row.fill.style.background = toneFor(m.badness);
      // La desviacion cruda es mas util que la puntuacion al afinar umbrales:
      // dice cuanto te has movido, no solo cuanto penaliza.
      row.value.textContent = m.deviation.toFixed(2);
    }
  }
}

/** Explica en una linea que esta pasando con la mirada. */
let lastGlance = null;

function renderGlance(glance) {
  lastGlance = glance;
  const note = $('glance-note');
  if (!glance?.glancing) {
    setHidden(note, true);
    return;
  }
  const s = Math.round(glance.heldMs / 1000);
  setHidden(note, false);
  note.className = glance.forgiven ? 'note ok' : 'note warn';
  // Se nombra la metrica con su etiqueta real para que se vea cual de las
  // barras de arriba es la que esta tachada.
  note.textContent = glance.forgiven
    ? t('status.glanceForgiven', { s, metric: t('metrics.neckLength') })
    : t('status.glanceExpired', { s });
}

function renderScore(score) {
  const ring = $('ring');
  if (score === null || score === undefined) {
    $('score-value').textContent = '--';
    ring.style.strokeDashoffset = String(RING_LENGTH);
    ring.style.stroke = 'var(--muted)';
    return;
  }
  $('score-value').textContent = String(score);
  ring.style.strokeDashoffset = String(RING_LENGTH * (1 - score / 100));
  ring.style.stroke = score >= 70 ? 'var(--good)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
}

/**
 * El estado se guarda como clave + variables, no como texto ya compuesto: al
 * cambiar de idioma hay que poder rehacerlo, y con la app en pausa no llega
 * ningun frame que lo refresque solo.
 */
let lastStatus = { key: 'status.starting', vars: null, tone: '' };

function setStatus(key, vars = null, tone = '') {
  lastStatus = { key, vars, tone };
  const el = $('status');
  el.textContent = t(key, vars);
  el.className = tone;
}

window.api.onTelemetry((telemetry) => {
  renderScore(telemetry.score);
  renderMetrics(telemetry.breakdown);
  renderGlance(telemetry.glance);
  renderStale(telemetry.stale);

  // La telemetria es la unica fuente de las comprobaciones, pero llega a 4 Hz:
  // quien mueve la maquina de estados es el latido de 20 Hz, para que la cuenta
  // atras no vaya a tirones.
  if (telemetry.ready) latestReadiness = telemetry.ready;

  if (paused) return setStatus('status.paused');
  if (telemetry.cameraError) {
    return setStatus('status.cameraError', { error: telemetry.cameraError }, 'bad');
  }
  if (telemetry.calibrating) return setStatus('status.calibrating');
  if (telemetry.needsCalibration) return setStatus('status.needsCalibration', null, 'warn');
  if (telemetry.score === null) return setStatus('status.notVisible');
  if (telemetry.turned) return setStatus('status.turned');

  if (telemetry.state === 'bad') {
    setStatus('status.bad', { s: Math.round(telemetry.badForMs / 1000) }, 'bad');
  } else {
    setStatus('status.good', null, 'good');
  }
});

// -------------------------------------------------------------- perfiles

function renderProfiles(cfg) {
  const box = $('profiles');
  box.replaceChildren();

  for (const p of cfg.profiles) {
    const row = document.createElement('label');
    row.className = 'profile' + (p.id === cfg.activeProfileId ? ' active' : '');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'profile';
    radio.checked = p.id === cfg.activeProfileId;
    radio.addEventListener('change', async () => {
      // Cambiar de perfil desarma cualquier borrado a medias: si no, el clic
      // siguiente borraria un perfil distinto del que se armo.
      resetDeleteButton();
      applyConfig(await window.api.activateProfile(p.id));
    });

    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = p.name;
    const state = document.createElement('em');
    state.textContent = t(p.baseline ? 'profiles.calibrated' : 'profiles.uncalibrated');
    text.append(name, state);

    row.append(radio, text);
    box.append(row);
  }

  // El boton de eliminar solo tiene sentido con mas de un perfil: siempre
  // debe quedar uno donde guardar la calibracion.
  $('delete-profile').disabled = cfg.profiles.length <= 1;
}

/**
 * Pedir un nombre en linea, no con prompt(): Electron no implementa
 * window.prompt() -- lanzaria y el boton no haria nada.
 */
let pendingMode = null; // 'add' | 'rename'

function openNameForm(mode, initial = '') {
  pendingMode = mode;
  setHidden($('profile-form'), false);
  setHidden($('profile-actions'), true);
  const input = $('profile-name');
  input.value = initial;
  input.focus();
  input.select();
}

function closeNameForm() {
  pendingMode = null;
  setHidden($('profile-form'), true);
  setHidden($('profile-actions'), false);
  resetDeleteButton();
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('profile-name').value;
  const mode = pendingMode;
  closeNameForm();

  if (mode === 'add') {
    applyConfig(await window.api.addProfile(name));
    setStatus('status.profileCreated', null, 'warn');
  } else if (mode === 'rename') {
    applyConfig(await window.api.renameProfile(config.activeProfileId, name));
  }
});

$('profile-cancel').addEventListener('click', closeNameForm);
$('add-profile').addEventListener('click', () => openNameForm('add'));
$('rename-profile').addEventListener('click', () =>
  openNameForm('rename', activeProfileName())
);

/**
 * Borrar pide confirmacion en dos pasos en vez de con confirm(): un dialogo
 * nativo bloquea el proceso y congelaria el bucle de la camara mientras esta
 * abierto.
 */
let deleteArmed = false;

function resetDeleteButton() {
  deleteArmed = false;
  const btn = $('delete-profile');
  btn.textContent = t('settings.profiles.delete');
  btn.classList.remove('danger');
}

$('delete-profile').addEventListener('click', async () => {
  const btn = $('delete-profile');
  if (!deleteArmed) {
    deleteArmed = true;
    btn.textContent = t('settings.profiles.confirmDelete', { name: activeProfileName() });
    btn.classList.add('danger');
    return;
  }
  resetDeleteButton();
  applyConfig(await window.api.deleteProfile(config.activeProfileId));
});

/** Aviso de que la base ya no encaja con lo que ve la camara. */
let staleNow = false;

function renderStale(stale) {
  staleNow = Boolean(stale);
  const note = $('stale-note');
  setHidden(note, !staleNow);
  if (staleNow) note.textContent = t('status.stale');
}

// ------------------------------------------------------------ calibracion

/**
 * La capa guiada. Las transiciones viven en calibration.mjs (puro y testeado);
 * aqui solo se pinta lo que diga y se ejecuta lo que pida.
 */
const flow = new CalibrationFlow();

/** Ultimas comprobaciones recibidas por telemetria. */
let latestReadiness = null;

// Una fila por comprobacion, construida una vez.
const checkRows = new Map();
for (const name of CHECKS) {
  const li = document.createElement('li');
  const mark = document.createElement('span');
  mark.className = 'mark';
  const label = document.createElement('span');
  li.append(mark, label);
  $('calib-checks').append(li);
  checkRows.set(name, { li, mark, label });
}

function openCalibration() {
  flow.configure({
    countdownMs: config?.calibrationCountdownMs ?? 3_000,
    captureMs: config?.calibrationMs ?? 3_000,
  });
  flow.open();
  setHidden($('calib'), false);
  $('calib-video').removeAttribute('src');
  // Deshacer es de la calibracion que se acaba de hacer, no de la siguiente.
  setHidden($('calib-undo'), true);
  window.api.setPreview(true);
  startBeat();
  renderCalibration();
  $('calib-cancel').focus();
}

function closeCalibration() {
  const wasCapturing = flow.phase === PHASE.CAPTURING;
  flow.cancel();
  stopBeat();
  setHidden($('calib'), true);
  window.api.setPreview(false);
  // El ultimo fotograma se queda en el <img> mientras la ventana siga abierta.
  // No es mucho, pero es una imagen de tu cara retenida sin que nadie la mire.
  $('calib-video').removeAttribute('src');
  // Cancelar a mitad de captura tiene que llegar al detector: si no, la
  // captura termina sola y pisa la base anterior pese al "Cancelar".
  if (wasCapturing) window.api.cancelCalibration();
  $('calibrate').focus();
}

/** Tic de la cuenta atras. Se emite al cambiar el numero, no en cada frame. */
let lastCountdown = null;

function renderCalibration() {
  if (!flow.active) return;

  const now = performance.now();
  const phase = flow.phase;
  const readiness = flow.readiness;

  for (const [name, row] of checkRows) {
    const ok = Boolean(readiness[name]);
    row.li.classList.toggle('ok', ok);
    row.mark.textContent = ok ? '✓' : '·';
    row.label.textContent = t(`settings.calibration.checks.${name}`);
  }

  const counting = phase === PHASE.COUNTDOWN;
  const capturing = phase === PHASE.CAPTURING;
  const done = phase === PHASE.DONE;

  setHidden($('calib-countdown'), !counting);
  setHidden($('calib-progress'), !capturing);
  setHidden($('calib-checks'), done);

  if (counting) {
    const seconds = flow.countdownSeconds(now);
    $('calib-countdown').textContent = String(seconds);
    if (seconds !== lastCountdown) {
      lastCountdown = seconds;
      // Un tic corto, no el aviso de dos notas: encadenar tres avisos completos
      // en tres segundos suena a alarma, que es justo lo contrario de lo que
      // hace falta mientras alguien intenta sentarse bien.
      if (config?.alerts?.sound) window.api.playSound('tick');
    }
  } else {
    lastCountdown = null;
  }

  if (capturing) {
    $('calib-bar').style.width = `${flow.captureProgress(now) * 100}%`;
  }

  setHidden($('calib-retry'), !done || flow.result?.ok);
  $('calib-cancel').textContent = t(
    done ? 'settings.calibration.close' : 'settings.calibration.cancel'
  );

  renderCalibrationNote();
}

function renderCalibrationNote() {
  const note = $('calib-note');
  const result = flow.result;

  if (flow.phase === PHASE.DONE && result) {
    if (!result.ok) {
      note.className = 'note warn';
      note.textContent = t(result.errorKey ?? 'errors.calibrationNoSubject');
      return;
    }
    // Promediar sin mirar la dispersion acepta encantado una base emborronada.
    const moved = (result.baseline?.spread ?? 0) > MOVEMENT_LIMIT;
    note.className = moved ? 'note warn' : 'note ok';
    note.textContent = moved
      ? t('settings.calibration.moved')
      : `${t('settings.calibration.ok')} ${t('settings.calibration.okDetail', {
          n: result.baseline?.sampleCount ?? 0,
        })}`;
    return;
  }

  if (flow.phase === PHASE.CAPTURING) {
    note.className = 'note';
    note.textContent = t('settings.calibration.hold');
    return;
  }

  // Contando ya: decir "la cuenta empieza cuando todo este en verde" mientras
  // se ve un 3 enorme en pantalla es contradecirse.
  if (flow.phase === PHASE.COUNTDOWN) {
    note.className = 'note ok';
    note.textContent = t('settings.calibration.steady');
    return;
  }

  // En preparacion: la pista de lo primero que falla, o por que se abortó.
  const failing = CHECKS.find((c) => !flow.readiness[c]);
  if (!failing) {
    note.className = 'note';
    note.textContent = t('settings.calibration.waiting');
    return;
  }
  note.className = 'note warn';
  const hint = t(`settings.calibration.hints.${failing}`);
  note.textContent = flow.lostCheck
    ? `${t('settings.calibration.lost', { check: hint })}`
    : hint;
}

/**
 * Late a 20 Hz mientras la capa esta abierta: la telemetria va a 4 Hz y la
 * cuenta atras se veria a saltos si dependiera de ella.
 *
 * Y SOLO mientras esta abierta. Antes el temporizador se creaba al cargar el
 * modulo y no se paraba nunca: veinte despertares por segundo, durante todo el
 * tiempo que la ventana de ajustes estuviese abierta, para leer una bandera y
 * volverse a dormir. La comprobacion de `flow.active` estaba dentro, asi que no
 * se notaba en el comportamiento -- solo en el consumo.
 */
let beatTimer = null;

function startBeat() {
  if (beatTimer !== null) return;
  beatTimer = setInterval(() => {
    if (!flow.active) return stopBeat();
    // En DONE no queda nada que animar: el panel del resultado es estatico y
    // lo repinta quien lo produce.
    if (flow.phase === PHASE.DONE) return;
    const { startCapture } = flow.update({ readiness: latestReadiness, now: performance.now() });
    renderCalibration();
    if (startCapture) runCapture();
  }, 50);
}

function stopBeat() {
  clearInterval(beatTimer);
  beatTimer = null;
}

async function runCapture() {
  // Cierra la cuenta atras: sin marca sonora del "ya", quien esta mirando a la
  // camara no sabe en que instante tiene que estarse quieto.
  if (config?.alerts?.sound) window.api.playSound('go');

  const result = await window.api.calibrate();
  // Si el usuario cerro la capa por el camino, finish() lo rechaza y el
  // resultado se descarta en vez de reabrirla para ensenar algo que ya abandono.
  if (!flow.finish(result)) return;

  if (result.ok) {
    setStatus('status.calibrated', null, 'good');
    setHidden($('calib-undo'), !(await window.api.canUndoCalibration()));
  } else {
    setStatus(result.errorKey ?? 'errors.calibrationNoSubject', null, 'bad');
  }
  $('calibrate').textContent = t('settings.recalibrate');
  renderCalibration();
}

$('calibrate').addEventListener('click', openCalibration);
$('calib-cancel').addEventListener('click', closeCalibration);

$('calib-retry').addEventListener('click', () => {
  flow.retry();
  setHidden($('calib-undo'), true);
  renderCalibration();
});

$('calib-undo').addEventListener('click', async () => {
  const result = await window.api.undoCalibration();
  if (!result.ok) return;
  applyConfig(result.config);
  setHidden($('calib-undo'), true);
  setStatus('settings.calibration.undone', null, 'good');
  closeCalibration();
});

// Esc cancela, que es lo que espera cualquiera de una capa como esta.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // La calibracion va encima del modal de informacion, asi que se cierra
  // primero: Esc debe deshacer lo ultimo que se abrio.
  if (flow.active) closeCalibration();
  else if (!$('about').hidden) closeAbout();
});

window.api.onPreview((dataUrl) => {
  if (flow.active) $('calib-video').src = dataUrl;
});

window.api.onStartCalibration(() => $('calibrate').click());

// ------------------------------------------------------------------ pausa

$('pause').addEventListener('click', async () => {
  paused = await window.api.togglePause();
  renderPause();
});

/**
 * La pausa tambien se conmuta desde la bandeja, con esta ventana delante. Sin
 * escucharlo, el boton se quedaba diciendo "Pausar" con la app ya pausada.
 *
 * Y si pillaba a la calibracion abierta era peor: la capa seguia con su cuenta
 * atras sobre las ultimas comprobaciones recibidas, sin camara detras, para
 * acabar en un error. Se cierra, que es lo unico honesto que se puede hacer.
 */
window.api.onPause((next) => {
  paused = next;
  renderPause();
  if (next && flow.active) closeCalibration();
});

function renderPause() {
  $('pause').textContent = t(paused ? 'settings.resume' : 'settings.pause');
  if (paused) setStatus('status.pausedLong');
}

// ------------------------------------------------------------------ ajustes

/** Guarda sin bloquear la interfaz; los cambios se aplican al vuelo. */
const patch = (p) => window.api.patchSettings(p);

for (const box of document.querySelectorAll('[data-alert]')) {
  box.addEventListener('change', () => {
    patch({ alerts: { ...config.alerts, [box.dataset.alert]: box.checked } });
  });
}

$('autostart').addEventListener('change', (e) => window.api.setAutostart(e.target.checked));
$('test-sound').addEventListener('click', () => window.api.playSound('nag'));

// ------------------------------------------------------------- restaurar

/**
 * Cada seccion restaura lo suyo. Sin confirmacion en dos pasos: volver a
 * mover un deslizador cuesta un segundo, asi que pedir confirmacion seria mas
 * molesto que el error que evita. La restauracion global si la pide, porque
 * ahi se pierde el ajuste fino de toda la app de golpe.
 */
for (const btn of document.querySelectorAll('[data-reset]')) {
  btn.addEventListener('click', async () => {
    applyConfig(await window.api.resetSettings(btn.dataset.reset));
    flashRestored(btn);
  });
}

/** Confirmacion efimera en el propio boton: sin dialogos ni notificaciones. */
const flashTimers = new Map();

function flashRestored(btn) {
  clearTimeout(flashTimers.get(btn));
  btn.classList.add('done');
  btn.textContent = t('settings.resetDone');
  flashTimers.set(btn, setTimeout(() => {
    flashTimers.delete(btn);
    btn.classList.remove('done');
    btn.textContent = t('settings.resetSection');
  }, 1_400));
}

let resetAllArmed = false;

function resetAllButton() {
  resetAllArmed = false;
  const btn = $('reset-all');
  btn.textContent = t('settings.system.reset');
  btn.classList.remove('danger');
}

$('reset-all').addEventListener('click', async () => {
  const btn = $('reset-all');
  if (!resetAllArmed) {
    resetAllArmed = true;
    btn.textContent = t('settings.system.resetArmed');
    btn.classList.add('danger');
    return;
  }
  resetAllArmed = false;
  applyConfig(await window.api.resetSettings());
  resetAllButton();
  setStatus('status.settingsReset', null, 'good');
});

// ---------------------------------------------------------------- camara

function renderCameras(list) {
  cameraList = Array.isArray(list) ? list : [];
  const select = $('camera');
  select.replaceChildren();

  select.append(new Option(t('camera.auto'), ''));
  for (const c of cameraList) {
    // Sin permiso concedido el navegador no da nombre; el numero lo pone esta
    // ventana, que es la que sabe el idioma.
    select.append(new Option(c.label || t('camera.numbered', { n: c.index }), c.id));
  }

  select.value = config?.cameraId ?? '';
  // Con una sola camara el desplegable no aporta nada.
  select.disabled = cameraList.length <= 1;
}

$('camera').addEventListener('change', (e) => {
  patch({ cameraId: e.target.value || null });
  setStatus('status.cameraChanged', null, 'warn');
});

window.api.onCameras(renderCameras);

// ------------------------------------------------------------- personaje

/**
 * La rejilla de seleccion pinta los seis avatares con el MISMO SVG y el MISMO
 * CSS que la ventana del personaje, no con imagenes aparte: una miniatura que
 * se dibuje por su cuenta acaba, tarde o temprano, ensenando algo distinto de
 * lo que luego aparece en pantalla.
 */
const PREVIEW_STATES = ['good', 'warn', 'bad', 'paused', 'blind'];

let previewState = 'bad';
const avatarCards = new Map();

function buildAvatarGrid() {
  const grid = $('avatar-grid');
  const states = $('avatar-states');

  for (const state of PREVIEW_STATES) {
    const btn = document.createElement('button');
    btn.className = 'state-pick';
    btn.dataset.state = state;
    btn.addEventListener('click', () => {
      previewState = state;
      renderAvatarGrid();
    });
    states.append(btn);
  }

  for (const { id } of AVATARS) {
    const card = document.createElement('button');
    card.className = 'avatar-card';
    card.dataset.avatar = id;

    const stage = document.createElement('div');
    // La clase `pet` es la que activa todo avatar.css; la de estado la pone
    // renderAvatarGrid segun lo que se este previsualizando.
    stage.className = `pet avatar-${id}`;
    stage.innerHTML = avatarSvg(id);

    const name = document.createElement('strong');
    const note = document.createElement('em');

    card.append(stage, name, note);
    card.addEventListener('click', () => selectAvatar(id));
    grid.append(card);

    avatarCards.set(id, { card, stage, name, note });
  }
}

async function selectAvatar(id) {
  applyConfig(await window.api.patchSettings({ avatar: id }));
}

function renderAvatarGrid() {
  const current = config?.avatar ?? DEFAULT_AVATAR;

  for (const btn of $('avatar-states').children) {
    const state = btn.dataset.state;
    btn.textContent = t(`settings.avatar.states.${state}`);
    btn.classList.toggle('active', state === previewState);
    btn.setAttribute('aria-pressed', String(state === previewState));
  }

  for (const [id, { card, stage, name, note }] of avatarCards) {
    card.classList.toggle('active', id === current);
    card.setAttribute('aria-pressed', String(id === current));
    name.textContent = t(`settings.avatar.names.${id}`);
    note.textContent = t(`settings.avatar.notes.${id}`);
    for (const state of PREVIEW_STATES) {
      stage.classList.toggle(`state-${state}`, state === previewState);
    }
  }
}

buildAvatarGrid();

// ----------------------------------------------------- acerca de / version

let appVersion = '';
/** El resultado de la ultima comprobacion, para repintarlo al cambiar idioma. */
let updateState = null;

function openAbout() {
  setHidden($('about'), false);
  $('about-close').focus();
}

function closeAbout() {
  setHidden($('about'), true);
  $('about-open').focus();
}

$('about-open').addEventListener('click', openAbout);
$('about-close').addEventListener('click', closeAbout);

$('about-repo').addEventListener('click', (e) => {
  e.preventDefault();
  // Sin URL: el proceso principal usa la del repositorio, que tiene fijada.
  window.api.openReleases();
});

$('about-check').addEventListener('click', async () => {
  const btn = $('about-check');
  btn.disabled = true;
  btn.textContent = t('settings.about.checking');
  setHidden($('about-download'), true);

  updateState = await window.api.checkUpdates();

  btn.disabled = false;
  btn.textContent = t('settings.about.check');
  renderUpdateState();
});

$('about-download').addEventListener('click', () => window.api.openReleases(updateState?.url));

function renderUpdateState() {
  const note = $('about-result');
  if (!updateState) {
    note.textContent = '';
    note.className = 'note';
    setHidden($('about-download'), true);
    return;
  }

  const { status, version } = updateState;
  note.textContent = t(`settings.about.result.${status}`, { v: version ?? '?' });
  // Solo "al dia" es una buena noticia; el resto son avisos de que no se pudo
  // averiguar, y confundirlos seria decirle al usuario que esta al dia cuando
  // en realidad no se ha podido comprobar.
  note.className = status === 'current' ? 'note ok' : status === 'update' ? 'note' : 'note warn';

  // El enlace se ofrece incluso cuando la consulta falla: mirarlo a mano es
  // justo la salida cuando GitHub no contesta.
  const btn = $('about-download');
  setHidden(btn, false);
  btn.textContent = t(status === 'update' ? 'settings.about.download' : 'settings.about.seeReleases');

  // Un solo boton destacado a la vez. Con una version nueva delante, la accion
  // pasa a ser descargarla; dejar los dos en azul no señala ninguna.
  btn.classList.toggle('primary', status === 'update');
  $('about-check').classList.toggle('primary', status !== 'update');
}

function renderVersion() {
  $('about-version').textContent = appVersion ? `v${appVersion}` : '';
  $('about-version-line').textContent = t('settings.about.version', { v: appVersion });
}

// --------------------------------------------------------------- idioma

function renderLocales(payload) {
  const select = $('locale');
  select.replaceChildren();
  select.append(new Option(t('settings.language.auto'), ''));
  // El nombre de cada idioma va en ese idioma, nunca traducido.
  for (const l of payload.available) select.append(new Option(l.name, l.code));
  select.value = config?.locale ?? '';
}

$('locale').addEventListener('change', (e) => patch({ locale: e.target.value || null }));

// ------------------------------------------------------------ deslizadores

/**
 * Conecta un deslizador con una clave de config.
 *
 * El rango NO esta en el HTML: sale de LIMITS, en src/main/settings.js, que es
 * el mismo sitio donde se recorta lo que llega por IPC. Con los limites en dos
 * sitios acabarian discrepando, y un deslizador que llega hasta un valor que
 * luego el backend recorta parece averiado.
 *
 * `toValue`/`fromValue` traducen entre las unidades del control (segundos,
 * porcentajes) y las almacenadas (milisegundos, fracciones).
 */
function bindSlider(id, key, { toValue = (v) => v, fromValue = (v) => v, format }) {
  const input = $(id);
  const out = $(`${id}-out`);

  const show = () => { out.textContent = format(Number(input.value)); };

  input.addEventListener('input', show); // respuesta inmediata al arrastrar
  input.addEventListener('change', () => patch({ [key]: toValue(Number(input.value)) }));

  return {
    setLimits(all) {
      const range = all?.[key];
      if (!range) return;
      input.min = String(fromValue(range[0]));
      input.max = String(fromValue(range[1]));
    },
    sync(cfg) {
      input.value = String(fromValue(cfg[key]));
      show();
    },
    refresh: show, // al cambiar de idioma: "3 s" -> "3s", "desactivado" -> "off"
  };
}

/** Los deslizadores de tiempo se manejan en segundos y se guardan en ms. */
const seconds = (format) => ({
  toValue: (v) => Math.round(v * 1000),
  fromValue: (v) => v / 1000,
  format,
});

const showSeconds = (v) => t('units.seconds', { v });
const showMinutes = (v) =>
  v >= 60
    ? t('units.minutes', { v: (v / 60).toFixed(v % 60 ? 1 : 0) })
    : t('units.seconds', { v });

const sliders = [
  bindSlider('sensitivity', 'sensitivity', {
    format: (v) => t('units.multiplier', { v: v.toFixed(1) }),
  }),
  bindSlider('dimOpacity', 'dimOpacity', {
    format: (v) => t('units.percent', { v: Math.round(v * 100) }),
  }),
  bindSlider('dimFadeIn', 'dimFadeInMs', {
    format: (v) => t('units.seconds', { v: (v / 1000).toFixed(1) }),
  }),
  bindSlider('dimFadeOut', 'dimFadeOutMs', {
    format: (v) => t('units.milliseconds', { v }),
  }),
  bindSlider('soundVolume', 'soundVolume', {
    // El volumen se guarda como ganancia. Mostrar "0,12" no dice nada; el
    // porcentaje del maximo se lee como lo que es. El maximo sale de LIMITS y
    // no escrito a mano, para que cambiarlo alli no descuadre el porcentaje.
    format: (v) => t('units.percent', { v: Math.round((v / (limits?.soundVolume?.[1] ?? 0.4)) * 100) }),
  }),
  bindSlider('soundPitch', 'soundPitchHz', {
    format: (v) => t('units.hertz', { v }),
  }),
  bindSlider('soundGap', 'soundGapMs', { format: (v) => t('units.milliseconds', { v }) }),
  bindSlider('soundDecay', 'soundDecayMs', { format: (v) => t('units.milliseconds', { v }) }),
  bindSlider('smoothing', 'smoothingMs', {
    format: (v) => t('units.seconds', { v: (v / 1000).toFixed(1) }),
  }),
  bindSlider('enterBad', 'enterBadBelow', { format: (v) => t('units.points', { v }) }),
  bindSlider('exitBad', 'exitBadAbove', { format: (v) => t('units.points', { v }) }),
  bindSlider('glance', 'glanceGraceMs', {
    ...seconds((v) => (v === 0 ? t('units.off') : showMinutes(v))),
  }),
  bindSlider('dwell', 'dwellMs', seconds(showSeconds)),
  bindSlider('cooldown', 'nagCooldownMs', seconds(showMinutes)),
  bindSlider('mascotDelay', 'mascotDelayMs', seconds(showSeconds)),
  bindSlider('away', 'awayAfterMs', seconds(showSeconds)),
  bindSlider('calibration', 'calibrationMs', {
    ...seconds((v) => t('units.seconds', { v: v.toFixed(1) })),
  }),
  bindSlider('countdown', 'calibrationCountdownMs', {
    ...seconds((v) => (v === 0 ? t('units.off') : showSeconds(v))),
  }),
  bindSlider('interval', 'detectionIntervalMs', {
    format: (v) => t('units.milliseconds', { v }),
  }),
  bindSlider('stale', 'staleAfterMs', seconds(showMinutes)),
  bindSlider('preview', 'previewIntervalMs', {
    format: (v) => t('units.milliseconds', { v }),
  }),
];

function applyConfig(cfg) {
  config = cfg;
  for (const box of document.querySelectorAll('[data-alert]')) {
    box.checked = Boolean(cfg.alerts[box.dataset.alert]);
  }
  $('autostart').checked = Boolean(cfg.autoStart);
  $('locale').value = cfg.locale ?? '';
  for (const s of sliders) s.sync(cfg);
  renderProfiles(cfg);
  renderAvatarGrid();
}

const activeProfileOf = () =>
  config?.profiles.find((p) => p.id === config.activeProfileId) ?? null;

const activeBaseline = () => activeProfileOf()?.baseline ?? null;
const activeProfileName = () => activeProfileOf()?.name ?? '';

window.api.onConfig(applyConfig);

// ------------------------------------------------------ cambio de idioma

/**
 * Repinta la ventana entera en el idioma nuevo. Todo lo que no sale de
 * data-i18n -- listas construidas en JS, unidades de los deslizadores, el
 * estado de la cabecera -- se rehace aqui a mano.
 */
function applyStrings(payload) {
  // Se captura antes: renderPause() puede sobrescribir lastStatus por el
  // camino, y entonces el estado que habia en pantalla se perderia.
  const previous = lastStatus;

  setCatalog(payload.catalog);
  applyHtmlLang(payload.catalog?.meta?.htmlLang);
  applyDom();

  renderMetricNames();
  renderPause();
  resetDeleteButton();
  resetAllButton();
  if (config) renderProfiles(config);
  renderCameras(cameraList);
  renderLocales(payload);
  for (const s of sliders) s.refresh();

  // Los avisos vivos: si estan en pantalla, tienen que cambiar tambien.
  renderGlance(lastGlance);
  renderStale(staleNow);
  renderCalibration();
  renderAvatarGrid();
  renderVersion();
  renderUpdateState();
  if (previous) setStatus(previous.key, previous.vars, previous.tone);

  // El boton de calibrar dice cosas distintas segun si ya hay base.
  $('calibrate').textContent = t(activeBaseline() ? 'settings.recalibrate' : 'settings.calibrate');
}

window.api.onStrings(applyStrings);

// ----------------------------------------------------------------- arranque

(async () => {
  const [strings, cfg, allLimits, version] = await Promise.all([
    window.api.getStrings(),
    window.api.getSettings(),
    window.api.getLimits(),
    window.api.getVersion(),
  ]);

  limits = allLimits;
  appVersion = version;
  setCatalog(strings.catalog);

  // Los rangos primero: fijar el valor de un deslizador antes que su min/max
  // lo recorta al rango por defecto del navegador (0-100) y guardaria basura.
  for (const s of sliders) s.setLimits(limits);

  applyConfig(cfg);
  applyStrings(strings);
  selectTab('posture');

  renderCameras(await window.api.getCameras());
  paused = await window.api.isPaused();
  renderPause();

  if (!activeBaseline()) setStatus('status.neverCalibrated', null, 'warn');

  // Al reabrir la ventana, pintar el ultimo frame en vez de esperar 250 ms
  // con la interfaz vacia.
  const last = await window.api.lastFrame();
  if (last) {
    renderScore(last.score);
    renderMetrics(last.breakdown);
  }
})();
