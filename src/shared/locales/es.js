'use strict';

/**
 * Catalogo en espanol. Es tambien el idioma de reserva: cualquier clave que
 * falte en otro catalogo se sirve desde aqui, asi que este archivo tiene que
 * estar siempre completo. El test test/i18n.test.js lo comprueba.
 *
 * Es el unico rincon del codigo con texto acentuado. El resto de src/ es ASCII
 * puro a proposito, pero aqui el texto ES el producto: escribir "Anadir" o
 * "Espanol" en la interfaz de una app multiidioma seria justo el defecto que
 * este archivo viene a corregir. El .editorconfig ya declara charset = utf-8.
 *
 * Los marcadores van entre llaves: 'Postura mala desde hace {s} s.'
 *
 * Las listas son variantes del mismo aviso. El notificador rota entre ellas
 * para que el mensaje no se vuelva invisible de tanto repetirse.
 */

module.exports = {
  // El nombre del idioma va SIEMPRE en ese idioma, nunca traducido: quien
  // abre la app en un idioma que no entiende necesita reconocer el suyo.
  meta: { name: 'Español', htmlLang: 'es' },

  app: { name: 'PosturePet' },

  units: {
    seconds: '{v} s',
    minutes: '{v} min',
    milliseconds: '{v} ms',
    hertz: '{v} Hz',
    percent: '{v}%',
    multiplier: '{v}x',
    points: '{v}/100',
    off: 'desactivado',
  },

  // ------------------------------------------------------------------ bandeja
  tray: {
    pause: 'Pausar vigilancia',
    resume: 'Reanudar vigilancia',
    profile: 'Perfil',
    uncalibrated: '{name} (sin calibrar)',
    calibrate: 'Calibrar este perfil...',
    settings: 'Ajustes',
    quit: 'Salir',
    tipPaused: 'PosturePet - en pausa',
    tipAway: 'PosturePet - nadie delante',
    tipScore: 'PosturePet - postura {score}/100',
  },

  // ------------------------------------------------------------- notificacion
  notify: {
    title: 'PosturePet',
    generic: ['Revisa tu postura.', 'Estírate un momento.'],
    metric: {
      neckLength: [
        'Cuello encogido: baja los hombros y sube la barbilla.',
        'Se te está acortando el cuello. Abre el pecho y lleva los hombros atrás.',
        'La cabeza se te hunde entre los hombros.',
      ],
      proximity: [
        'Te has acercado a la pantalla. Échate un poco atrás.',
        'La cabeza se te ha ido hacia el monitor.',
      ],
      // Metrica de dos sentidos: el consejo depende del signo, y darlo al
      // reves seria peor que no decir nada.
      shoulderHeight: {
        up: [
          'Te has escurrido en la silla. Sube el culo al respaldo.',
          'Vas resbalando hacia abajo.',
        ],
        down: [
          'Llevas los hombros encogidos. Suéltalos.',
          'Relaja los hombros, los tienes subidos.',
        ],
      },
      shoulderTilt: [
        'Estás ladeado. Reparte el peso entre las dos caderas.',
        'Un hombro más alto que el otro.',
      ],
      headRoll: ['Tienes la cabeza torcida.', 'Endereza la cabeza.'],
      driftX: ['Te has desplazado de lado. Vuelve al centro.', 'Recolócate frente a la pantalla.'],
    },
  },

  // ---------------------------------------------------------------- metricas
  // Los nombres que se ven en el panel de depuracion y en el autodiagnostico.
  metrics: {
    neckLength: 'Cuello acortado',
    proximity: 'Acercamiento',
    shoulderHeight: 'Altura de hombros',
    shoulderTilt: 'Inclinación de hombros',
    headRoll: 'Ladeo de cabeza',
    driftX: 'Deriva lateral',
  },

  // ---------------------------------------------------------------- perfiles
  profiles: {
    defaultName: 'Escritorio',
    autoName: 'Perfil {n}',
    calibrated: 'calibrado',
    uncalibrated: 'sin calibrar',
  },

  // --------------------------------------------------- estado de la cabecera
  status: {
    starting: 'Iniciando la cámara...',
    paused: 'En pausa.',
    pausedLong: 'En pausa. No se vigila la postura.',
    cameraError: 'Cámara: {error}',
    calibrating: 'Calibrando, quédate quieto...',
    calibratingHold: 'Siéntate como quieres estar y no te muevas durante {s} segundos.',
    calibrated: 'Listo. Esa es ahora tu postura de referencia.',
    needsCalibration: 'Sin calibrar. Pulsa «Calibrar postura».',
    neverCalibrated: 'Sin calibrar todavía. Siéntate bien y pulsa «Calibrar postura».',
    profileCreated: 'Perfil creado. Siéntate como quieras estar y pulsa «Calibrar postura».',
    notVisible: 'No te veo. Auto-pausa activa.',
    turned: 'Cara girada: no se puede medir con fiabilidad.',
    bad: 'Postura mala desde hace {s} s.',
    good: 'Buena postura.',
    cameraChanged: 'Cámara cambiada. Recalibra este perfil para que la base valga.',
    settingsReset: 'Ajustes restaurados. Tu calibración y tus perfiles siguen intactos.',
    glanceForgiven: 'Estás mirando hacia abajo ({s} s). «{metric}» no cuenta mientras dure.',
    glanceExpired: 'Llevas {s} s con la cabeza baja: se acabó la gracia y vuelve a contar.',
    stale:
      'Tu torso se ve a otra escala que cuando calibraste: puede que hayas cambiado de ' +
      'sitio, de silla o movido la cámara. Recalibra este perfil, o crea uno nuevo para ' +
      'este montaje.',
  },

  // ------------------------------------------------------------------ errores
  errors: {
    windowNotReady: 'La ventana de captura no está lista.',
    calibrationTimeout: 'Se agotó el tiempo. Revisa que la cámara te vea.',
    calibrationNoSubject:
      'No se te ve bien. Colócate de frente, con los hombros visibles y buena luz.',
  },

  // -------------------------------------------------------------------- camara
  camera: {
    auto: 'Automática (la del sistema)',
    numbered: 'Cámara {n}',
  },

  // ------------------------------------------------------- ventana de ajustes
  settings: {
    title: 'PosturePet',
    calibrate: 'Calibrar postura',
    recalibrate: 'Recalibrar postura',
    calibrating: 'Calibrando...',
    pause: 'Pausar',
    resume: 'Reanudar',

    tabs: {
      posture: 'Postura',
      alerts: 'Avisos',
      sensitivity: 'Sensibilidad',
      times: 'Tiempos',
      camera: 'Cámara',
      system: 'Sistema',
    },

    resetSection: 'Restaurar esta sección',
    resetDone: 'Restaurado',

    // La capa que aparece al calibrar: preview, comprobaciones y cuenta atrás.
    calibration: {
      title: 'Calibrar tu postura',
      intro: 'Siéntate como quieres estar el resto del día. Erguido pero cómodo, no en una postura de examen que no vas a mantener.',
      waiting: 'La cuenta atrás empieza cuando todo esté en verde.',
      steady: 'Todo listo. Quédate como estás.',
      hold: 'Quédate quieto...',
      cancel: 'Cancelar',
      retry: 'Reintentar',
      close: 'Cerrar',
      undo: 'Deshacer, volver a la anterior',
      undone: 'Restaurada tu calibración anterior.',
      lost: 'Se ha interrumpido: {check}',
      checks: {
        seen: 'Te veo',
        shouldersInFrame: 'Hombros dentro del encuadre',
        facingCamera: 'Cara de frente',
        distanceOk: 'Distancia correcta',
      },
      hints: {
        seen: 'No te detecto. Ponte delante de la cámara con buena luz.',
        shouldersInFrame: 'Échate atrás o baja la cámara hasta que se te vean los dos hombros.',
        facingCamera: 'Gírate hacia la cámara: de lado no se puede medir.',
        distanceOk: 'Estás demasiado lejos o demasiado cerca de la cámara.',
      },
      ok: 'Listo. Esa es ahora tu postura de referencia.',
      okDetail: 'Base fijada con {n} muestras.',
      moved: 'Te has movido bastante mientras se medía, así que la base ha salido borrosa. Si luego el score te baila, recalibra quedándote más quieto.',
    },

    about: {
      open: 'Acerca de PosturePet',
      title: 'PosturePet',
      what: 'Monitor de postura para Windows. Una webcam, un modelo de visión y un aviso cuando llevas rato encorvado.',
      // Lo que destaca en negrita: es la razón de ser del proyecto.
      privacy: 'Todo el procesamiento ocurre en tu equipo. Sin nube, sin cuentas, sin telemetría.',
      privacyDetail: 'La imagen de la cámara no se guarda ni se transmite: va directa al detector. Lo único que queda en disco son números — tu calibración y tus ajustes.',
      network: 'La app no hace ninguna conexión de red por su cuenta. La única excepción es este botón:',
      networkDetail: 'Pide la lista pública de versiones a GitHub. No envía tus ajustes, ni tus métricas, ni ningún identificador — pero GitHub verá tu dirección IP, como en cualquier visita web.',
      check: 'Buscar actualización',
      checking: 'Buscando...',
      close: 'Cerrar',
      version: 'Versión {v}',
      license: 'Software libre bajo licencia MIT.',
      repo: 'Ver el proyecto en GitHub',
      result: {
        update: 'Hay una versión nueva: {v}.',
        current: 'Estás al día. No hay ninguna versión más reciente.',
        offline: 'No se pudo conectar. Comprueba tu conexión a internet.',
        timeout: 'GitHub ha tardado demasiado en responder. Inténtalo más tarde.',
        rateLimited: 'GitHub ha limitado las peticiones desde tu conexión. Espera un rato o mira las versiones a mano.',
        notFound: 'Todavía no hay ninguna versión publicada.',
        failed: 'No se pudo leer la respuesta de GitHub.',
      },
      download: 'Ir a la descarga',
      seeReleases: 'Ver las versiones',
    },

    language: {
      title: 'Idioma',
      label: 'Idioma de la aplicación',
      auto: 'El del sistema',
      hint:
        'El cambio se aplica al momento, sin reiniciar. Tus perfiles conservan el ' +
        'nombre con el que los creaste.',
    },

    profiles: {
      title: 'Perfil de calibración',
      hint:
        'Tu postura correcta no es una sola: depende de la cámara, la silla y la altura ' +
        'de la mesa. Cada montaje lleva su propia calibración y se cambia con un clic, ' +
        'también desde el icono de la bandeja. Sirve igual si varias personas comparten ' +
        'el equipo.',
      namePlaceholder: 'Portátil, Mesa alta...',
      save: 'Guardar',
      cancel: 'Cancelar',
      add: 'Añadir perfil',
      rename: 'Renombrar',
      delete: 'Eliminar',
      confirmDelete: 'Confirmar borrado de «{name}»',
    },

    live: {
      title: 'Postura en vivo',
      hint:
        'Provoca cada gesto por separado y comprueba que solo sube la barra que le ' +
        'corresponde. Aquí es donde se ajusta la sensibilidad de verdad.',
    },

    alerts: {
      title: 'Avisos',
      hint:
        'Se encadenan de menos a más molesto: el icono reacciona al instante, el ' +
        'personaje a los pocos segundos y oscurecer, toast y sonido solo si sigues mal.',
      tray: 'Icono de bandeja',
      trayHint: 'Cambia de color junto al reloj. Coste cero.',
      mascot: 'Personaje en pantalla',
      mascotHint: 'Se encorva cuando te encorvas. Arrástralo donde quieras.',
      dim: 'Oscurecer la pantalla',
      dimHint: 'Un velo negro se funde encima. Los clics lo atraviesan.',
      toast: 'Notificación',
      toastHint: 'Aviso de Windows indicando qué corregir.',
      sound: 'Sonido',
      soundHint: 'Dos notas suaves. Útil a pantalla completa.',
      opacity: 'Intensidad del oscurecido',
      fadeIn: 'Tarda en oscurecerse',
      fadeInHint:
        'Lento a propósito: un velo que aparece de golpe sobresalta y acaba desactivado.',
      fadeOut: 'Tarda en aclararse',
      fadeOutHint: 'Corto a propósito: la recompensa por enderezarte debe ser inmediata.',
    },

    sound: {
      title: 'Sonido',
      hint:
        'El tono se sintetiza al vuelo, no es un archivo: son dos notas descendentes ' +
        'con caída suave. Aquí se ajusta cómo suena y cuánto dura.',
      volume: 'Volumen',
      pitch: 'Tono de la primera nota',
      pitchHint:
        'La segunda cae una cuarta por debajo, que es lo que le da el aire de aviso amable.',
      gap: 'Separación entre notas',
      decay: 'Duración de cada nota',
      decayHint: 'La cola con la que se apaga. Larga suena suave; corta, seca.',
      test: 'Probar sonido',
    },

    sensitivity: {
      title: 'Sensibilidad',
      general: 'Sensibilidad general',
      generalHint: 'Más alta = salta con desviaciones menores.',
      smoothing: 'Estabilidad del score',
      smoothingHint:
        'Cuánto promedia antes de hacer caso. Más alto = más estable y más lento en ' +
        'reaccionar; útil si el score te baila estando quieto.',
      enterBad: 'Se considera mala postura por debajo de',
      exitBad: 'Y deja de serlo por encima de',
      hysteresisHint:
        'La separación entre los dos es histéresis: sin ella, quedarte justo en el ' +
        'umbral haría parpadear el estado sin parar. El segundo se mantiene siempre ' +
        'por encima del primero.',
    },

    times: {
      title: 'Tiempos',
      hint:
        'Cada aviso espera lo suyo. Si algo te resulta pesado, casi siempre se ' +
        'arregla subiendo un tiempo en vez de bajando la sensibilidad.',
      glance: 'Perdonar mirar hacia abajo',
      glanceHint:
        'Mirar el teclado baja la cabeza igual que encorvarse, pero se distingue por ' +
        'el escorzo de la cara. Durante este tiempo no cuenta. Pasado, sí: estar con ' +
        'el cuello doblado varios minutos cansa igual. En 0 se desactiva.',
      dwell: 'Aguantar mal antes de avisar',
      dwellHint: 'Evita que beber café o girarte a hablar dispare un aviso.',
      cooldown: 'Mínimo entre avisos',
      cooldownHint: 'Solo afecta a notificación y sonido; oscurecer acompaña al estado.',
      mascotDelay: 'El personaje reacciona a los',
      away: 'Auto-pausa si no te ve',
      calibration: 'Duración de la calibración',
      calibrationHint:
        'Cuántos segundos se promedian al fijar la base. Más largo aguanta mejor un ' +
        'temblor puntual, pero cuesta más quedarse quieto.',
      countdown: 'Cuenta atrás antes de medir',
      countdownHint:
        'El 3-2-1 que te da tiempo a colocarte. En 0 empieza a medir en cuanto la ' +
        'cámara te ve bien.',
    },

    camera: {
      title: 'Cámara',
      device: 'Cámara a usar',
      hint:
        'Si tienes más de una (la del portátil y una externa), aquí se elige. Al ' +
        'cambiarla conviene recalibrar: otro ángulo es otro montaje.',
      interval: 'Frecuencia de análisis',
      intervalHint:
        'Cada cuánto se mira un fotograma. Encorvarse tarda segundos, así que bajarlo ' +
        'no mejora la detección: solo gasta CPU. Subirlo la abarata.',
      stale: 'Avisar de calibración obsoleta tras',
      staleHint:
        'Cuánto tiene que verse el torso a otra escala antes de sugerir recalibrar. ' +
        'Corto se dispara al girarte a hablar; largo tarda en avisar de que has ' +
        'cambiado de sitio.',
      preview: 'Fluidez del vídeo al calibrar',
      previewHint:
        'Cada cuánto se refresca la imagen de la pantalla de calibración. Solo ' +
        'consume mientras esa pantalla está abierta.',
    },

    system: {
      title: 'Sistema',
      autostart: 'Arrancar con Windows',
      autostartHint: 'Se inicia en la bandeja, sin abrir esta ventana.',
      reset: 'Restaurar valores por defecto',
      resetArmed: 'Confirmar restauración',
      resetHint:
        'Devuelve sensibilidad, tiempos, avisos y sonido a como venían de fábrica. ' +
        'NO toca tus perfiles ni tu calibración.',
      privacy:
        'Todo el procesamiento ocurre en este equipo. Ni la imagen ni las métricas ' +
        'salen de aquí. La app no hace ninguna conexión de red por su cuenta: la ' +
        'única es «Buscar actualización», y solo si la pulsas tú.',
    },
  },

  // ------------------------------------------------------------ autodiagnostico
  selftest: {
    header: '=== Autodiagnóstico de PosturePet ===',
    phase1: 'Fase 1: observando la cámara {s} s...',
    frames: '  frames recibidos: {seen}, con persona detectada: {withPerson}',
    phase2: 'Fase 2: calibrando ({s} s)...',
    baseline: '  base fijada con {n} muestras',
    baselineDetail:
      '    separación de ojos {eye} (unidad de escala)  cuello {neck}  hombros/cara {span}',
    phase3: 'Fase 3: midiendo {s} s. Muévete para ver reaccionar las métricas.',
    result: '--- Resultado ---',
    preview: 'Vídeo de calibración: {n} fotogramas recibidos ({kb} KB cada uno)',
    previewNone: 'AVISO: no ha llegado ningún fotograma a la pantalla de calibración.',
    failCamera: 'FALLO: {error}',
    failCameraHelp1: 'Revisa: Privacidad y seguridad > Cámara > Permitir el acceso a',
    failCameraHelp2: 'aplicaciones de escritorio. Y que no la tenga ocupada otra app.',
    failNobody: 'FALLO: la cámara da imagen, pero no se detecta a nadie.',
    failNobodyHelp:
      'Colócate de frente, con los dos hombros dentro del encuadre y luz suficiente.',
    failNoScore: 'FALLO: no se ha llegado a puntuar ningún frame.',
    ok: 'OK: cadena completa funcionando a ~{fps} fps',
    scores: '  score  min {min}  medio {avg}  max {max}  ({n} frames)',
    deviations: '  Últimas desviaciones por métrica:',
    flatWarning1: '  Aviso: el score apenas ha variado. Si no te has movido es normal;',
    flatWarning2: '  si te has movido, revisa que la cámara te vea de frente.',
    saved: 'Informe guardado en: {path}',
    saveFailed: 'No se pudo guardar el informe:',
  },
};
