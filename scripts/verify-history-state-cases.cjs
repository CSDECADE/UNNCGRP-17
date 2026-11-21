const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, run, wait, input, delay, testDir }) => {
  await run(`(() => {
    const el = document.querySelector('main'), key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    window.__historyStateEditor = () => {
      let fiber = el[key]; while (fiber.return) fiber = fiber.return;
      const find = node => {
        for (; node; node = node.sibling) {
          if (node.memoizedProps?.value?.readProject) return node.memoizedProps.value;
          const value = node.child && find(node.child); if (value) return value;
        }
      };
      const editor = find(fiber.stateNode.current);
      if (!editor) throw Error('Current editor context missing');
      return editor;
    };
  })()`);
  const current = () => run('window.__historyStateEditor().readProject()');
  const nativeHistory = async redo => {
    await run('document.activeElement?.blur(); document.querySelector("canvas").focus()');
    const modifiers = redo ? ['control', 'shift'] : ['control'];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers });
  };
  const obj = fs.readFileSync(path.join(__dirname, '../tests/fixtures/obj-building.obj'), 'utf8');
  await run(`(() => {
    const i = document.querySelector('input[accept=".obj"]'), data = new DataTransfer();
    data.items.add(new File([${JSON.stringify(obj)}], 'history-state.obj'));
    i.files = data.files; i.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(`window.__historyStateEditor().readProject().models.some(m => m.name === 'history-state.obj')`);
  await run(`(async () => {
    const e = window.__historyStateEditor(); e.enterEditMode();
    const p = e.readProject(), m = p.models.find(m => m.name === 'history-state.obj'), r = p.objResources.find(r => r.id === m.resourceId);
    const {withSelectionElements} = await import('/src/core/mesh-edit.ts');
    const elements = r.vertices.slice(0, 3).map(v => ({modelId:m.id,meshId:r.meshes[0].id,vertexId:v.id}));
    e.selectMeshElement(withSelectionElements(elements[0], elements));
  })()`);
  await wait(`!!document.querySelector('[aria-label="平移增量 X"]')`);
  const base = await current();
  await run(`(() => { const e = window.__historyStateEditor();
    if (!e.beginMeshTransform() || !e.updateTransform({elementDelta:[.001,0,0]}) || !e.finishTransform()) throw Error('Setup transaction failed');
  })()`);
  const tip = await current(); assert.notDeepEqual(tip.objResources, base.objResources);
  await input('平移增量 X', .125);
  await nativeHistory(false);
  await wait(`document.querySelector('[aria-label="平移增量 X"]').value === '0'`);
  assert.deepEqual(await current(), base);
  await input('平移增量 Y', .25);
  await nativeHistory(true);
  await wait(`document.querySelector('[aria-label="平移增量 Y"]').value === '0'`);
  assert.deepEqual(await current(), tip);
  // A reset must clear the pending ref as well as the visible values.
  await run(`[...document.querySelectorAll('.group-translation button')].find(b => b.textContent === '应用平移').click()`);
  assert.deepEqual(await current(), tip);
  await wait(`!!document.querySelector('.save-dot.saved')`);
  const stored = await run(`localStorage.getItem('p15.project.v1')`);
  await run(`window.__historyStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) {
    if (k === 'p15.project.v1') throw new DOMException('Test quota', 'QuotaExceededError');
    return window.__historyStorageSet.call(this,k,v);
  }; void 0`);
  try {
    await nativeHistory(false);
    await wait(`!!document.querySelector('.save-dot.saving')`);
    await wait(`!!document.querySelector('.save-dot.error')`);
    assert.deepEqual(await current(), base);
    assert.equal(await run(`localStorage.getItem('p15.project.v1')`), stored);
  } finally { await run(`Storage.prototype.setItem = window.__historyStorageSet; delete window.__historyStorageSet`); }
  await nativeHistory(true);
  await wait(`!!document.querySelector('.save-dot.saving')`);
  await wait(`!!document.querySelector('.save-dot.saved')`);
  assert.deepEqual(await current(), tip);
  assert.deepEqual(await run(`JSON.parse(localStorage.getItem('p15.project.v1'))`), JSON.parse(JSON.stringify(tip)));
  fs.writeFileSync(path.join(testDir, 'history-state.json'), JSON.stringify({passed:true,checks:[
    'native-Undo-Redo-clears-nonzero-group-delta', 'reset-clears-pending-application',
    'dirty-status-with-history-change', 'quota-failure-preserves-old-autosave-and-live-history',
    'Redo-retries-autosave-and-recovers-status', 'exact-project-recovery'
  ]}, null, 2));
  fs.writeFileSync(path.join(testDir, 'history-state.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({historyStateReport:path.join(testDir, 'history-state.json')}));
  return ['native-history-pending-delta-reset', 'autosave-dirty-error-retry', 'exact-project-recovery'];
};
