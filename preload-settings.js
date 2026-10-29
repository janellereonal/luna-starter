// bridge for the settings window
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('S', {
  get: inv('settings:get'), set: inv('settings:set'), secret: inv('settings:secret'), models: inv('settings:models'), test: inv('settings:test'),
  memRead: inv('memory:read'), memWrite: inv('memory:write'), memDelete: inv('memory:delete'), memImport: inv('memory:import'), memForget: inv('memory:forget'),
  routineAdd: inv('routine:add'), routineRemove: inv('routine:remove'), routineRun: inv('routine:run'), jobStop: inv('job:stop'), watchStop: inv('watch:stop'), checkin: inv('checkin:now'),
  activity: inv('activity:get'),
  charPick: inv('char:pick'), charScan: inv('char:scan'), charRig: inv('char:rig'), charSave: inv('char:save'), charUse: inv('char:use'), charDelete: inv('char:delete'), charExport: inv('char:export'), charRename: inv('char:rename'),
  open: inv('open:pane'), action: inv('app:action'),
  onGo: (fn) => ipcRenderer.on('settings:go', (_e, s) => fn(s)),
  onJobs: (fn) => ipcRenderer.on('jobs', (_e, j) => fn(j)),
  onTheme: (fn) => ipcRenderer.on('theme', (_e, t) => fn(t)),
  setupStatus: inv('setup:status'), setupRefresh: inv('setup:refresh'), setupSignin: inv('setup:signin'), setupCopy: inv('setup:copyFromClaude'), setupPaste: inv('setup:pasteMemory'), setupBridge: inv('setup:bridge'), setupExport: inv('setup:export'), setupLearn: inv('setup:learn'),
  onSetup: (fn) => ipcRenderer.on('setup', (_e, s) => fn(s)),
  waState: inv('wa:state'), doctor: inv('doctor:run'), waLink: inv('wa:link'), waUnlink: inv('wa:unlink'),
  onWa: (fn) => ipcRenderer.on('wa', (_e, w) => fn(w))
});
