const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers.cjs');

test('save confirmations expire, new messages reset the timer and failures stay visible', () => {
  const app = createApp();
  const status = app.elements.get('saveStatus');
  assert.equal(status.textContent, 'Autosave ready');
  assert.equal(status.classList.contains('show'), true);
  app.flushTimers();
  assert.equal(status.classList.contains('show'), false);
  app.run('saveNow();');
  assert.equal(status.textContent, 'Saved');
  assert.equal(status.classList.contains('show'), true);
  app.run('setSaveStatus("Saving…");');
  app.flushTimers();
  assert.equal(status.classList.contains('show'), true);
  app.run('setSaveStatus("Save failed — export a backup", true);');
  app.flushTimers();
  assert.equal(status.classList.contains('show'), true);
  assert.equal(status.classList.contains('error'), true);
  app.run('saveNow();');
  assert.equal(status.classList.contains('error'), false);
  app.flushTimers();
  assert.equal(status.classList.contains('show'), false);
});

test('mouse panels hide, reveal independently at their edges and stay open during use', () => {
  const app = createApp({hasHover:true});
  const rail = app.elements.get('toolrail'), strip = app.elements.get('pagestrip');
  rail.getBoundingClientRect = () => ({left:14,right:72,top:100,bottom:600});
  strip.getBoundingClientRect = () => ({left:480,right:800,top:610,bottom:708});
  const move = (clientX, clientY, extra = {}) => {
    const e = {clientX,clientY,pointerType:'mouse',buttons:0,target:app.elements.get('board'),...extra};
    for (const cb of app.documentHandlers.pointermove) cb(e);
  };
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), true);
  app.flushTimers();
  assert.equal(rail.classList.contains('is-revealed'), false);
  assert.equal(strip.classList.contains('is-revealed'), false);
  move(110,300);
  assert.equal(rail.classList.contains('is-revealed'), true);
  assert.equal(strip.classList.contains('is-revealed'), false);
  move(400,300);
  move(60,300,{target:rail.children[0]});
  app.flushTimers();
  assert.equal(rail.classList.contains('is-revealed'), true);
  move(500,640);
  assert.equal(strip.classList.contains('is-revealed'), true);
  move(600,650,{target:strip});
  app.flushTimers();
  assert.equal(rail.classList.contains('is-revealed'), false);
  assert.equal(strip.classList.contains('is-revealed'), true);
  move(400,300);
  app.flushTimers();
  assert.equal(strip.classList.contains('is-revealed'), false);
  move(5,715,{buttons:1});
  move(5,715,{pointerType:'pen'});
  move(5,715,{pointerType:'touch'});
  assert.equal(rail.classList.contains('is-revealed'), false);
  assert.equal(strip.classList.contains('is-revealed'), false);
  app.run('action = { kind: "draw" };');
  move(5,715);
  assert.equal(rail.classList.contains('is-revealed'), false);
  assert.equal(strip.classList.contains('is-revealed'), false);
});

test('touch panels remain visible and changing input mode cancels pending hiding', () => {
  const app = createApp();
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), false);
  const change = matches => {
    app.hoverMedia.matches = matches;
    app.hoverMedia.handlers.change.forEach(cb => cb());
  };
  change(true);
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), true);
  change(false);
  app.flushTimers();
  assert.equal(app.document.body.classList.contains('auto-hide-panels'), false);
  for (const id of ['toolrail','pagestrip']) assert.equal(app.elements.get(id).classList.contains('is-revealed'), true);
});

test('pins persist independently, cancel hiding and survive rebuilding pages', () => {
  const app = createApp({hasHover:true});
  app.elements.get('pinToolbox').click();
  app.flushTimers();
  assert.equal(app.elements.get('toolrail').classList.contains('is-pinned'), true);
  assert.equal(app.elements.get('toolrail').classList.contains('is-revealed'), true);
  assert.equal(app.elements.get('pagestrip').classList.contains('is-pinned'), false);
  const pin = app.elements.get('pinPages');
  pin.click(); pin.focus();
  app.run('addPage();');
  assert.equal(app.document.activeElement, pin);
  assert.equal(app.elements.get('pagestrip').children[0], pin);
  pin.click();
  app.flushTimers();
  assert.equal(app.elements.get('pagestrip').classList.contains('is-pinned'), false);
  const restored = createApp({hasHover:true,storage:Object.fromEntries(app.storage)});
  restored.flushTimers();
  assert.equal(restored.elements.get('toolrail').classList.contains('is-pinned'), true);
  assert.equal(restored.elements.get('pagestrip').classList.contains('is-pinned'), false);
  restored.elements.get('pinToolbox').click();
  restored.flushTimers();
  assert.equal(restored.elements.get('toolrail').classList.contains('is-revealed'), false);
});

test('brush cursor follows width, colour, opacity and zoom and hides off the board', () => {
  const app = createApp();
  const board = app.elements.get('board'), brush = app.elements.get('brushPreview');
  board.dispatch('pointermove',{pointerType:'mouse',clientX:300,clientY:300});
  assert.equal(brush.style.width,'4px');
  assert.equal(brush.style.display,'block');
  app.elements.get('widthRange').value = '20';
  app.elements.get('widthRange').dispatch('input');
  assert.equal(brush.style.width,'20px');
  app.run('page().view.zoom = 2; chooseColor("#D93A3A"); refreshContextUI();');
  assert.equal(brush.style.width,'40px');
  assert.equal(brush.style.color,'#D93A3A');
  app.elements.get('opacityRange').value = '30';
  app.elements.get('opacityRange').dispatch('input');
  assert.equal(brush.style['--brush-opacity'],0.3);
  app.run('setTool("highlighter");');
  assert.equal(brush.style.width,'28px');
  assert.equal(brush.style['--brush-opacity'],0.126);
  board.dispatch('pointerleave');
  assert.equal(brush.style.display,'none');
  board.dispatch('pointerenter',{pointerType:'touch',clientX:300,clientY:300});
  assert.equal(brush.style.display,'none');
});

test('opacity edits legacy selections with undo without overwriting drawing opacity', () => {
  const app = createApp();
  app.run(`state.opacity = 0.7;page().objects.push({id:'rect',type:'rect',x0:100,y0:100,x1:200,y1:200,width:4,color:'#23282F',fill:true});state.selectedIds=new Set(['rect']);setTool('select');`);
  app.elements.get('opacityRange').value = '40';
  app.elements.get('opacityRange').dispatch('input');
  assert.equal(app.run('page().objects[0].opacity'),0.4);
  assert.equal(app.run('state.opacity'),0.7);
  app.run('drawObject(ctx,page().objects[0]);');
  assert.equal(app.context.operations.findLast(o=>o.name==='strokeRect').alpha,0.4);
  assert.equal(app.context.operations.findLast(o=>o.name==='fillRect').alpha,0.06);
  assert.equal(app.context.globalAlpha,1);
  app.run('undo();');
  assert.equal(app.run('page().objects[0].opacity'),undefined);
  app.run('redo();restoreBoard(serializeBoard());');
  assert.equal(app.run('page().objects[0].opacity'),0.4);
});

test('new pen, shape, text and sticky marks capture drawing opacity', () => {
  const app = createApp();
  const board = app.elements.get('board');
  const pointer = (name,x,y) => board.dispatch(name,{pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:y,timeStamp:1000});
  app.run('state.opacity = 0.25;');
  pointer('pointerdown',300,300);pointer('pointerup',300,300);
  assert.equal(app.run('page().objects.at(-1).opacity'),0.25);
  app.run('setTool("rect");');
  pointer('pointerdown',300,300);pointer('pointermove',400,400);pointer('pointerup',400,400);
  assert.equal(app.run('page().objects.at(-1).opacity'),0.25);
  app.run('createDraftText(300,300);');
  assert.equal(app.run('editing.obj.opacity'),0.25);
  assert.equal(app.elements.get('textEditor').style.opacity,0.25);
  app.elements.get('textEditor').value = 'Transparent text';
  app.run('commitEditor();createStickyFrom({x0:300,y0:300,x1:500,y1:500,moved:true});');
  assert.equal(app.run('page().objects.at(-1).opacity'),0.25);
  assert.equal(app.elements.get('textEditor').style.background,'transparent');
});

test('startup shows only pen controls and selecting text exposes its controls', () => {
  const app = createApp();
  for (const id of ['fillRow', 'fontRow', 'noteRow']) assert.equal(app.elements.get(id).style.display, 'none');
  app.run(`page().objects.push({id:'text',type:'text',x:0,y:0,fontSize:36,color:'#123456',lines:['Hello']});
    state.selectedIds=new Set(['text']);setTool('select');syncToolbarToSelected(page().objects[0]);`);
  assert.equal(app.elements.get('ctxGroup').style.display, '');
  assert.equal(app.elements.get('swatchRow').style.display, '');
  assert.equal(app.elements.get('fontRow').style.display, '');
  assert.equal(app.elements.get('widthRow').style.display, 'none');
  assert.equal(app.elements.get('fontVal').textContent, 36);
  assert.equal(app.elements.get('customColor').value, '#123456');
  assert.equal(app.run('state.fontSize'), 28);
  assert.equal(app.run('state.color'), '#23282F');
});

test('selection widths do not inflate highlighters or overwrite per-tool defaults', () => {
  const app = createApp();
  app.run(`setTool('highlighter');state.size=8;
    page().objects.push({id:'hi',type:'stroke',mode:'hi',width:28,color:'#23282F',points:[{x:0,y:0,w:1}]});
    state.selectedIds=new Set(['hi']);setTool('select');syncToolbarToSelected(page().objects[0]);`);
  assert.equal(Number(app.elements.get('widthRange').value), 28);
  assert.equal(app.run('state.size'), 8);
  app.elements.get('widthRange').value = '35';
  app.elements.get('widthRange').dispatch('input');
  assert.equal(app.run('page().objects[0].width'), 35);
  assert.equal(app.run('state.size'), 8);
  app.run('setTool("pen");');
  assert.equal(app.run('state.size'), 4);
  app.run('setTool("highlighter");');
  assert.equal(app.run('state.size'), 8);
  assert.equal(app.run('Math.max(12,state.size*3.5)'), 28);
});

test('drawing palettes change drawing defaults while Select changes only applicable objects', () => {
  const app = createApp();
  app.run(`page().objects.push({id:'text',type:'text',x:0,y:0,fontSize:28,color:'#23282F',lines:['Hello']},
    {id:'note',type:'sticky',x:100,y:100,w:180,h:180,fontSize:28,color:'#FFE9A8',text:'Note'});
    state.selectedIds=new Set(['text','note']);setTool('select');setTool('pen');chooseColor('#D93A3A');`);
  assert.equal(app.run('page().objects[0].color'), '#23282F');
  assert.equal(app.run('state.color'), '#D93A3A');
  app.run(`setTool('select');chooseColor('#1F6FEB');`);
  assert.equal(app.run('page().objects[0].color'), '#1F6FEB');
  assert.equal(app.run('page().objects[1].color'), '#FFE9A8');
  assert.equal(app.run('state.color'), '#D93A3A');
  app.elements.get('noteRow').children[1].click();
  assert.equal(app.run('page().objects[1].color'), '#FFD2A8');
  assert.equal(app.run('state.noteColor'), '#FFE9A8');
});

test('keyboard zoom, Select All and accelerated font wheel use the advertised controls', () => {
  const app = createApp();
  const zoomIn = app.fire('keydown', {key:'+',code:'Equal',ctrlKey:true});
  assert.equal(zoomIn.defaultPrevented, true);
  assert.equal(app.run('page().view.zoom'), 1.25);
  app.fire('keydown', {key:'-',code:'Minus',metaKey:true});
  assert.equal(app.run('page().view.zoom'), 1);
  app.run('setTool("text");');
  app.elements.get('fontRow').dispatch('wheel', {deltaY:-1,shiftKey:true});
  assert.equal(app.run('state.fontSize'), 38);
  app.run(`page().objects.push({id:'rect',type:'rect',x0:0,y0:0,x1:100,y1:100,width:4,color:'#23282F',fill:false});`);
  app.fire('keydown', {key:'a',ctrlKey:true});
  assert.equal(app.run('state.tool'), 'select');
  assert.equal(app.run('state.selectedIds.has("rect")'), true);
  assert.equal(app.elements.get('widthRow').style.display, '');
});

test('Ctrl+C leaves native copy dispatch available', () => {
  const app = createApp();
  app.run(`page().objects.push({id:'rect',type:'rect',x0:0,y0:0,x1:100,y1:100,width:4,color:'#23282F'});
    state.selectedIds=new Set(['rect']);`);
  const event = app.fire('keydown', {key:'c',ctrlKey:true});
  assert.ok(!event.defaultPrevented);
  assert.equal(app.run('clipObjects.length'), 1);
});

test('Ctrl+S while typing persists the draft and reports storage failure truthfully', () => {
  let failed = false;
  const app = createApp({failStorage:()=>failed});
  app.run('createDraftText(100,100);');
  const editor = app.elements.get('textEditor');
  editor.value = 'Draft text';
  editor.dispatch('input');
  assert.ok(app.timers.size > 0);
  const saved = editor.dispatch('keydown', {key:'s',ctrlKey:true});
  assert.equal(saved.defaultPrevented, true);
  assert.equal(JSON.parse(app.storageWrites.at(-1).value).pages[0].objects[0].lines[0], 'Draft text');
  assert.equal(app.elements.get('toast').textContent, 'Board saved');
  assert.equal(app.run('editing !== null'), true);
  failed = true;
  editor.dispatch('keydown', {key:'s',ctrlKey:true});
  assert.match(app.elements.get('toast').textContent, /Save failed/);
  assert.equal(app.elements.get('saveStatus').classList.contains('error'), true);
});

test('oversized editor input and clipboard pastes preserve the last valid draft', () => {
  const app = createApp();
  app.run('createDraftText(100,100);');
  const editor = app.elements.get('textEditor');
  editor.value = 'Keep this text';
  editor.dispatch('input');
  for (const oversized of ['x'.repeat(1000001), Array(10001).fill('x').join('\n')]) {
    editor.value = oversized;
    editor.dispatch('input');
    assert.equal(editor.value, 'Keep this text');
    assert.equal(app.run('editing.lastValue'), 'Keep this text');
    assert.match(app.elements.get('toast').textContent, /Text is too large/);
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    const pasted = editor.dispatch('paste', {clipboardData:{getData:()=>oversized}});
    assert.equal(pasted.defaultPrevented, true);
    assert.equal(editor.value, 'Keep this text');
  }
  app.run('restoreBoard(serializeBoard());');
  assert.deepEqual(app.json('page().objects[0].lines'), ['Keep this text']);
});

test('valid text at the editor line limit survives save and restore', () => {
  const app = createApp();
  app.run('createDraftText(100,100);');
  const editor = app.elements.get('textEditor');
  editor.value = Array(10000).fill('line').join('\n');
  editor.dispatch('input');
  assert.equal(app.run('editing.lastValue'), editor.value);
  assert.equal(app.run('saveNow()'), true);
  app.run('restoreBoard(serializeBoard());');
  assert.equal(app.run('page().objects[0].lines.length'), 10000);
  assert.equal(app.run('page().objects[0].lines[9999]'), 'line');
});

test('backup dialog traps focus, isolates background controls and restores the opener', () => {
  const app = createApp();
  const dialog = app.elements.get('backupModal');
  const controls = ['downloadBackupBtn','uploadBackupBtn','backupCloseBtn'].map(id=>app.elements.get(id));
  for (const control of controls) {
    app.document.body.children = app.document.body.children.filter(el=>el!==control);
    dialog.appendChild(control);
  }
  const opener = app.elements.get('backupBtn');
  opener.focus();
  opener.click();
  assert.equal(app.document.activeElement, controls[0]);
  assert.equal(opener.inert, true);
  controls[2].focus();
  const tab = {key:'Tab',target:controls[2],preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
  for (const handler of app.documentHandlers.keydown || []) handler(tab);
  assert.equal(app.document.activeElement, controls[0]);
  assert.equal(tab.defaultPrevented, true);
  const reverse = {...tab,shiftKey:true};
  for (const handler of app.documentHandlers.keydown || []) handler(reverse);
  assert.equal(app.document.activeElement, controls[2]);
  const escape = {...tab,key:'Escape'};
  for (const handler of app.documentHandlers.keydown || []) handler(escape);
  assert.equal(dialog.classList.contains('show'), false);
  assert.equal(opener.inert, false);
  assert.equal(app.document.activeElement, opener);
});
