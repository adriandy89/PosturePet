'use strict';

const { app, BrowserWindow, ipcMain, session, screen, shell } = require('electron');
const path = require('node:path');

const settings = require('./settings.js');
const i18n = require('../shared/i18n.js');
const appProtocol = require('./protocol.js');
const { PosturePolicy, STATE } = require('./policy.js');
const { TrayController } = require('./tray.js');
const { DimOverlay } = require('./overlay.js');
const { Notifier } = require('./notifier.js');
const { SelfTest } = require('./selftest.js');
const updates = require('./updates.js');

/**
 * Orquestador. El reparto de responsabilidades:
 *
 *   renderer del personaje  ->  PERCEPCION  (camara -> landmarks -> score)
 *   este proceso            ->  POLITICA    (cuando avisar y con que)
 *
 * Por que la camara vive en la ventana del personaje y no en una oculta:
 * en Windows, `backgroundThrottling: false` frena igualmente los timers de una
 * ventana a la que se le ha llamado hide() (electron#31016). Una ventana de
 * camara oculta acabaria congelando el bucle de inferencia a los pocos minutos.
 * El personaje es always-on-top y siempre visible, asi que Chromium nunca lo
 * considera de fondo. Si desactivas el personaje NO se oculta: se reduce a 1x1
 * transparente, que sigue contando como visible.
 */

const MASCOT_SIZE = { width: 148, height: 168 };
const DEV = process.argv.includes('--dev');
const SELFTEST = process.argv.includes('--selftest');

/**
 * Los errores del renderer se quedan en las devtools, y la ventana del
 * personaje no siempre las tiene abiertas. En dev los reenviamos al terminal:
 * un fallo al cargar el WASM o al abrir la camara pasaria desapercibido.
 */
function pipeConsole(win, tag) {
  if (!DEV) return;
  // La firma de este evento cambio a mitad de la serie 3x de Electron: antes
  // eran argumentos sueltos, ahora un objeto. Aceptamos las dos.
  win.webContents.on('console-message', (event, level, message, line, source) => {
    const text = message ?? event?.message ?? '';
    const lvl = level ?? event?.level ?? '';
    const where = source ?? event?.sourceId;
    const at = where ? ` (${String(where).split('/').pop()}:${line ?? event?.lineNumber})` : '';
    console.log(`[${tag}:${lvl}] ${text}${at}`);
  });
  win.webContents.on('render-process-gone', (_e, details) =>
    console.error(`[${tag}] el proceso ha muerto:`, details.reason)
  );
}

let mascotWindow = null;
let settingsWindow = null;
let tray = null;
let overlay = null;
let notifier = null;
let policy = null;
let manuallyPaused = false;
let lastFrame = null;
let selfTest = null;
let cameras = [];

/**
 * La base anterior a la ultima recalibracion, para poder deshacerla.
 *
 * En memoria y no en disco a proposito: es una red de seguridad para el minuto
 * siguiente ("me he movido al calibrar, esta peor que antes"), no un historial.
 * Persistirla obligaria a decidir cuantas guardar y a ensuciar settings.json
 * con datos que nadie va a mirar dos sesiones despues.
 */
let previousBaseline = null;

/** Cancela la calibracion en curso, si la hay. La instala el handler. */
let cancelPendingCalibration = null;

// ---------------------------------------------------------------- ventanas

function createMascotWindow() {
  const cfg = settings.load();
  const bounds = mascotStartBounds(cfg.mascotPosition);

  mascotWindow = new BrowserWindow({
    ...bounds,
    ...MASCOT_SIZE,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'mascot.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Lo unico que impide que el bucle de la camara se frene al minimizar
      // el resto de ventanas.
      backgroundThrottling: false,
    },
  });

  mascotWindow.setAlwaysOnTop(true, 'floating');
  mascotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mascotWindow.loadURL(appProtocol.url('src/renderer/mascot.html'));

  mascotWindow.once('ready-to-show', () => {
    mascotWindow.showInactive(); // visible para Chromium, pero sin robar el foco
    applyMascotVisibility(cfg.alerts.mascot);
    pushConfigToRenderers();

    if (SELFTEST) {
      selfTest = new SelfTest({
        startCalibration: () => mascotWindow.webContents.send('mascot:calibrate'),
        quit: (code) => { process.exitCode = code; app.quit(); },
        // El diagnostico enciende el relay directamente: no hay ventana de
        // ajustes abierta, asi que setPreview() lo apagaria por no haber quien
        // mire, y justamente es lo que se quiere comprobar.
        setPreview: (on) => mascotWindow?.webContents.send('mascot:preview', on),
        calibrationMs: cfg.calibrationMs,
      });
      // Margen para que MediaPipe compile el WASM y la camara arranque.
      setTimeout(() => selfTest.start(), 3_000);
    }
  });

  // Guardamos la posicion al soltar, no en cada pixel del arrastre.
  mascotWindow.on('moved', () => {
    if (!mascotWindow || mascotWindow.isDestroyed()) return;
    const [x, y] = mascotWindow.getPosition();
    settings.save({ mascotPosition: { x, y } });
  });

  pipeConsole(mascotWindow, 'mascot');
}

/** Esquina inferior derecha por defecto, respetando la barra de tareas. */
function mascotStartBounds(saved) {
  const area = screen.getPrimaryDisplay().workArea;

  if (saved) {
    // Un monitor desconectado desde la ultima sesion dejaria al personaje
    // fuera de pantalla para siempre.
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x >= b.x - MASCOT_SIZE.width && saved.x < b.x + b.width &&
             saved.y >= b.y - MASCOT_SIZE.height && saved.y < b.y + b.height;
    });
    if (visible) return { x: saved.x, y: saved.y };
  }

  return {
    x: area.x + area.width - MASCOT_SIZE.width - 24,
    y: area.y + area.height - MASCOT_SIZE.height - 24,
  };
}

/**
 * Apagar el personaje no oculta la ventana: la encoge a 1x1 y la vuelve
 * inerte al raton. Chromium la sigue considerando visible -- que es justo lo
 * que mantiene vivo el bucle de la camara.
 */
function applyMascotVisibility(visible) {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;

  mascotWindow.setIgnoreMouseEvents(!visible);
  if (visible) {
    mascotWindow.setSize(MASCOT_SIZE.width, MASCOT_SIZE.height);
    const saved = settings.load().mascotPosition;
    const b = mascotStartBounds(saved);
    mascotWindow.setPosition(b.x, b.y);
  } else {
    mascotWindow.setSize(1, 1);
  }
  mascotWindow.webContents.send('mascot:visible', visible);
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 620,
    minHeight: 620,
    title: i18n.t('app.name'),
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.removeMenu();
  settingsWindow.loadURL(appProtocol.url('src/renderer/settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Cerrar la ventana con la capa abierta es cancelar: si no, la captura
    // seguiria y guardaria una base que el usuario nunca llego a aceptar.
    cancelPendingCalibration?.();
    setPreview(false);
  });

  // Los enlaces externos van al navegador, nunca dentro de la app.
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  pipeConsole(settingsWindow, 'settings');
}

// ------------------------------------------------------------ bucle central

/**
 * Un frame del renderer. Llega a 4 Hz.
 * `payload.score` es null cuando no se detecta a nadie.
 */
function onPostureFrame(payload) {
  lastFrame = payload;
  selfTest?.observe(payload);
  const cfg = settings.load();

  if (manuallyPaused) {
    tray?.update({ state: STATE.PAUSED, score: null, level: 0, manuallyPaused: true });
    return;
  }

  const decision = policy.update({ score: payload.score, now: Date.now() });
  const alerts = cfg.alerts;

  tray?.update({ ...decision, manuallyPaused: false });

  if (alerts.dim && decision.surfaces.dim) overlay.show();
  else overlay.hide();

  if (decision.surfaces.toast || decision.surfaces.sound) {
    notifier.nag(payload.breakdown);
  }

  mascotWindow?.webContents.send('mascot:state', {
    state: decision.state,
    level: decision.level,
    score: decision.score,
    alarmed: alerts.mascot && decision.surfaces.mascotAlarmed,
  });

  // El panel de depuracion solo consume datos si esta abierto.
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('telemetry', { ...payload, ...decision });
  }
}

/** Reparte la config a quien la necesite tras cualquier cambio. */
function pushConfigToRenderers() {
  const cfg = settings.load();

  policy?.reconfigure(settings.policyConfig());
  overlay?.setOpacity(cfg.dimOpacity);
  overlay?.setFades({ inMs: cfg.dimFadeInMs, outMs: cfg.dimFadeOutMs });
  notifier?.setEnabled({ toast: cfg.alerts.toast, sound: cfg.alerts.sound });
  tray?.setEnabled(cfg.alerts.tray);

  const forRenderer = {
    baseline: settings.activeBaseline(),
    sensitivity: cfg.sensitivity,
    glanceGraceMs: cfg.glanceGraceMs,
    smoothingMs: cfg.smoothingMs,
    cameraId: cfg.cameraId,
    alerts: cfg.alerts,
    calibrationMs: cfg.calibrationMs,
    detectionIntervalMs: cfg.detectionIntervalMs,
    staleAfterMs: cfg.staleAfterMs,
    previewIntervalMs: cfg.previewIntervalMs,
    sound: {
      volume: cfg.soundVolume,
      pitchHz: cfg.soundPitchHz,
      gapMs: cfg.soundGapMs,
      decayMs: cfg.soundDecayMs,
    },
  };
  mascotWindow?.webContents.send('config:update', forRenderer);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config:update', cfg);
  }
}

/**
 * Cambia el idioma en caliente. Nada se reinicia: el menu de la bandeja se
 * reconstruye, los textos ya emitidos (un toast en pantalla) se quedan como
 * estaban -- que es lo correcto -- y la ventana de ajustes recibe el catalogo
 * nuevo y se repinta sola.
 */
function applyLocale() {
  const cfg = settings.load();
  i18n.setLocale(i18n.resolve(cfg.locale, app.getLocale()));
  tray?.relocalize();
  broadcastStrings();
}

/** El paquete de idioma que consume la ventana de ajustes. */
function stringsPayload() {
  return {
    locale: i18n.locale(),
    catalog: i18n.catalogFor(),
    available: i18n.available(),
  };
}

function broadcastStrings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('i18n:update', stringsPayload());
  }
}

/**
 * Enciende o apaga el envio de fotogramas de la camara a la ventana de ajustes.
 *
 * Se apaga solo en cuanto deja de haber quien mire: cerrar la ventana de
 * ajustes con la capa de calibracion abierta dejaria a la ventana del personaje
 * codificando un JPEG cada 100 ms para nadie, y eso no se nota hasta que el
 * portatil empieza a soplar.
 */
function setPreview(on) {
  const wanted = on && settingsWindow && !settingsWindow.isDestroyed();
  mascotWindow?.webContents.send('mascot:preview', Boolean(wanted));
}

function setPaused(paused) {
  manuallyPaused = paused;
  if (paused) {
    overlay.hide();
    mascotWindow?.webContents.send('mascot:state', {
      state: STATE.PAUSED, level: 0, score: null, alarmed: false,
    });
  }
  tray?.refreshMenu();
  tray?.update({ state: STATE.PAUSED, score: null, level: 0, manuallyPaused: paused });
}

// -------------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.on('posture:frame', (_e, payload) => onPostureFrame(payload));
  ipcMain.on('calibration:done', (_e, result) => {
    // Sin este try, un fallo del diagnostico se tragaria dentro del manejador
    // de IPC y la app se quedaria colgada sin decir por que.
    try {
      selfTest?.onCalibration(result);
    } catch (err) {
      console.error('Fallo en el autodiagnostico:', err);
      app.exit(1);
    }
  });

  ipcMain.on('mascot:drag-end', () => {
    if (!mascotWindow || mascotWindow.isDestroyed()) return;
    const [x, y] = mascotWindow.getPosition();
    settings.save({ mascotPosition: { x, y } });
  });

  ipcMain.handle('settings:get', () => settings.load());
  ipcMain.handle('settings:limits', () => settings.LIMITS);
  ipcMain.handle('i18n:get', () => stringsPayload());

  // La version sale de aqui y no de leer package.json en el renderer: en el
  // .exe empaquetado ese archivo esta en otro sitio, y app.getVersion() es lo
  // unico que dice la verdad en los dos casos.
  ipcMain.handle('app:version', () => app.getVersion());

  // Unica conexion de red de toda la app, y solo si el usuario la pide.
  ipcMain.handle('updates:check', () => updates.check());
  ipcMain.handle('updates:open', (_e, url) => updates.openReleases(url));

  ipcMain.handle('settings:patch', (_e, patch) => {
    const before = settings.load();
    const next = settings.save(patch);

    if (next.alerts.mascot !== before.alerts.mascot) applyMascotVisibility(next.alerts.mascot);
    if (!next.alerts.dim) overlay.hide();
    // El idioma se compara contra lo guardado, no contra lo que trae el patch:
    // sanitize() puede haber rechazado un codigo que no existe.
    if (next.locale !== before.locale) applyLocale();
    pushConfigToRenderers();
    return next;
  });

  // Restaurar no toca perfiles, calibracion ni idioma (ver settings.js).
  // Sin grupo restaura todo; con grupo, solo esa seccion de la ventana.
  ipcMain.handle('settings:reset', (_e, group) => {
    const before = settings.load();
    const next = settings.resetTunables(group);

    // Solo si de verdad ha cambiado: applyMascotVisibility recoloca la
    // ventana, y restaurar la seccion de Sonido no tiene por que mover al
    // personaje de sitio.
    if (next.alerts.mascot !== before.alerts.mascot) applyMascotVisibility(next.alerts.mascot);
    if (!next.alerts.dim) overlay.hide();
    pushConfigToRenderers();
    tray?.refreshMenu();
    return next;
  });

  // Suena al margen del enfriamiento y del interruptor: lo usan el boton
  // "Probar sonido" y los tics de la cuenta atras de la calibracion.
  ipcMain.on('sound:play', (_e, kind) => notifier?.chime(kind));

  ipcMain.handle('settings:set-autostart', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--autostart'] });
    return settings.save({ autoStart: enabled });
  });

  // La calibracion la ejecuta el renderer (es quien tiene los landmarks); aqui
  // solo se lanza y se guarda el resultado.
  ipcMain.handle('calibrate', async () => {
    if (!mascotWindow || mascotWindow.isDestroyed()) {
      return { ok: false, errorKey: 'errors.windowNotReady' };
    }
    // El margen sobre la duracion de la calibracion cubre el arranque del
    // detector. Sin sumarla, alargar la calibracion en ajustes haria que el
    // tiempo se agotase antes de que llegase a terminar.
    const timeoutMs = settings.load().calibrationMs + 12_000;
    return new Promise((resolve) => {
      const settle = (result) => {
        clearTimeout(timer);
        ipcMain.removeListener('calibration:done', done);
        cancelPendingCalibration = null;
        resolve(result);
      };

      const done = (_e, result) => {
        if (result.ok) {
          // Se guarda la anterior ANTES de pisarla: despues ya no hay de donde
          // sacarla, y es justo cuando el usuario descubre que la nueva es peor.
          previousBaseline = settings.activeBaseline();
          settings.saveBaseline(result.baseline);
          pushConfigToRenderers();
          tray?.refreshMenu();
        }
        settle(result);
      };

      const timer = setTimeout(
        () => settle({ ok: false, errorKey: 'errors.calibrationTimeout' }),
        timeoutMs
      );

      // Cancelar tiene que llegar hasta el detector: cerrar la capa sin avisarle
      // dejaria la captura corriendo, y al terminar guardaria la base igual.
      cancelPendingCalibration = () => {
        mascotWindow?.webContents.send('mascot:calibrate-cancel');
        settle({ ok: false, cancelled: true });
      };

      ipcMain.on('calibration:done', done);
      mascotWindow.webContents.send('mascot:calibrate');
    });
  });

  ipcMain.handle('calibrate:cancel', () => {
    cancelPendingCalibration?.();
    return true;
  });

  // Deshacer solo tiene sentido mientras haya algo a lo que volver, y una sola
  // vez: la base "anterior" despues de deshacer seria la que se acaba de tirar.
  ipcMain.handle('calibrate:undo', () => {
    if (!previousBaseline) return { ok: false };
    settings.saveBaseline(previousBaseline);
    previousBaseline = null;
    pushConfigToRenderers();
    tray?.refreshMenu();
    return { ok: true, config: settings.load() };
  });

  ipcMain.handle('calibrate:can-undo', () => Boolean(previousBaseline));

  ipcMain.on('preview:enable', (_e, on) => setPreview(on));
  ipcMain.on('preview:frame', (_e, dataUrl) => {
    selfTest?.observePreview(dataUrl);
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('preview:update', dataUrl);
    } else if (!selfTest) {
      // Nadie mirando: se apaga en el origen en vez de seguir recibiendo.
      setPreview(false);
    }
  });

  ipcMain.handle('pause:toggle', () => {
    setPaused(!manuallyPaused);
    return manuallyPaused;
  });

  // Perfiles. Cambiar de perfil intercambia la base, asi que el renderer tiene
  // que enterarse y reiniciar su suavizado -- de eso se encarga pushConfig.
  const profileOp = (fn) => (...args) => {
    fn(...args);
    pushConfigToRenderers();
    tray?.refreshMenu();
    return settings.load();
  };

  ipcMain.handle('profiles:add', profileOp((_e, name) => settings.addProfile(name)));
  ipcMain.handle('profiles:rename', profileOp((_e, id, name) => settings.renameProfile(id, name)));
  ipcMain.handle('profiles:delete', profileOp((_e, id) => settings.deleteProfile(id)));
  ipcMain.handle('profiles:activate', profileOp((_e, id) => settings.setActiveProfile(id)));

  ipcMain.handle('pause:get', () => manuallyPaused);
  ipcMain.handle('frame:last', () => lastFrame);

  // La lista la publica el renderer del personaje (es quien tiene el permiso);
  // aqui solo se guarda para que ajustes pueda pedirla cuando se abra.
  ipcMain.on('cameras:list', (_e, list) => {
    cameras = Array.isArray(list) ? list : [];
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('cameras:update', cameras);
    }
  });
  ipcMain.handle('cameras:get', () => cameras);
}

// ------------------------------------------------------------------ arranque

// Sin esto los toasts nativos no aparecen en Windows: el SO necesita un
// identificador de app para asociarlos. Falla en silencio, que es lo peor.
app.setAppUserModelId('com.posturepet.app');

// Tiene que ocurrir antes de whenReady().
appProtocol.registerScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettingsWindow());

  app.whenReady().then(() => {
    appProtocol.handleScheme();

    // Lo PRIMERO, antes de la primera lectura completa de ajustes: merge()
    // bautiza el perfil por defecto con un nombre traducido, asi que en un
    // arranque limpio el idioma tiene que estar ya decidido. Se lee suelto del
    // disco porque el propio ajuste vive dentro del archivo.
    i18n.setLocale(i18n.resolve(settings.storedLocale(), app.getLocale()));

    // La camara se concede solo a nuestras propias paginas; cualquier otra
    // peticion se deniega.
    const isOurs = (wc) => appProtocol.isAppUrl(wc?.getURL());
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(permission === 'media' && isOurs(wc));
    });
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission) => permission === 'media' && isOurs(wc)
    );

    policy = new PosturePolicy(settings.policyConfig());
    overlay = new DimOverlay();
    overlay.create();
    overlay.setOpacity(settings.load().dimOpacity);
    overlay.setFades({
      inMs: settings.load().dimFadeInMs,
      outMs: settings.load().dimFadeOutMs,
    });

    notifier = new Notifier();

    createMascotWindow();
    notifier.attachMascot(mascotWindow);

    tray = new TrayController({
      isPaused: () => manuallyPaused,
      onTogglePause: () => setPaused(!manuallyPaused),
      getProfiles: () => {
        const s = settings.load();
        return { profiles: s.profiles, activeId: s.activeProfileId };
      },
      onSelectProfile: (id) => {
        settings.setActiveProfile(id);
        pushConfigToRenderers();
        tray.refreshMenu();
        // Un perfil sin calibrar no puede puntuar: llevamos al usuario a ello.
        if (!settings.activeBaseline()) openSettingsWindow();
      },
      onCalibrate: () => {
        openSettingsWindow();
        settingsWindow.webContents.once('did-finish-load', () =>
          settingsWindow.webContents.send('ui:start-calibration')
        );
      },
      onSettings: () => openSettingsWindow(),
      onQuit: () => app.quit(),
    });

    registerIpc();
    pushConfigToRenderers();

    // Sin calibrar no hay nada que comparar, asi que la primera vez se abre
    // directamente en ajustes. En modo diagnostico no: es una comprobacion
    // headless, y abrir ahi la ventana metia una segunda calibracion a la vez.
    const primeraVez = !settings.activeBaseline();
    if (primeraVez && !SELFTEST && !process.argv.includes('--autostart')) {
      openSettingsWindow();
    }
  });
}

// Es una app de bandeja: cerrar la ventana de ajustes no cierra el programa.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  overlay?.destroy();
  tray?.destroy();
});
