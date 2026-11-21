// Run serially against running dev and production-preview servers.
// Every case starts a fresh Electron profile. Failed assertions remain failures.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const dev = process.argv[2] || 'http://127.0.0.1:5180/';
const production = process.argv[3] || 'http://127.0.0.1:5181/';
const output = process.argv[4] || fs.mkdtempSync(path.join(os.tmpdir(), 'aero-undo-reliability-'));
fs.mkdirSync(output, { recursive: true });
const cases = [];
const add = (name, file, url, mode, environment = {}) => cases.push({name, file, url, mode, environment});
for (let repeat = 1; repeat <= 3; repeat++) add(`continuous50-${repeat}`, 'verify-obj-transform-ui.cjs', dev, 'release', {OBJ_RELEASE_SCENARIO:'stress'});
for (const interval of [35, 120]) add(`continuous${interval}`, 'verify-obj-transform-ui.cjs', dev, 'release', {OBJ_RELEASE_SCENARIO:'stress', OBJ_RELEASE_KEY_INTERVAL:String(interval)});
add('batched50', 'verify-obj-transform-ui.cjs', dev, 'release', {OBJ_RELEASE_SCENARIO:'stress', OBJ_RELEASE_KEY_BATCH:'20'});
add('production-continuous50', 'verify-obj-production-stress.cjs', production);
add('history-state', 'verify-obj-transform-ui.cjs', dev, 'history');
for (const mode of ['multi', 'elements', 'edit', 'default', 'builtin', 'export']) add(mode, 'verify-obj-transform-ui.cjs', dev, mode === 'default' ? undefined : mode);
add('import-playback-analysis', 'verify-obj-ui.cjs', dev);
add('pointer-latency', 'verify-obj-transform-ui.cjs', dev, 'audit');
add('renderer-memory', 'verify-obj-transform-ui.cjs', dev, 'memory');
(async () => {
  const report = {dev, production, serial:true, freshProfilePerCase:true, results:[]};
  for (const c of cases) {
    const environment = {...process.env};
    for (const key of ['ELECTRON_RUN_AS_NODE', 'OBJ_RELEASE_SCENARIO', 'OBJ_RELEASE_KEY_INTERVAL', 'OBJ_RELEASE_KEY_BATCH', 'OBJ_UNDO_TRACE', 'OBJ_UNDO_SKIP', 'OBJ_HISTORY_AXIS', 'OBJ_HISTORY_HEAP']) delete environment[key];
    Object.assign(environment, c.environment);
    const log = path.join(output, c.name + '.log'), fd = fs.openSync(log, 'w');
    const start = Date.now();
    const result = await new Promise(resolve => {
      const child = spawn(require('electron'), [path.join(__dirname, c.file), c.url, ...(c.mode ? [c.mode] : [])], {cwd:root, env:environment, stdio:['ignore',fd,fd]});
      child.once('error', error => resolve({exitCode:null, error:String(error)}));
      child.once('exit', (exitCode, signal) => resolve({exitCode, signal}));
    });
    fs.closeSync(fd);
    report.results.push({name:c.name, ...result, elapsedMs:Date.now()-start, log});
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report,null,2));
    console.log(c.name, result.exitCode);
  }
  process.exitCode = report.results.every(r => r.exitCode === 0) ? 0 : 1;
  console.log('Verification report:', path.join(output, 'results.json'));
})();
