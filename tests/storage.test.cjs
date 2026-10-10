const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers.cjs');
const imageSrc = 'data:image/png;base64,aGVsbG8=';
const rect = {id:'rect1',type:'rect',x0:100,y0:100,x1:200,y1:200,width:4,color:'#23282F',fill:false};
const image = {id:'image1',type:'image',imgId:'asset1',x:100,y:100,w:100,h:100};
function setObjects(app, objects) {app.run(`page().objects=${JSON.stringify(objects)}`);}
function restore(app, objects = [image], images = [['asset1',imageSrc]]) {
  app.run(`restoreBoard(${JSON.stringify({v:1,pages:[{objects,bg:'grid',view:{zoom:1,panX:0,panY:0}}],images})})`);
}

test('saving and backup serialization retain assets used only by undo and redo', () => {
  const app=createApp();restore(app);app.images[0].load();
  app.run('state.selectedIds=new Set(["image1"]);deleteSelection();saveNow();undo()');
  assert.equal(app.run('IMG.has("asset1")'),true);
  assert.equal(app.run('page().objects[0].imgId'),'asset1');
  app.run('undo();saveNow();redo()');
  assert.equal(app.run('IMG.has("asset1")'),true);
  const before=app.run('IMG.size');app.run('serializeBoard()');assert.equal(app.run('IMG.size'),before);
});

test('unused assets can be collected after all recoverable references expire', () => {
  const app=createApp();restore(app);
  app.run('page().objects=[];page().undo=[];page().redo=[];clipObjects=null;pruneUnusedImages()');
  assert.equal(app.run('IMG.size'),0);
});

test('malformed backup never replaces the live notebook', () => {
  const app=createApp();setObjects(app,[rect]);
  for(const backup of [
    {pages:[{objects:{}}]},
    {pages:[{objects:[{...rect,x0:Infinity}]}]},
    {pages:[{objects:[{id:'s',type:'stroke',mode:'pen',width:4,color:'#23282F',points:[null]}]}]},
    {pages:[{objects:[image]}]},
    {v:99,pages:[{objects:[]}]},
    {pages:[{objects:[rect,{...rect}]}]},
  ]) {
    app.run(`globalThis.bad=${JSON.stringify(backup)}`);
    assert.throws(()=>app.run('restoreBoard(bad)'));
    assert.deepEqual(app.json('page().objects'),[rect]);
  }
  assert.throws(()=>app.run('restoreBoard({pages:[{objects:[],view:{zoom:1,panX:Infinity,panY:0}}]})'));
  assert.deepEqual(app.json('page().objects'),[rect]);
});

test('legacy valid backups normalize without losing drawing contents', () => {
  const app=createApp();restore(app,[rect],[]);
  assert.deepEqual(app.json('page().objects'),[rect]);
  assert.equal(app.run('page().view.zoom'),1);
  assert.equal(app.run('pages.length'),1);
});

test('an invalid stored notebook leaves a usable initial page', () => {
  const app=createApp({storage:{'brightboard.board.v1':'{"pages":[{"objects":{}}]}'}});
  assert.equal(app.run('pages.length'),1);
  assert.equal(app.run('page().objects.length'),0);
  app.run('render()');
});

test('rejected stored data remains protected even when recovery storage is full', () => {
  const original='{"pages":[{"objects":{}}]}';
  const app=createApp({storage:{'brightboard.board.v1':original},failStorage:()=>true});
  app.fire('beforeunload');
  assert.equal(app.storage.get('brightboard.board.v1'),original);
  assert.equal(app.run('saveNow()'),false);
  assert.equal(app.elements.get('downloadRecoveryBtn').hidden,false);
});

test('rejected stored data is retained separately before replacing the main save', () => {
  const original='{"pages":[{"objects":{}}]}';
  const app=createApp({storage:{'brightboard.board.v1':original}});
  app.run('saveNow()');
  assert.equal(app.storage.get('brightboard.recovery.v1'),original);
  assert.equal(JSON.parse(app.storage.get('brightboard.board.v1')).pages.length,1);
});

test('old missing-image saves recover other content and preserve the original raw data', () => {
  const text={id:'text1',type:'text',x:100,y:100,fontSize:28,color:'#23282F',lines:['Existing notes']};
  const original=JSON.stringify({v:1,pages:[{objects:[text,image]}],images:[]});
  const app=createApp({storage:{'brightboard.board.v1':original}});
  assert.equal(app.run('page().objects.length'),2);
  assert.deepEqual(app.json('page().objects[0].lines'),['Existing notes']);
  assert.match(app.run('IMG.get("asset1").src'),/^data:image\/svg\+xml/);
  assert.equal(app.storage.get('brightboard.recovery.v1'),original);
  app.run('restoreBoard(serializeBoard())');
  assert.equal(app.run('page().objects.length'),2);
});

test('active text drafts persist without mutating objects or adding undo steps per save', () => {
  const app=createApp();app.run('createDraftText(100,100)');
  app.elements.get('textEditor').value='First draft';
  assert.equal(app.run('saveNow()'),true);
  let saved=JSON.parse(app.storage.get('brightboard.board.v1'));
  assert.deepEqual(saved.pages[0].objects[0].lines,['First draft']);
  assert.equal(app.run('page().objects.length'),0);
  app.elements.get('textEditor').value='Updated draft';
  app.fire('beforeunload');saved=JSON.parse(app.storage.get('brightboard.board.v1'));
  assert.deepEqual(saved.pages[0].objects[0].lines,['Updated draft']);
  assert.equal(app.run('page().undo.length'),0);
  const reloaded=createApp({storage:{'brightboard.board.v1':JSON.stringify(saved)}});
  assert.deepEqual(reloaded.json('page().objects[0].lines'),['Updated draft']);
});

test('existing text and sticky edits are included in draft persistence', () => {
  const app=createApp();setObjects(app,[{id:'text1',type:'text',x:100,y:100,fontSize:28,color:'#23282F',lines:['old']}]);
  app.run('openEditor(page().objects[0],"text")');app.elements.get('textEditor').value='new';
  app.run('saveNow()');
  assert.deepEqual(JSON.parse(app.storage.get('brightboard.board.v1')).pages[0].objects[0].lines,['new']);
  assert.deepEqual(app.json('page().objects[0].lines'),['old']);
  app.run('commitEditor()');setObjects(app,[{id:'sticky1',type:'sticky',x:100,y:100,w:180,h:180,fontSize:24,color:'#FFE9A8',text:'old'}]);
  app.run('openEditor(page().objects[0],"sticky")');app.elements.get('textEditor').value='new sticky';app.fire('pagehide');
  assert.equal(JSON.parse(app.storage.get('brightboard.board.v1')).pages[0].objects[0].text,'new sticky');
});

test('autosave retries after storage recovers and reports the real result', () => {
  let failed=true;const app=createApp({failStorage:()=>failed});
  assert.equal(app.run('saveNow()'),false);
  assert.equal(app.elements.get('saveStatus').classList.contains('error'),true);
  failed=false;app.run('scheduleSave()');app.flushTimers();
  assert.equal(app.storageWrites.length,1);
  assert.equal(app.elements.get('saveStatus').textContent,'Saved');
  assert.equal(app.run('saveBroken'),false);
});

test('saving invalid state never overwrites a previous valid notebook', () => {
  const app=createApp();setObjects(app,[rect]);app.run('saveNow()');
  const previous=app.storage.get('brightboard.board.v1');app.run('page().objects[0].x0=Infinity');
  assert.equal(app.run('saveNow()'),false);
  assert.equal(app.storage.get('brightboard.board.v1'),previous);
});

test('external text and image placement at extreme views remain restorable', () => {
  const app=createApp();app.run('page().view={zoom:0.2,panX:1e9,panY:1e9}');
  app.fire('paste',{clipboardData:{items:[],getData(){return 'At board edge';}}});
  app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null)`);app.images[0].load();
  assert.equal(app.run('saveNow()'),true);app.run('restoreBoard(serializeBoard())');
  assert.equal(app.run('page().objects.length'),2);
});

test('restored image sources serialize before decoding and ignore obsolete callbacks', () => {
  const app=createApp();restore(app);
  assert.deepEqual(app.json('serializeBoard().images'),[['asset1',imageSrc]]);
  const obsolete=app.images[0];restore(app,[rect],[]);obsolete.load();
  assert.equal(app.run('IMG.size'),0);
  assert.deepEqual(app.json('page().objects'),[rect]);
});

test('failed image decoding retains its source for a JSON rescue backup', () => {
  const app=createApp();restore(app);app.images[0].fail();
  assert.equal(app.run('IMG.get("asset1").status'),'error');
  assert.deepEqual(app.json('serializeBoard().images'),[['asset1',imageSrc]]);
  app.context.drawImage=()=>{throw new Error('InvalidStateError: broken image');};
  app.run('render()');
});

test('async image placement stays on its initiating page', () => {
  const app=createApp();const first=app.run('page().id');
  app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)}, {x:200,y:200})`);app.run('addPage()');app.images[0].load();
  assert.equal(app.run(`pages.find(p=>p.id===${JSON.stringify(first)}).objects.length`),1);
  assert.equal(app.run('page().objects.length'),0);
  assert.equal(app.run(`pages.find(p=>p.id===${JSON.stringify(first)}).undo.length`),1);
});

test('pending imports do not leak into a replaced notebook', () => {
  const app=createApp();app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null)`);
  restore(app,[rect],[]);app.images[0].load();
  assert.deepEqual(app.json('page().objects'),[rect]);assert.equal(app.run('IMG.size'),0);
});

test('very thin resized images roundtrip with positive image dimensions', () => {
  const app=createApp();app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null)`);app.images[0].load(4000,1);
  assert.ok(app.run('page().objects[0].h')>0);
  app.run('restoreBoard(serializeBoard())');assert.equal(app.run('page().objects.length'),1);
});

test('an inactive image import never interrupts another page gesture or editor', () => {
  const app=createApp();app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null);addPage()`);
  app.elements.get('board').dispatch('pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:300,clientY:300,timeStamp:1000});
  app.images[0].load();assert.equal(app.run('action.type'),'draw');
  app.elements.get('board').dispatch('pointerup',{pointerId:1,clientX:300,clientY:300});
  assert.equal(app.run('page().objects.length'),1);
});

test('same-page asynchronous imports wait until the active drawing is finished', () => {
  const app=createApp();app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null)`);
  app.elements.get('board').dispatch('pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:300,clientY:300,timeStamp:1000});
  app.images[0].load();assert.equal(app.run('action.type'),'draw');assert.equal(app.run('page().objects.length'),0);
  app.elements.get('board').dispatch('pointerup',{pointerId:1,clientX:300,clientY:300});app.flushTimers();
  assert.equal(app.run('page().objects.length'),2);
});

test('over-limit external text is rejected before it can produce an unrestorable notebook', () => {
  const app=createApp();const tooManyLines='x\n'.repeat(10000)+'x';
  app.fire('paste',{clipboardData:{items:[],getData(){return tooManyLines;}}});
  assert.equal(app.run('page().objects.length'),0);
  assert.match(app.elements.get('toast').textContent,/too large/);
});

test('native copy payload overwrites stale clipboard text and pastes selected objects', () => {
  const app=createApp();setObjects(app,[rect]);app.run('state.selectedIds=new Set(["rect1"])');
  const key=app.fire('keydown',{key:'c',ctrlKey:true});assert.equal(!!key.defaultPrevented,false);
  let clipboard='earlier external text';
  app.fire('copy',{clipboardData:{setData(type,value){clipboard=value;}}});
  assert.equal(JSON.parse(clipboard).type,'brightboard-clip');
  app.fire('paste',{clipboardData:{items:[],getData(){return clipboard;}}});
  assert.equal(app.run('page().objects.length'),2);assert.equal(app.run('page().objects[1].type'),'rect');
});

test('image clipboard objects include data and remap assets in another session', () => {
  const first=createApp();restore(first);first.run('state.selectedIds=new Set(["image1"])');
  let clipboard;first.fire('copy',{clipboardData:{setData(type,value){clipboard=value;}}});
  const second=createApp();second.fire('paste',{clipboardData:{items:[],getData(){return clipboard;}}});
  const pasted=second.json('page().objects[0]');
  assert.notEqual(pasted.imgId,'asset1');assert.equal(second.run(`IMG.get(${JSON.stringify(pasted.imgId)}).src`),imageSrc);
  assert.equal(second.json('serializeBoard().images').length,1);
});

test('invalid structured clipboard input cannot partially add broken objects', () => {
  const app=createApp();setObjects(app,[rect]);
  const payload=JSON.stringify({type:'brightboard-clip',objects:[{...rect,id:'other'},{id:'bad',type:'unknown'}]});
  app.fire('paste',{clipboardData:{items:[],getData(){return payload;}}});
  assert.deepEqual(app.json('page().objects'),[rect]);assert.equal(app.run('page().undo.length'),0);
});

test('PNG dimensions and pixel area stay bounded for widely spread content', () => {
  const app=createApp();setObjects(app,[{...rect,x0:0,y0:0,x1:100000,y1:100000}]);app.run('exportPNG()');
  const canvas=app.canvases.at(-1);
  assert.ok(canvas.width<=8000&&canvas.height<=8000);
  assert.ok(canvas.width*canvas.height<=16000000);
  assert.equal(app.elements.get('toast').textContent,'PNG downloaded');
});

test('PNG waits for images and handles null asynchronous encoding results', () => {
  const app=createApp();restore(app);app.run('exportPNG()');
  assert.match(app.elements.get('toast').textContent,/finish loading/);
  app.images[0].load();
  const original=app.document.createElement;
  app.document.createElement=(tag)=>{const e=original(tag);if(tag==='canvas')e.toBlob=cb=>cb(null);return e;};
  app.run('exportPNG()');assert.match(app.elements.get('toast').textContent,/Could not export PNG/);
});

test('an image import on an inactive page leaves the active text draft open', () => {
  const app = createApp();
  app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null);addPage();createDraftText(100,100);`);
  app.elements.get('textEditor').value = 'Keep this draft open';
  const draftId = app.run('editing.obj.id');
  app.images[0].load();
  assert.equal(app.run('editing.obj.id'), draftId);
  assert.equal(app.elements.get('textEditor').value, 'Keep this draft open');
  assert.equal(app.run('page().objects.length'), 0);
  assert.equal(app.run('pages[0].objects[0].type'), 'image');
  app.run('commitEditor();');
  assert.deepEqual(app.json('page().objects[0].lines'), ['Keep this draft open']);
});

test('a same-page image import waits for text commit without losing its draft', () => {
  const app = createApp();
  app.run(`finalizeImageSrc(${JSON.stringify(imageSrc)},null);createDraftText(100,100);`);
  app.elements.get('textEditor').value = 'Commit before the image';
  app.images[0].load();
  assert.equal(app.run('editing.kind'), 'text');
  assert.equal(app.run('page().objects.length'), 0);
  app.run('commitEditor();');
  app.flushTimers();
  assert.equal(app.run('page().objects.length'), 2);
  assert.deepEqual(app.json('page().objects[0].lines'), ['Commit before the image']);
  assert.equal(app.run('page().objects[1].type'), 'image');
  app.run('restoreBoard(serializeBoard());');
  assert.equal(app.run('page().objects.length'), 2);
});
