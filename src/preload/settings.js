'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  patchSettings: (patch) => ipcRenderer.invoke('settings:patch', patch),
  setAutostart: (enabled) => ipcRenderer.invoke('settings:set-autostart', enabled),
  calibrate: () => ipcRenderer.invoke('calibrate'),

  addProfile: (name) => ipcRenderer.invoke('profiles:add', name),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  activateProfile: (id) => ipcRenderer.invoke('profiles:activate', id),

  togglePause: () => ipcRenderer.invoke('pause:toggle'),
  isPaused: () => ipcRenderer.invoke('pause:get'),
  lastFrame: () => ipcRenderer.invoke('frame:last'),

  getCameras: () => ipcRenderer.invoke('cameras:get'),

  onCameras: (cb) => ipcRenderer.on('cameras:update', (_e, list) => cb(list)),
  onTelemetry: (cb) => ipcRenderer.on('telemetry', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config:update', (_e, cfg) => cb(cfg)),
  onStartCalibration: (cb) => ipcRenderer.on('ui:start-calibration', () => cb()),
});
