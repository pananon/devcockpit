// The only bridge between the UI and the system. Each method maps to one
// validated IPC channel; the renderer gets no direct Node or Electron access.
import { contextBridge, ipcRenderer } from 'electron';
import type { CockpitApi } from '@shared/types';

function listen(channel: string, cb: (...args: any[]) => void): () => void {
  const fn = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: CockpitApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setProjectRoots: (roots) => ipcRenderer.invoke('settings:setRoots', roots),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  listRepos: () => ipcRenderer.invoke('repos:list'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getTranscript: (id) => ipcRenderer.invoke('sessions:transcript', id),
  searchSessions: (q) => ipcRenderer.invoke('sessions:search', q),
  listPrs: () => ipcRenderer.invoke('prs:list'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  termCreate: (spec) => ipcRenderer.invoke('term:create', spec),
  termWrite: (id, data) => ipcRenderer.send('term:write', id, data),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  termKill: (id) => ipcRenderer.send('term:kill', id),
  onTermData: (cb) => listen('term:data', cb),
  onTermExit: (cb) => listen('term:exit', cb),
  setLocalModel: (tag) => ipcRenderer.invoke('settings:setLocalModel', tag),
  scanModels: () => ipcRenderer.invoke('ai:scan'),
  ollamaStatus: () => ipcRenderer.invoke('ai:status'),
  pullModel: (tag) => ipcRenderer.invoke('ai:pull', tag),
  cancelPull: (tag) => ipcRenderer.send('ai:cancelPull', tag),
  removeModel: (tag) => ipcRenderer.invoke('ai:remove', tag),
  onPullProgress: (cb) => listen('ai:pull-progress', cb),
  runAi: (task) => ipcRenderer.invoke('ai:run', task),
  cancelAi: (id) => ipcRenderer.send('ai:cancel', id),
  onAiEvent: (cb) => listen('ai:event', cb),
  setVoiceSettings: (v) => ipcRenderer.invoke('settings:setVoice', v),
  voiceRecording: (recording, fromHotkey) => ipcRenderer.send('voice:recording', recording, fromHotkey),
  voiceTranscribe: (audio) => ipcRenderer.invoke('voice:transcribe', audio),
  onVoiceCommand: (cb) => listen('voice:command', cb),
  onVoiceState: (cb) => listen('voice:state', cb),
};

contextBridge.exposeInMainWorld('cockpit', api);
