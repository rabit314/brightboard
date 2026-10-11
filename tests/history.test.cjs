const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers.cjs');

const addRectangle = `page().objects.push({id:'rect',type:'rect',x0:0,y0:0,x1:100,y1:80,width:4,color:'#23282F'});state.selectedIds=new Set(['rect']);`;

test('deleting an earlier inactive page preserves the active page', () => {
  const app = createApp();
  app.run('pages.push(newPage(),newPage());activatePage(1);globalThis.activeId=page().id;deleteOrClearPage(0);');
  assert.equal(app.run('page().id'), app.run('activeId'));
  assert.equal(app.run('state.pageIndex'), 0);
  assert.ok(app.timers.size > 0);
});

test('adding and switching pages synchronizes zoom and history controls', () => {
  const app = createApp();
  app.run('page().view.zoom=2;updateZoomLabel();pushUndo();addPage();');
  assert.equal(app.run('page().view.zoom'), 1);
  assert.equal(app.elements.get('zoomLabel').textContent, '100%');
  assert.equal(app.elements.get('undoBtn').disabled, true);
  assert.equal(app.elements.get('redoBtn').disabled, true);
  app.run('switchPage(0);');
  assert.equal(app.elements.get('zoomLabel').textContent, '200%');
  assert.equal(app.elements.get('undoBtn').disabled, false);
});

test('background changes are restored together with page objects', () => {
  const app = createApp();
  app.run('pushUndo();page().bg="dots";undo();');
  assert.equal(app.run('page().bg'), 'grid');
  app.run('redo();');
  assert.equal(app.run('page().bg'), 'dots');
});

test('page deletion can be undone and redone without losing contents', () => {
  const app = createApp();
  app.run(`${addRectangle}globalThis.deletedId=page().id;pages.push(newPage());activatePage(1);deleteOrClearPage(0);undo();`);
  assert.equal(app.run('pages.length'), 2);
  assert.equal(app.run('page().id'), app.run('deletedId'));
  assert.equal(app.run('page().objects[0].id'), 'rect');
  assert.equal(app.elements.get('redoBtn').disabled, false);
  app.run('redo();');
  assert.equal(app.run('pages.length'), 1);
  app.run('undo();');
  assert.equal(app.run('page().objects[0].id'), 'rect');
});

test('object edits after a deletion are undone before restoring that page', () => {
  const app = createApp();
  app.run('pages.push(newPage());deleteOrClearPage(0);pushUndo();page().objects.push({id:"new",type:"text",x:0,y:0,fontSize:28,lines:["hello"]});undo();');
  assert.equal(app.run('pages.length'), 1);
  assert.equal(app.run('page().objects.length'), 0);
  app.run('undo();');
  assert.equal(app.run('pages.length'), 2);
});

test('multiple page deletions replay in undo order and preserve the prior active page', () => {
  const app = createApp();
  app.run('pages.push(newPage(),newPage());globalThis.pageIds=pages.map(p=>p.id);activatePage(2);deleteOrClearPage(0);deleteOrClearPage(0);undo();undo();');
  assert.deepEqual(app.json('pages.map(p=>p.id)'), app.json('pageIds'));
  app.run('redo();');
  assert.deepEqual(app.json('pages.map(p=>p.id)'), app.json('pageIds.slice(1)'));
  assert.equal(app.run('page().id'), app.run('pageIds[2]'));
  app.run('redo();');
  assert.deepEqual(app.json('pages.map(p=>p.id)'), app.json('pageIds.slice(2)'));
  app.run('undo();undo();');
  assert.deepEqual(app.json('pages.map(p=>p.id)'), app.json('pageIds'));
});

test('redoing deletion of an inactive restored page preserves subsequent page navigation', () => {
  const app = createApp();
  app.run('pages.push(newPage(),newPage());deleteOrClearPage(0);undo();switchPage(2);globalThis.activeId=page().id;redo();');
  assert.equal(app.run('page().id'), app.run('activeId'));
  assert.equal(app.run('pages.length'), 2);
});

test('object redo on a restored page runs before its pending deletion redo', () => {
  const app = createApp();
  app.run(`${addRectangle}pushUndo();page().objects[0].x0=3;pages.push(newPage());deleteOrClearPage(0);undo();undo();redo();`);
  assert.equal(app.run('page().objects[0].x0'), 3);
  assert.equal(app.run('deletedPagesRedoHistory.length'), 1);
  assert.equal(app.run('pages.length'), 2);
  app.run('redo();');
  assert.equal(app.run('pages.length'), 1);
});

test('image assets survive page deletion undo, redo, and garbage collection', () => {
  const app = createApp();
  app.run('registerImageSource("picture","data:image/png;base64,aGVsbG8=");page().objects.push({id:"image",type:"image",imgId:"picture",x:0,y:0,w:100,h:100});pages.push(newPage());activatePage(1);deleteOrClearPage(0);pruneUnusedImages();undo();redo();pruneUnusedImages();undo();');
  assert.equal(app.run('IMG.has("picture")'), true);
  assert.equal(app.run('page().objects[0].imgId'), 'picture');
  assert.equal(app.images[0].src, 'data:image/png;base64,aGVsbG8=');
});

test('deleted-page histories are bounded and reset with notebook history', () => {
  const app = createApp();
  app.run('for(let i=0;i<HIST_MAX+5;i++)pages.push(newPage());while(pages.length>1)deleteOrClearPage(0);');
  assert.equal(app.run('deletedPagesHistory.length'), 30);
  app.run('undo();pushUndo();resetPageHistory();');
  assert.deepEqual(app.json('({deleted:deletedPagesHistory.length,redoDeleted:deletedPagesRedoHistory.length,undo:page().undo.length,redo:page().redo.length})'), {deleted:0,redoDeleted:0,undo:0,redo:0});
});

test('a new mutation invalidates page-deletion redo', () => {
  const app = createApp();
  app.run('pages.push(newPage());deleteOrClearPage(0);undo();pushUndo();');
  assert.equal(app.run('deletedPagesRedoHistory.length'), 0);
  assert.equal(app.elements.get('redoBtn').disabled, true);
});

test('rapid nudges of the same selection form one undo step', () => {
  const app = createApp();
  app.run(`${addRectangle}nudge(3,0);`);
  app.setNow(1200);
  app.run('nudge(3,0);');
  assert.equal(app.run('page().undo.length'), 1);
  app.run('undo();');
  assert.equal(app.run('page().objects[0].x0'), 0);
});

test('a nudge after Undo starts a new step and clears obsolete Redo', () => {
  const app = createApp();
  app.run(`${addRectangle}nudge(3,0);undo();state.selectedIds=new Set(['rect']);`);
  app.setNow(1200);
  app.run('nudge(3,0);');
  assert.equal(app.run('page().undo.length'), 1);
  assert.equal(app.run('page().redo.length'), 0);
  app.run('undo();');
  assert.equal(app.run('page().objects[0].x0'), 0);
});

test('nudge grouping does not cross selections or intervening mutations', () => {
  const app = createApp();
  app.run(`${addRectangle}page().objects.push({...page().objects[0],id:'other'});nudge(3,0);state.selectedIds=new Set(['other']);`);
  app.setNow(1100);
  app.run('nudge(3,0);');
  assert.equal(app.run('page().undo.length'), 2);
  app.run('pushUndo();page().objects[1].color="#D93A3A";');
  app.setNow(1200);
  app.run('nudge(3,0);');
  assert.equal(app.run('page().undo.length'), 4);
});

test('nudges at the coordinate limit keep the notebook restorable without empty history steps', () => {
  const app = createApp();
  app.run(`${addRectangle}page().objects[0].x0=1e9-100;page().objects[0].x1=1e9;nudge(3,0);`);
  assert.equal(app.run('page().objects[0].x1'), 1e9);
  assert.equal(app.run('page().undo.length'), 0);
  app.run('nudge(-3,0);');
  assert.equal(app.run('page().objects[0].x1'), 1e9-3);
  assert.equal(app.run('page().undo.length'), 1);
  app.run('restoreBoard(serializeBoard());');
  assert.equal(app.run('page().objects[0].x1'), 1e9-3);
});

test('pushUndo snapshots the specified destination page', () => {
  const app = createApp();
  app.run('pages.push(newPage());pages[1].bg="blank";pages[1].objects.push({id:"other",type:"text",x:0,y:0,fontSize:28,lines:["other page"]});pushUndo(pages[1]);');
  assert.equal(app.run('pages[0].undo.length'), 0);
  assert.deepEqual(app.json('pages[1].undo[0].objects.map(o=>o.id)'), ['other']);
  assert.equal(app.run('pages[1].undo[0].bg'), 'blank');
});

test('async thumbnail scheduling marks only the destination page', () => {
  const app = createApp();
  app.run('pages.push(newPage());pages.forEach(p=>p.thumbDirty=false);scheduleThumb(pages[1]);');
  assert.deepEqual(app.json('pages.map(p=>p.thumbDirty)'), [false,true]);
});

test('page thumbnails switch with keyboard and delete buttons stop propagation', () => {
  const app = createApp();
  app.run('pages.push(newPage());rebuildStrip();');
  const second = app.elements.get('pagestrip').querySelectorAll('.pthumb')[1];
  assert.equal(second.getAttribute('role'), 'button');
  assert.equal(second.tabIndex, 0);
  second.focus();
  const event = {target:second,key:' ',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
  second.onkeydown(event);
  assert.equal(app.run('state.pageIndex'), 1);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  const active = app.elements.get('pagestrip').querySelectorAll('.pthumb')[1];
  assert.equal(active.getAttribute('aria-current'), 'page');
  assert.equal(app.document.activeElement, active);
  const del = active.children.find(child => child.classList.contains('pdel'));
  const delEvent = {key:' ',stopPropagation(){this.stopped=true;}};
  del.onkeydown(delEvent);
  assert.equal(delEvent.stopped, true);
});
