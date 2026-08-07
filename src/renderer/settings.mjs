import { METRICS } from './posture.mjs';

/**
 * Ventana de ajustes. Dos trabajos:
 *   - los interruptores y deslizadores de la configuracion
 *   - el panel de depuracion en vivo, que es la herramienta con la que se
 *     comprueba que cada gesto dispara la metrica que le toca
 */

const $ = (id) => document.getElementById(id);
const RING_LENGTH = 264; // 2*pi*42, el radio del circulo del SVG

let config = null;
let paused = false;

// --------------------------------------------------- panel de depuracion

const rows = new Map();

for (const [key, cfg] of Object.entries(METRICS)) {
  const row = document.createElement('div');
  row.className = 'metric';
  row.innerHTML =
    `<div class="metric-name">${cfg.label}</div>` +
    '<div class="metric-bar"><div class="metric-fill"></div></div>' +
    '<div class="metric-value">--</div>';
  $('metrics').append(row);
  rows.set(key, {
    el: row,
    fill: row.querySelector('.metric-fill'),
    value: row.querySelector('.metric-value'),
  });
}

const toneFor = (badness) =>
  badness > 0.66 ? 'var(--bad)' : badness > 0.33 ? 'var(--warn)' : 'var(--good)';

function renderMetrics(breakdown) {
  for (const [key, row] of rows) {
    const m = breakdown?.[key];
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

/** Explica en una linea que esta pasando con la mirada. */
function renderGlance(glance) {
  const note = $('glance-note');
  if (!glance?.glancing) {
    note.hidden = true;
    return;
  }
  const s = Math.round(glance.heldMs / 1000);
  note.hidden = false;
  note.className = glance.forgiven ? 'note ok' : 'note warn';
  // Se nombra la metrica con su etiqueta real para que se vea cual de las
  // barras de arriba es la que esta tachada.
  note.textContent = glance.forgiven
    ? `Estas mirando hacia abajo (${s} s). "${METRICS.neckLength.label}" no cuenta mientras dure.`
    : `Llevas ${s} s con la cabeza baja: se acabo la gracia y vuelve a contar.`;
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

function setStatus(text, tone = '') {
  const el = $('status');
  el.textContent = text;
  el.className = tone;
}

window.api.onTelemetry((t) => {
  renderScore(t.score);
  renderMetrics(t.breakdown);
  renderGlance(t.glance);
  renderStale(t.stale);

  if (paused) return setStatus('En pausa.');
  if (t.cameraError) return setStatus(`Camara: ${t.cameraError}`, 'bad');
  if (t.calibrating) return setStatus('Calibrando, quedate quieto...');
  if (t.needsCalibration) return setStatus('Sin calibrar. Pulsa "Calibrar postura".', 'warn');
  if (t.score === null) return setStatus('No te veo. Auto-pausa activa.');
  if (t.turned) return setStatus('Cara girada: no se puede medir con fiabilidad.');

  if (t.state === 'bad') {
    const segundos = Math.round(t.badForMs / 1000);
    setStatus(`Postura mala desde hace ${segundos} s.`, 'bad');
  } else {
    setStatus('Buena postura.', 'good');
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
    state.textContent = p.baseline ? 'calibrado' : 'sin calibrar';
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
  $('profile-form').hidden = false;
  $('profile-actions').hidden = true;
  const input = $('profile-name');
  input.value = initial;
  input.focus();
  input.select();
}

function closeNameForm() {
  pendingMode = null;
  $('profile-form').hidden = true;
  $('profile-actions').hidden = false;
  resetDeleteButton();
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('profile-name').value;
  const mode = pendingMode;
  closeNameForm();

  if (mode === 'add') {
    applyConfig(await window.api.addProfile(name));
    setStatus('Perfil creado. Sientate como quieras estar y pulsa "Calibrar postura".', 'warn');
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
  btn.textContent = 'Eliminar';
  btn.classList.remove('danger');
}

$('delete-profile').addEventListener('click', async () => {
  const btn = $('delete-profile');
  if (!deleteArmed) {
    deleteArmed = true;
    btn.textContent = `Confirmar borrado de "${activeProfileName()}"`;
    btn.classList.add('danger');
    return;
  }
  resetDeleteButton();
  applyConfig(await window.api.deleteProfile(config.activeProfileId));
});

/** Aviso de que la base ya no encaja con lo que ve la camara. */
function renderStale(stale) {
  const note = $('stale-note');
  note.hidden = !stale;
  if (stale) {
    note.textContent =
      'Tu torso se ve a otra escala que cuando calibraste: puede que hayas cambiado de ' +
      'sitio, de silla o movido la camara. Recalibra este perfil, o crea uno nuevo para ' +
      'este montaje.';
  }
}

// ------------------------------------------------------------ calibracion

$('calibrate').addEventListener('click', async () => {
  const btn = $('calibrate');
  btn.disabled = true;
  btn.textContent = 'Calibrando...';
  setStatus('Sientate como quieres estar y no te muevas durante 3 segundos.');

  const result = await window.api.calibrate();

  btn.disabled = false;
  btn.textContent = 'Recalibrar postura';
  setStatus(
    result.ok ? 'Listo. Esa es ahora tu postura de referencia.' : result.error,
    result.ok ? 'good' : 'bad'
  );
});

window.api.onStartCalibration(() => $('calibrate').click());

// ------------------------------------------------------------------ pausa

$('pause').addEventListener('click', async () => {
  paused = await window.api.togglePause();
  renderPause();
});

function renderPause() {
  $('pause').textContent = paused ? 'Reanudar' : 'Pausar';
  if (paused) setStatus('En pausa. No se vigila la postura.');
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

// ---------------------------------------------------------------- camara

function renderCameras(list) {
  const select = $('camera');
  select.replaceChildren();

  const auto = new Option('Automatica (la del sistema)', '');
  select.append(auto);
  for (const c of list) select.append(new Option(c.label, c.id));

  select.value = config?.cameraId ?? '';
  // Con una sola camara el desplegable no aporta nada.
  select.disabled = list.length <= 1;
}

$('camera').addEventListener('change', (e) => {
  patch({ cameraId: e.target.value || null });
  setStatus('Camara cambiada. Recalibra este perfil para que la base valga.', 'warn');
});

window.api.onCameras(renderCameras);

/**
 * Conecta un deslizador con una clave de config.
 * `toValue`/`toDisplay` traducen entre las unidades del control (segundos,
 * porcentajes) y las almacenadas (milisegundos, fracciones).
 */
function bindSlider(id, key, { toValue = (v) => v, fromValue = (v) => v, format }) {
  const input = $(id);
  const out = $(`${id}-out`);

  const show = () => { out.textContent = format(Number(input.value)); };

  input.addEventListener('input', show); // respuesta inmediata al arrastrar
  input.addEventListener('change', () => patch({ [key]: toValue(Number(input.value)) }));

  return (cfg) => {
    input.value = String(fromValue(cfg[key]));
    show();
  };
}

/** Los deslizadores de tiempo se manejan en segundos y se guardan en ms. */
const seconds = (format) => ({
  toValue: (v) => v * 1000,
  fromValue: (v) => v / 1000,
  format,
});

const showSeconds = (v) => `${v} s`;
const showMinutes = (v) => (v >= 60 ? `${(v / 60).toFixed(v % 60 ? 1 : 0)} min` : `${v} s`);

const sliders = [
  bindSlider('sensitivity', 'sensitivity', { format: (v) => `${v.toFixed(1)}x` }),
  bindSlider('dimOpacity', 'dimOpacity', { format: (v) => `${Math.round(v * 100)}%` }),
  bindSlider('smoothing', 'smoothingMs', {
    format: (v) => `${(v / 1000).toFixed(1)} s`,
  }),
  bindSlider('glance', 'glanceGraceMs', {
    ...seconds((v) => (v === 0 ? 'desactivado' : showMinutes(v))),
  }),
  bindSlider('dwell', 'dwellMs', seconds(showSeconds)),
  bindSlider('cooldown', 'nagCooldownMs', seconds(showMinutes)),
  bindSlider('mascotDelay', 'mascotDelayMs', seconds(showSeconds)),
  bindSlider('away', 'awayAfterMs', seconds(showSeconds)),
];

function applyConfig(cfg) {
  config = cfg;
  for (const box of document.querySelectorAll('[data-alert]')) {
    box.checked = Boolean(cfg.alerts[box.dataset.alert]);
  }
  $('autostart').checked = Boolean(cfg.autoStart);
  for (const sync of sliders) sync(cfg);
  renderProfiles(cfg);
}

const activeProfileOf = () =>
  config?.profiles.find((p) => p.id === config.activeProfileId) ?? null;

const activeBaseline = () => activeProfileOf()?.baseline ?? null;
const activeProfileName = () => activeProfileOf()?.name ?? '';

window.api.onConfig(applyConfig);

// ----------------------------------------------------------------- arranque

(async () => {
  applyConfig(await window.api.getSettings());
  renderCameras(await window.api.getCameras());
  paused = await window.api.isPaused();
  renderPause();

  if (!activeBaseline()) {
    setStatus('Sin calibrar todavia. Sientate bien y pulsa "Calibrar postura".', 'warn');
  }

  // Al reabrir la ventana, pintar el ultimo frame en vez de esperar 250 ms
  // con la interfaz vacia.
  const last = await window.api.lastFrame();
  if (last) {
    renderScore(last.score);
    renderMetrics(last.breakdown);
  }
})();
