const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers.cjs');

test('touch layouts keep the dock visible when a mouse is also available', () => {
  const app = createApp({ hasHover: true });
  app.window.innerWidth = 390;
  app.fire('resize');
  app.flushTimers();
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), false);
  for (const id of ['toolrail', 'pagestrip']) assert.equal(app.elements.get(id).classList.contains('is-revealed'), true);
  app.window.innerWidth = 1440;
  app.fire('resize');
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), true);
});

test('large tablets use the touch layout even in landscape', () => {
  const app = createApp({ width: 1366, height: 1024, coarsePointer: true });
  assert.equal(app.run('mobileLayout()'), true);
  app.run('createDraftText(1300,1000);');
  assert.equal(app.elements.get('editorDone').hidden, false);
  assert.ok(parseFloat(app.elements.get('textEditor').style.left) <= 1298);
});

test('coalesced pen samples preserve curved handwriting between pointer frames', () => {
  const app = createApp();
  const board = app.elements.get('board');
  board.dispatch('pointerdown', { pointerId: 1, pointerType: 'pen', button: 0, clientX: 100, clientY: 200, timeStamp: 100 });
  board.dispatch('pointermove', { pointerId: 1, pointerType: 'pen', clientX: 140, clientY: 200, timeStamp: 130,
    getCoalescedEvents: () => [{ clientX: 120, clientY: 180, timeStamp: 115 }, { clientX: 140, clientY: 200, timeStamp: 130 }] });
  board.dispatch('pointerup', { pointerId: 1, pointerType: 'pen' });
  assert.deepEqual(app.json('page().objects[0].points.map(p=>[p.x,p.y])'), [[100,200],[120,180],[140,200]]);
});

test('touch selection has a wider hit target while mouse precision stays unchanged', () => {
  const app = createApp();
  app.run(`page().objects.push({id:'line',type:'line',x0:100,y0:200,x1:300,y1:200,width:2,color:'#23282F'});setTool('select');`);
  app.elements.get('board').dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 208 });
  assert.equal(app.run('state.selectedIds.has("line")'), true);
  assert.equal(app.run('getSelectionHandleAt(76,193,page().view,"touch").handle'), 'nw');
  assert.equal(app.run('getSelectionHandleAt(76,193,page().view,"mouse")'), null);
});

test('pinching with the touch paint bucket never paints before navigation starts', () => {
  const app = createApp();
  app.run('setTool("bucket"); window.fills=[]; fillAt=(x,y)=>window.fills.push({x,y});');
  const board = app.elements.get('board');
  const pointer = (type, id, x, y) => board.dispatch(type, { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  pointer('pointerdown', 1, 150, 250);
  assert.equal(app.run('window.fills.length'), 0);
  pointer('pointerdown', 2, 250, 350);
  pointer('pointerup', 2, 250, 350);
  pointer('pointerup', 1, 150, 250);
  assert.equal(app.run('window.fills.length'), 0);
  pointer('pointerdown', 1, 150, 250);
  pointer('pointerup', 1, 150, 250);
  assert.deepEqual(app.json('window.fills'), [{ x: 150, y: 250 }]);
  pointer('pointerdown', 1, 150, 250);
  pointer('pointermove', 1, 180, 270);
  pointer('pointerup', 1, 180, 270);
  assert.equal(app.run('window.fills.length'), 1);
});

test('mobile editing stays inside the visual viewport when the keyboard opens or pans', () => {
  const app = createApp();
  app.window.innerWidth = 390;
  app.window.innerHeight = 844;
  app.run('state.fontSize=12; createDraftText(380,800);');
  const editor = app.elements.get('textEditor');
  assert.equal(app.document.activeElement, editor);
  assert.ok(parseFloat(editor.style.fontSize) >= 16);
  app.window.visualViewport = { offsetLeft: 0, offsetTop: 40, width: 390, height: 300 };
  app.run('syncMobileViewport();');
  assert.ok(parseFloat(editor.style.left) >= 8);
  assert.ok(parseFloat(editor.style.left) + parseFloat(editor.style.width) <= 382);
  assert.ok(parseFloat(editor.style.top) >= 104);
  assert.ok(parseFloat(editor.style.top) + parseFloat(editor.style.height) <= 328);
  editor.value = 'A longer line stays readable near the edge of the phone';
  editor.dispatch('input');
  assert.ok(parseFloat(editor.style.width) >= 200);
  assert.ok(parseFloat(editor.style.left) + parseFloat(editor.style.width) <= 382);
  editor.value = 'Keyboard-safe draft';
  app.elements.get('editorDone').click();
  assert.equal(app.run('editing'), null);
  assert.equal(app.elements.get('editorDone').hidden, true);
  assert.equal(app.document.body.classList.contains('editing-text'), false);
  assert.equal(app.run('page().objects[0].lines[0]'), 'Keyboard-safe draft');
  assert.equal(app.run('saveNow()'), true);
});

test('fit view uses the free canvas between the mobile toolbar and docks', () => {
  const app = createApp();
  app.window.innerWidth = 390;
  app.window.innerHeight = 844;
  app.elements.get('topbar').getBoundingClientRect = () => ({ bottom: 124 });
  app.elements.get('pagestrip').getBoundingClientRect = () => ({ top: 700 });
  app.elements.get('toolrail').getBoundingClientRect = () => ({ top: 780 });
  app.run(`resizeCanvas();page().objects.push({id:'rect',type:'rect',x0:0,y0:0,x1:200,y1:500,width:4,color:'#23282F'});fitView();`);
  const bounds = app.json('boundsOf(page().objects[0])'), view = app.json('page().view');
  assert.ok(bounds.x * view.zoom + view.panX >= 16);
  assert.ok(bounds.y * view.zoom + view.panY >= 136);
  assert.ok((bounds.x + bounds.w) * view.zoom + view.panX <= 374);
  assert.ok((bounds.y + bounds.h) * view.zoom + view.panY <= 688);
});
