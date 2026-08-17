'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getLimits: () => ipcRenderer.invoke('settings:limits'),
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  // Sin grupo restaura todo; con grupo ('sound', 'times'...), solo esa seccion.
  resetSettings: (group) => ipcRenderer.invoke('settings:reset', group),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),

  calibrate: () => ipcRenderer.invoke('calibrate'),
  cancelCalibration: () => ipcRenderer.invoke('calibrate:cancel'),
  undoCalibration: () => ipcRenderer.invoke('calibrate:undo'),
  canUndoCalibration: () => ipcRenderer.invoke('calibrate:can-undo'),

  // El preview solo corre mientras la capa de calibracion esta abierta.
  setPreview: (on) => ipcRenderer.send('preview:enable', on),
  onPreview: (cb) => ipcRenderer.on('preview:update', (_e, dataUrl) => cb(dataUrl)),

  getStrings: () => ipcRenderer.invoke('i18n:get'),

  getVersion: () => ipcRenderer.invoke('app:version'),
  // La red la toca el proceso principal, nunca esta ventana: su CSP sigue
  // siendo default-src 'none' y no hay que abrirle connect-src a nadie.
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  openReleases: (url) => ipcRenderer.invoke('updates:open', url),

  addProfile: (name) => ipcRenderer.invoke('profiles:add', name),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  activateProfile: (id) => ipcRenderer.invoke('profiles:activate', id),

  togglePause: () => ipcRenderer.invoke('pause:toggle'),
  isPaused: () => ipcRenderer.invoke('pause:get'),
  // La pausa tambien se conmuta desde la bandeja, con esta ventana abierta.
  onPause: (cb) => ipcRenderer.on('pause:update', (_e, paused) => cb(paused)),
  lastFrame: () => ipcRenderer.invoke('frame:last'),

  getCameras: () => ipcRenderer.invoke('cameras:get'),
  playSound: (kind) => ipcRenderer.send('sound:play', kind),

  onCameras: (cb) => ipcRenderer.on('cameras:update', (_e, list) => cb(list)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config:update', (_e, cfg) => cb(cfg)),
  onStrings: (cb) => ipcRenderer.on('i18n:update', (_e, payload) => cb(payload)),
  onStartCalibration: (cb) => ipcRenderer.on('ui:start-calibration', () => cb()),
});
