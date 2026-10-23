const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers.cjs');

function board() {
  const app = createApp();
  app.run(`page().objects.push(
    {id:'a',type:'rect',x0:200,y0:200,x1:300,y1:300,width:4,color:'#23282F',fill:true},
    {id:'b',type:'ellipse',x0:400,y0:200,x1:500,y1:300,width:4,color:'#23282F',fill:true});
    setTool('select');state.selectedIds=new Set(['a','b']);refreshContextUI();`);
  return app;
}
function click(app, x, y, extra = {}) {
  app.run(`handleSelectDown(${JSON.stringify({clientX:x,clientY:y,...extra})},{x:${x},y:${y}});finishGesture();`);
}

test('groups select by member, toggle as a unit, expand marquee and move together', () => {
  const app = board();
  app.fire('keydown', {key:'g',ctrlKey:true});
  assert.ok(app.run('page().objects[0].groupId'));
  assert.equal(app.run('page().objects[0].groupId === page().objects[1].groupId'), true);
  app.run('state.selectedIds.clear();');
  click(app, 250, 250);
  assert.deepEqual(app.json('[...state.selectedIds]'), ['a','b']);
  app.fire('keydown', {key:'ArrowRight'});
  assert.deepEqual(app.json('page().objects.map(o=>o.x0)'), [203,403]);
  click(app, 250, 250, {shiftKey:true});
  assert.equal(app.run('state.selectedIds.size'), 0);
  app.run('updateMarqueeSelection({x0:210,y0:210,x1:220,y1:220,prevSelected:[]});');
  assert.deepEqual(app.json('[...state.selectedIds]'), ['a','b']);
  app.fire('keydown', {key:'G',ctrlKey:true,shiftKey:true});
  assert.equal(app.run('page().objects.some(o=>o.groupId)'), false);
  app.run('state.selectedIds.clear();');
  click(app,250,250);
  assert.deepEqual(app.json('[...state.selectedIds]'), ['a']);
});

test('locked objects remain selectable but reject transforms, property edits, deletion and erasure', () => {
  const app = board();
  app.elements.get('selLock').click();
  const before = app.json('page().objects');
  app.run('state.selectedIds.clear();');
  click(app,250,250);
  assert.deepEqual(app.json('[...state.selectedIds]'), ['a']);
  assert.equal(app.run('action'), null);
  assert.equal(app.run('getSelectionHandleAt(193,193,page().view)'), null);
  app.fire('keydown', {key:'ArrowRight'});
  app.fire('keydown', {key:'Delete'});
  app.run(`chooseColor('#FFFFFF');updateSelectedProperty('fill',false);bringSelToFront();sendSelToBack();
    eraseAt({x:250,y:250},{last:{x:250,y:250},snapped:false});`);
  assert.deepEqual(app.json('page().objects'), before);
  assert.equal(app.elements.get('selDel').disabled, true);
  app.fire('keydown', {key:'L',ctrlKey:true,shiftKey:true});
  app.fire('keydown', {key:'ArrowRight'});
  assert.equal(app.run('page().objects[0].x0'),203);
  assert.equal(app.run('page().objects[0].locked'), false);
});

test('locks protect grouped text from double click and group erasure removes all unlocked members', () => {
  const app = board();
  app.run(`page().objects.push({id:'txt',type:'text',x:600,y:200,fontSize:28,color:'#23282F',lines:['Keep']});
    state.selectedIds=new Set(['txt']);toggleSelectionLock();`);
  app.elements.get('board').dispatch('dblclick', {clientX:610,clientY:210});
  app.run(`openEditor(getObject('txt'),'text');`);
  assert.equal(app.run('editing'),null);
  app.run(`state.selectedIds=new Set(['a','b']);groupSelection();toggleSelectionLock();
    eraseAt({x:250,y:250},{last:{x:250,y:250},snapped:false});`);
  assert.equal(app.run('page().objects.length'),3);
  app.run(`toggleSelectionLock();eraseAt({x:250,y:250},{last:{x:250,y:250},snapped:false});`);
  assert.deepEqual(app.json('page().objects.map(o=>o.id)'),['txt']);
  app.run('undo();');
  assert.equal(app.run('page().objects.length'),3);
});

test('grouping and locking survive history and notebook round trips', () => {
  const app = board();
  app.run('groupSelection();toggleSelectionLock();');
  const expected = app.json('page().objects');
  app.run('undo();');
  assert.equal(app.run('page().objects.some(o=>o.locked)'),false);
  app.run('undo();');
  assert.equal(app.run('page().objects.some(o=>o.groupId)'),false);
  app.run('redo();redo();restoreBoard(serializeBoard());');
  assert.deepEqual(app.json('page().objects'),expected);
  app.run(`state.selectedIds=new Set(['a','b']);groupSelection(true);`);
  assert.deepEqual(app.json('page().objects'),expected);
});

test('duplicating, Alt-dragging and pasting groups create independent group identities', () => {
  const app = board();
  app.run('groupSelection();duplicateSelection();');
  const ids = app.json('page().objects.map(o=>o.groupId)');
  assert.equal(ids[0],ids[1]);
  assert.equal(ids[2],ids[3]);
  assert.notEqual(ids[0],ids[2]);
  app.run('state.selectedIds.clear();');
  click(app,250,250,{altKey:true});
  assert.equal(app.run('page().objects.length'),6);
  assert.equal(app.run('new Set(page().objects.map(o=>o.groupId)).size'),3);
  app.run(`pasteBoardObjects({type:'brightboard-clip',objects:page().objects.slice(0,2)});`);
  assert.equal(app.run('new Set(page().objects.map(o=>o.groupId)).size'),4);
  assert.equal(app.run('getSelectedObjects().length'),2);
});

test('mixed selections preserve locked items while deleting or restyling unlocked items', () => {
  const app = board();
  app.run(`page().objects[0].locked=true;chooseColor('#FFFFFF');deleteSelection();`);
  assert.deepEqual(app.json('page().objects.map(o=>[o.id,o.color])'),[['a','#23282F']]);
  assert.deepEqual(app.json('[...state.selectedIds]'),['a']);
});

test('malformed lock and group metadata cannot replace the notebook', () => {
  for (const [key,value] of [['locked','true'],['groupId','bad group'],['groupId',7]]) {
    const app = board();
    const before = app.json('serializeBoard()');
    app.run('globalThis.backup=serializeBoard();');
    app.run(`backup.pages[0].objects[0][${JSON.stringify(key)}]=${JSON.stringify(value)};`);
    assert.throws(()=>app.run('restoreBoard(backup);'));
    assert.deepEqual(app.json('serializeBoard()'),before);
  }
});

test('imported groups with a locked member protect the entire group', () => {
  const app = board();
  app.run(`groupSelection();page().objects[0].locked=true;restoreBoard(serializeBoard());
    state.selectedIds=new Set(page().objects.map(o=>o.id));nudge(10,0);deleteSelection();`);
  assert.equal(app.run('page().objects.every(o=>o.locked)'),true);
  assert.deepEqual(app.json('page().objects.map(o=>o.x0)'),[200,400]);
  app.run(`pasteBoardObjects({type:'brightboard-clip',objects:page().objects});`);
  assert.equal(app.run('getSelectedObjects().every(o=>o.locked)'),true);
});

test('quick white, expanded palette and drawer selection keep native picking and hotkeys available', () => {
  const app = createApp();
  const white = app.elements.get('swatchRow').children.find(e=>e.dataset.col==='#FFFFFF');
  white.click();
  assert.equal(app.run('state.color'),'#FFFFFF');
  assert.equal(app.elements.get('colorGrid').children.length,60);
  app.elements.get('paletteBtn').click();
  assert.equal(app.elements.get('colorPalette').hidden,false);
  app.elements.get('colorGrid').children[12].click();
  assert.equal(app.run('state.color'),'#FFEDD5');
  assert.equal(app.elements.get('colorPalette').hidden,true);
  app.elements.get('customColor').value='#123456';
  app.elements.get('customColor').dispatch('input');
  assert.equal(app.run('state.color'),'#123456');
  app.fire('keydown',{key:'o'});
  assert.equal(app.run('state.tool'),'ellipse');
  assert.equal(app.elements.get('shapesBtn').classList.contains('active'),true);
  const rowChildren = app.elements.get('swatchRow').children;
  const customIdx = rowChildren.indexOf(app.elements.get('customSw'));
  const paletteIdx = rowChildren.indexOf(app.elements.get('paletteBtn'));
  assert.equal(Math.abs(customIdx - paletteIdx), 1);
});
