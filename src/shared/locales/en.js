'use strict';

/**
 * English catalogue.
 *
 * Mirrors the shape of locales/es.js exactly -- test/i18n.test.js fails the
 * build if a key is missing, extra, or if a {placeholder} does not match.
 * Anything absent silently falls back to Spanish, which would leave the UI
 * half-translated, so the test is what keeps this file honest.
 *
 * Copy this file to add a language, then register it in ../i18n.js.
 */

module.exports = {
  meta: { name: 'English', htmlLang: 'en' },

  app: { name: 'PosturePet' },

  units: {
    seconds: '{v}s',
    minutes: '{v} min',
    milliseconds: '{v} ms',
    hertz: '{v} Hz',
    percent: '{v}%',
    multiplier: '{v}x',
    points: '{v}/100',
    off: 'off',
  },

  // --------------------------------------------------------------- tray icon
  tray: {
    pause: 'Pause monitoring',
    resume: 'Resume monitoring',
    profile: 'Profile',
    uncalibrated: '{name} (not calibrated)',
    calibrate: 'Calibrate this profile...',
    settings: 'Settings',
    quit: 'Quit',
    tipPaused: 'PosturePet - paused',
    tipAway: 'PosturePet - nobody there',
    tipScore: 'PosturePet - posture {score}/100',
  },

  // ----------------------------------------------------------- notifications
  notify: {
    title: 'PosturePet',
    generic: ['Check your posture.', 'Time for a stretch.'],
    metric: {
      neckLength: [
        'Neck compressed: drop your shoulders and lift your chin.',
        'Your neck is shortening. Open your chest and pull your shoulders back.',
        'Your head is sinking between your shoulders.',
      ],
      proximity: [
        "You've drifted towards the screen. Lean back a little.",
        'Your head has crept in towards the monitor.',
      ],
      // Two-way metric: the advice depends on the sign, and getting it
      // backwards would be worse than saying nothing.
      shoulderHeight: {
        up: [
          "You've slid down the chair. Get your hips back against the backrest.",
          "You're sliding downwards.",
        ],
        down: [
          "Your shoulders are hunched up. Let them drop.",
          'Relax your shoulders, they are riding high.',
        ],
      },
      shoulderTilt: [
        "You're leaning to one side. Share your weight between both hips.",
        'One shoulder is higher than the other.',
      ],
      headRoll: ['Your head is tilted.', 'Straighten your head up.'],
      driftX: ['You have drifted sideways. Come back to the centre.', 'Line yourself up with the screen.'],
    },
  },

  // ----------------------------------------------------------------- metrics
  metrics: {
    neckLength: 'Neck compression',
    proximity: 'Screen distance',
    shoulderHeight: 'Shoulder height',
    shoulderTilt: 'Shoulder tilt',
    headRoll: 'Head roll',
    driftX: 'Sideways drift',
  },

  // ---------------------------------------------------------------- profiles
  profiles: {
    defaultName: 'Desk',
    autoName: 'Profile {n}',
    calibrated: 'calibrated',
    uncalibrated: 'not calibrated',
  },

  // ------------------------------------------------------------ header status
  status: {
    starting: 'Starting the camera...',
    paused: 'Paused.',
    pausedLong: 'Paused. Posture is not being monitored.',
    cameraError: 'Camera: {error}',
    calibrating: 'Calibrating, hold still...',
    calibratingHold: 'Sit the way you want to sit and hold still for {s} seconds.',
    calibrated: "Done. That's your reference posture now.",
    needsCalibration: 'Not calibrated. Press "Calibrate posture".',
    neverCalibrated: 'Not calibrated yet. Sit up properly and press "Calibrate posture".',
    profileCreated: 'Profile created. Sit the way you want to sit and press "Calibrate posture".',
    notVisible: "I can't see you. Auto-pause is on.",
    turned: 'Face turned away: cannot measure reliably.',
    bad: 'Poor posture for {s}s.',
    good: 'Good posture.',
    cameraChanged: 'Camera changed. Recalibrate this profile so the baseline still means something.',
    settingsReset: 'Settings restored. Your calibration and profiles are untouched.',
    glanceForgiven: "You're looking down ({s}s). “{metric}” doesn't count while that lasts.",
    glanceExpired: "You've had your head down for {s}s: the grace period is over and it counts again.",
    stale:
      'Your torso appears at a different scale than when you calibrated: you may have ' +
      'moved desk, changed chair or nudged the camera. Recalibrate this profile, or ' +
      'create a new one for this setup.',
  },

  // ------------------------------------------------------------------ errors
  errors: {
    windowNotReady: 'The capture window is not ready.',
    calibrationTimeout: 'Timed out. Check that the camera can see you.',
    calibrationNoSubject:
      "I can't see you well enough. Face the camera, shoulders visible, with good light.",
  },

  // ------------------------------------------------------------------ camera
  camera: {
    auto: 'Automatic (system default)',
    numbered: 'Camera {n}',
  },

  // ---------------------------------------------------------- settings window
  settings: {
    title: 'PosturePet',
    calibrate: 'Calibrate posture',
    recalibrate: 'Recalibrate posture',
    calibrating: 'Calibrating...',
    pause: 'Pause',
    resume: 'Resume',

    tabs: {
      posture: 'Posture',
      alerts: 'Alerts',
      sensitivity: 'Sensitivity',
      times: 'Timings',
      camera: 'Camera',
      system: 'System',
    },

    resetSection: 'Restore this section',
    resetDone: 'Restored',

    calibration: {
      title: 'Calibrate your posture',
      intro: "Sit the way you want to sit for the rest of the day. Upright but comfortable, not an exam posture you won't keep.",
      waiting: 'The countdown starts once everything is green.',
      steady: "All set. Stay as you are.",
      hold: 'Hold still...',
      cancel: 'Cancel',
      retry: 'Try again',
      close: 'Close',
      undo: 'Undo, go back to the previous one',
      undone: 'Your previous calibration is back.',
      lost: 'Interrupted: {check}',
      checks: {
        seen: 'I can see you',
        shouldersInFrame: 'Shoulders inside the frame',
        facingCamera: 'Facing the camera',
        distanceOk: 'Right distance',
      },
      hints: {
        seen: "I can't detect you. Sit in front of the camera with decent light.",
        shouldersInFrame: 'Lean back or lower the camera until both shoulders are visible.',
        facingCamera: 'Turn towards the camera: side-on cannot be measured.',
        distanceOk: 'You are too far from, or too close to, the camera.',
      },
      ok: "Done. That's your reference posture now.",
      okDetail: 'Baseline fixed from {n} samples.',
      moved: 'You moved around a fair bit while measuring, so the baseline came out blurry. If the score jitters later, recalibrate holding stiller.',
    },

    about: {
      open: 'About PosturePet',
      title: 'PosturePet',
      what: 'A posture monitor for Windows. One webcam, one vision model, and a nudge when you have been slouching for a while.',
      privacy: 'Everything is processed on your machine. No cloud, no accounts, no telemetry.',
      privacyDetail: 'The camera image is never stored or transmitted: it goes straight to the detector. The only things that reach the disk are numbers — your calibration and your settings.',
      network: 'The app makes no network connection of its own. This button is the one exception:',
      networkDetail: 'It asks GitHub for the public list of releases. It sends none of your settings, metrics or identifiers — but GitHub will see your IP address, as on any web visit.',
      check: 'Check for updates',
      checking: 'Checking...',
      close: 'Close',
      version: 'Version {v}',
      license: 'Free software under the MIT licence.',
      repo: 'View the project on GitHub',
      result: {
        update: 'A new version is out: {v}.',
        current: "You're up to date. There's nothing newer.",
        offline: 'Could not connect. Check your internet connection.',
        timeout: 'GitHub took too long to answer. Try again later.',
        rateLimited: 'GitHub has rate-limited your connection. Wait a while, or check the releases by hand.',
        notFound: 'No release has been published yet.',
        failed: "Could not read GitHub's answer.",
      },
      download: 'Go to the download',
      seeReleases: 'See the releases',
    },

    language: {
      title: 'Language',
      label: 'Application language',
      auto: 'Match the system',
      hint:
        'The change applies immediately, no restart needed. Your profiles keep the ' +
        'names you gave them.',
    },

    profiles: {
      title: 'Calibration profile',
      hint:
        "Your correct posture isn't a single thing: it depends on the camera, the chair " +
        'and the desk height. Each setup carries its own calibration and switches with ' +
        'one click, from here or from the tray icon. It works just as well when several ' +
        'people share the machine.',
      namePlaceholder: 'Laptop, Standing desk...',
      save: 'Save',
      cancel: 'Cancel',
      add: 'Add profile',
      rename: 'Rename',
      delete: 'Delete',
      confirmDelete: 'Confirm deleting “{name}”',
    },

    live: {
      title: 'Live posture',
      hint:
        'Make each movement on its own and check that only the matching bar rises. ' +
        'This is where sensitivity really gets tuned.',
    },

    alerts: {
      title: 'Alerts',
      hint:
        'They escalate from least to most intrusive: the icon reacts instantly, the ' +
        'character within seconds, and dimming, toast and sound only if you stay slouched.',
      tray: 'Tray icon',
      trayHint: 'Changes colour next to the clock. Costs nothing.',
      mascot: 'On-screen character',
      mascotHint: 'It slouches when you slouch. Drag it wherever you like.',
      dim: 'Dim the screen',
      dimHint: 'A black veil fades in on top. Clicks pass straight through it.',
      toast: 'Notification',
      toastHint: 'A Windows toast telling you what to fix.',
      sound: 'Sound',
      soundHint: 'Two gentle notes. Useful when running full screen.',
      opacity: 'Dimming strength',
      fadeIn: 'Time to dim',
      fadeInHint: 'Slow on purpose: a veil that snaps on startles you and ends up switched off.',
      fadeOut: 'Time to clear',
      fadeOutHint: 'Short on purpose: the reward for sitting up must be immediate.',
    },

    sound: {
      title: 'Sound',
      hint:
        "The tone is synthesised on the fly rather than loaded from a file: two falling " +
        'notes with a soft decay. This is where you shape how it sounds and how long it lasts.',
      volume: 'Volume',
      pitch: 'Pitch of the first note',
      pitchHint: 'The second falls a fourth below it, which is what makes it read as a gentle nudge.',
      gap: 'Gap between notes',
      decay: 'Length of each note',
      decayHint: 'The tail it fades out on. Long sounds soft; short sounds clipped.',
      test: 'Test sound',
    },

    sensitivity: {
      title: 'Sensitivity',
      general: 'Overall sensitivity',
      generalHint: 'Higher = triggers on smaller deviations.',
      smoothing: 'Score stability',
      smoothingHint:
        'How much it averages before reacting. Higher = steadier but slower to respond; ' +
        'useful if the score jitters while you sit still.',
      enterBad: 'Posture counts as poor below',
      exitBad: 'And stops counting as poor above',
      hysteresisHint:
        'The gap between the two is hysteresis: without it, sitting right on the ' +
        'threshold would make the state flicker endlessly. The second is always kept ' +
        'above the first.',
    },

    times: {
      title: 'Timings',
      hint:
        'Each alert waits its turn. If something feels naggy, raising a timing almost ' +
        'always fixes it better than lowering sensitivity.',
      glance: 'Forgive looking down for',
      glanceHint:
        'Looking at the keyboard lowers your head just like slouching does, but the two ' +
        'differ in facial foreshortening. It does not count during this window. After ' +
        'it, it does: minutes with your neck bent tires you out just the same. 0 turns ' +
        'it off.',
      dwell: 'Stay slouched before alerting',
      dwellHint: 'Stops a sip of coffee or turning to talk from setting off an alert.',
      cooldown: 'Minimum between alerts',
      cooldownHint: 'Only affects toast and sound; dimming follows the state.',
      mascotDelay: 'Character reacts after',
      away: 'Auto-pause when unseen for',
      calibration: 'Calibration length',
      calibrationHint:
        'How many seconds get averaged when fixing the baseline. Longer rides out a ' +
        'stray wobble, but is harder to hold still through.',
      countdown: 'Countdown before measuring',
      countdownHint:
        'The 3-2-1 that gives you time to settle. At 0 it starts measuring as soon as ' +
        'the camera has a clear view of you.',
    },

    camera: {
      title: 'Camera',
      device: 'Camera to use',
      hint:
        'If you have more than one (a laptop camera and an external one), pick it here. ' +
        'Recalibrate after changing it: a different angle is a different setup.',
      interval: 'Analysis rate',
      intervalHint:
        'How often a frame is examined. Slouching takes seconds, so lowering this does ' +
        'not improve detection: it only burns CPU. Raising it makes the app cheaper.',
      stale: 'Warn about stale calibration after',
      staleHint:
        'How long your torso has to appear at a different scale before recalibration is ' +
        'suggested. Short fires when you turn to talk; long is slow to notice that you ' +
        'have moved.',
      preview: 'Video smoothness while calibrating',
      previewHint:
        'How often the calibration screen refreshes its image. It only costs anything ' +
        'while that screen is open.',
    },

    system: {
      title: 'System',
      autostart: 'Start with Windows',
      autostartHint: 'Starts in the tray, without opening this window.',
      reset: 'Restore defaults',
      resetArmed: 'Confirm restore',
      resetHint:
        'Puts sensitivity, timings, alerts and sound back to factory values. Does NOT ' +
        'touch your profiles or your calibration.',
      privacy:
        'Everything is processed on this machine. Neither the image nor the metrics ' +
        'leave it. The app makes no network connection of its own: the only one is ' +
        '"Check for updates", and only if you press it yourself.',
    },
  },

  // --------------------------------------------------------------- self-test
  selftest: {
    header: '=== PosturePet self-test ===',
    phase1: 'Step 1: watching the camera for {s}s...',
    frames: '  frames received: {seen}, with a person detected: {withPerson}',
    phase2: 'Step 2: calibrating ({s}s)...',
    baseline: '  baseline fixed from {n} samples',
    baselineDetail: '    eye separation {eye} (scale unit)  neck {neck}  shoulders/face {span}',
    phase3: 'Step 3: measuring for {s}s. Move around to see the metrics react.',
    result: '--- Result ---',
    preview: 'Calibration video: {n} frames received ({kb} KB each)',
    previewNone: 'WARNING: no frame ever reached the calibration screen.',
    failCamera: 'FAILED: {error}',
    failCameraHelp1: 'Check: Privacy & security > Camera > Let desktop apps access',
    failCameraHelp2: 'your camera. And that no other app is holding it.',
    failNobody: 'FAILED: the camera gives an image, but nobody is detected.',
    failNobodyHelp: 'Face the camera, with both shoulders in frame and enough light.',
    failNoScore: 'FAILED: not a single frame got scored.',
    ok: 'OK: full chain running at ~{fps} fps',
    scores: '  score  min {min}  mean {avg}  max {max}  ({n} frames)',
    deviations: '  Latest deviations per metric:',
    flatWarning1: '  Note: the score barely moved. If you did not move, that is expected;',
    flatWarning2: '  if you did, check that the camera sees you head-on.',
    saved: 'Report saved to: {path}',
    saveFailed: 'Could not save the report:',
  },
};
