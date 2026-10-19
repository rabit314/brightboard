const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./helpers.cjs');

function pointer(app, type, id, x, y, pointerType = 'mouse', extra = {}) {
  return app.elements.get('board').dispatch(type, {
    pointerId: id, pointerType, button: 0, clientX: x, clientY: y, timeStamp: 1000 + x, ...extra,
  });
}

function imageSelection(app) {
  app.run(`registerImageSource('fixture','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
    page().objects = [{id:'image', type:'image', x:100, y:100, w:100, h:100, imgId:'fixture'}];
    state.tool = 'select'; state.selectedIds = new Set(['image']); page().thumbDirty = false;`);
  app.images.at(-1).load(100, 100);
  app.run('page().thumbDirty=false');
}

test('foreign pointer movement, release and cancellation cannot change the owner stroke', () => {
  const app = createApp();
  pointer(app, 'pointerdown', 1, 100, 100, 'pen');
  pointer(app, 'pointermove', 2, 400, 400);
  pointer(app, 'pointerup', 2, 400, 400);
  pointer(app, 'pointercancel', 2, 400, 400);
  assert.equal(app.run('action.pointerId'), 1);
  assert.equal(app.run('action.temp.points.length'), 1);
  assert.equal(app.run('page().objects.length'), 0);
  pointer(app, 'pointermove', 1, 150, 100, 'pen');
  pointer(app, 'pointerup', 1, 150, 100, 'pen');
  assert.equal(app.run('page().objects[0].points.length'), 2);
  assert.equal(app.run('activePtrs.size'), 0);
});

test('a palm touch cannot replace an active pen stroke with pinch', () => {
  const app = createApp();
  pointer(app, 'pointerdown', 1, 100, 100, 'pen');
  pointer(app, 'pointerdown', 2, 300, 300, 'touch');
  assert.equal(app.run('action.type'), 'draw');
  assert.equal(app.run('activePtrs.size'), 1);
});

test('canceling a move keeps the edit and schedules its thumbnail and save', () => {
  const app = createApp();
  imageSelection(app);
  pointer(app, 'pointerdown', 1, 150, 150);
  pointer(app, 'pointermove', 1, 160, 150);
  pointer(app, 'pointercancel', 1, 160, 150);
  assert.equal(app.run('page().objects[0].x'), 110);
  assert.equal(app.run('page().thumbDirty'), true);
  assert.equal(app.run('action'), null);
  app.flushTimers();
  assert.equal(JSON.parse(app.storageWrites.at(-1).value).pages[0].objects[0].x, 110);
});

test('pinch finalizes the previous move, captures only two touches and saves navigation', () => {
  const app = createApp();
  imageSelection(app);
  pointer(app, 'pointerdown', 1, 150, 150, 'touch');
  pointer(app, 'pointermove', 1, 160, 150, 'touch');
  pointer(app, 'pointerdown', 2, 300, 300, 'touch');
  assert.equal(app.run('action.type'), 'pinch');
  assert.equal(app.run('page().thumbDirty'), true);
  pointer(app, 'pointerdown', 3, 400, 400, 'touch');
  pointer(app, 'pointerup', 3, 400, 400, 'touch');
  assert.equal(app.run('activePtrs.size'), 2);
  assert.equal(app.run('action.type'), 'pinch');
  pointer(app, 'pointermove', 2, 350, 350, 'touch');
  pointer(app, 'pointerup', 2, 350, 350, 'touch');
  assert.equal(app.run('action'), null);
  assert.equal(app.run('activePtrs.size'), 1);
  pointer(app, 'pointerup', 1, 160, 150, 'touch');
  app.flushTimers();
  const saved = JSON.parse(app.storageWrites.at(-1).value).pages[0];
  assert.equal(saved.objects[0].x, 110);
  assert.ok(saved.view.zoom > 1);
});

test('interrupted unfinished drawing is discarded and leaves no captured pointers', () => {
  const app = createApp();
  pointer(app, 'pointerdown', 1, 100, 100);
  pointer(app, 'pointermove', 1, 200, 100);
  app.run('finishGesture({cancel:true})');
  assert.equal(app.run('page().objects.length'), 0);
  assert.equal(app.run('activePtrs.size'), 0);
  assert.equal(app.run('action'), null);
});

test('Alt-click duplication is persisted even without crossing the movement threshold', () => {
  const app = createApp();
  imageSelection(app);
  pointer(app, 'pointerdown', 1, 150, 150, 'mouse', {altKey:true});
  pointer(app, 'pointerup', 1, 150, 150);
  assert.equal(app.run('page().objects.length'), 2);
  assert.equal(app.run('page().thumbDirty'), true);
  assert.equal(app.run('page().undo.length'), 1);
  app.flushTimers();
  assert.equal(JSON.parse(app.storageWrites.at(-1).value).pages[0].objects.length, 2);
});

test('resizing uses drag distance, without adding the selection handle padding', () => {
  for (const zoom of [0.2, 1, 5]) {
    const app = createApp();
    imageSelection(app);
    app.run(`page().objects[0].x=0; page().objects[0].y=0; page().view.zoom=${zoom};`);
    const hd = app.json("selHandleScreen(contentBounds(getSelectedObjects()),page().view).find(h=>h.h==='se')");
    pointer(app, 'pointerdown', 1, hd.sx, hd.sy);
    pointer(app, 'pointermove', 1, hd.sx + 4, hd.sy + 4);
    pointer(app, 'pointerup', 1, hd.sx + 4, hd.sy + 4);
    assert.ok(Math.abs(app.run('page().objects[0].w') - (100 + 4 / zoom)) < 1e-8);
    assert.equal(app.run('page().objects[0].x'), 0);
  }
});

test('arrow selection excludes the removed shaft overhang at every angle and thickness', () => {
  const app = createApp();
  for (const length of [20,400]) for (const width of [1,4,48,96]) for (const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI/4,Math.PI*1.3]) {
    const ux=Math.cos(angle),uy=Math.sin(angle);
    const arrow={type:'arrow',x0:200,y0:200,x1:200+ux*length,y1:200+uy*length,width,color:'#23282F'};
    app.run(`globalThis.testArrow=${JSON.stringify(arrow)};`);
    assert.equal(app.run(`objectHit(testArrow,{x:${arrow.x1+ux*8},y:${arrow.y1+uy*8}},0)`),false);
    assert.equal(app.run(`objectHit(testArrow,{x:${arrow.x1-ux},y:${arrow.y1-uy}},0)`),true);
    assert.equal(app.run(`objectHit(testArrow,{x:${200-ux*width/4},y:${200-uy*width/4}},0)`),true);
  }
  assert.equal(app.run(`objectHit({...testArrow,x1:200,y1:200},{x:200,y:200},0)`),false);
});

test('arrow bounds contain the rendered head and the head can be selected or erased', () => {
  const app = createApp();
  app.run("fixtureArrow={id:'arrow',type:'arrow',x0:0,y0:0,x1:1000,y1:0,width:48,color:'#23282F'}; page().objects=[fixtureArrow]");
  const b = app.json('boundsOf(fixtureArrow)');
  for (const vertex of app.json('arrowHead(fixtureArrow)')) {
    assert.ok(vertex.x >= b.x && vertex.x <= b.x + b.w);
    assert.ok(vertex.y >= b.y && vertex.y <= b.y + b.h);
  }
  assert.equal(app.run('objectHit(fixtureArrow,{x:825,y:80},0)'), true);
  app.run('eraseAt({x:825,y:80},{last:{x:825,y:80},snapped:false})');
  assert.equal(app.run('page().objects.length'), 0);
  assert.equal(app.run("objectHit({...fixtureArrow,x1:0},{x:100,y:100},0)"), false);
});

test('thick rectangle and ellipse edges match selection hit regions', () => {
  const app = createApp();
  for (const type of ['rect', 'ellipse']) {
    assert.equal(app.run(`objectHit({type:'${type}',x0:0,y0:0,x1:100,y1:100,width:48},{x:122,y:50},0)`), true);
    assert.equal(app.run(`objectHit({type:'${type}',x0:0,y0:0,x1:100,y1:100,width:48},{x:140,y:50},0)`), false);
  }
});

test('freehand hit testing follows the same quadratic curves as rendering', () => {
  const app = createApp();
  app.run("fixtureStroke={type:'stroke',mode:'pen',width:4,color:'#23282F',points:[{x:0,y:0,w:1},{x:100,y:0,w:1},{x:100,y:100,w:1},{x:200,y:100,w:1}]}");
  assert.equal(app.run('objectHit(fixtureStroke,{x:75,y:12.5},0)'), true);
  assert.equal(app.run('objectHit(fixtureStroke,{x:100,y:0},0)'), false);
  const segments = app.json('[...strokeSegments(fixtureStroke)]');
  app.context.operations.length = 0;
  app.run('drawStroke(ctx,fixtureStroke)');
  assert.deepEqual(app.context.operations.filter(op=>op.name==='quadraticCurveTo').map(op=>op.args), segments.map(s=>[s.cx,s.cy,s.x1,s.y1]));
});

test('sticky notes wrap oversized words into measured lines and retain paragraph breaks', () => {
  const app = createApp();
  const lines = app.json(String.raw`stickyLines(ctx,{w:100,fontSize:20,text:'averylongunbreakableword\n\nnext paragraph'})`);
  assert.ok(lines.length > 5);
  assert.ok(lines.includes(''));
  for (const line of lines) assert.ok(line.length * 20 * 0.6 <= 72);
  assert.equal(lines.join('').replaceAll(' ',''), 'averylongunbreakablewordnextparagraph');
});

test('rotated text editor uses the rendered text center including editor offsets', () => {
  const app = createApp();
  app.run("fixtureText={id:'text',type:'text',x:100,y:100,fontSize:28,color:'#23282F',lines:['long first line','second line'],angle:Math.PI/2}; page().objects=[fixtureText]; openEditor(fixtureText,'text')");
  const metrics = app.json('textMetrics(fixtureText)');
  const editor = app.elements.get('textEditor');
  assert.equal(editor.style.transformOrigin, `${metrics.w / 2 + 4}px ${metrics.h / 2 + 2}px`);
  assert.equal(app.run('editing.pageId'), app.run('page().id'));
  editor.value = 'new longer first line\nsecond';
  app.run('positionEditor()');
  const revised = app.json(String.raw`textMetrics({...fixtureText,lines:$('textEditor').value.split('\n')})`);
  assert.equal(editor.style.transformOrigin, `${revised.w / 2 + 4}px ${revised.h / 2 + 2}px`);
});

test('background patterns have bounded drawing work for very large exported spans', () => {
  const app = createApp();
  for (const bg of ['grid', 'dots', 'ruled']) {
    app.context.operations.length = 0;
    app.run(`drawBackgroundPattern(ctx,0.0001,'${bg}',[-1e7,-1e7,1e7,1e7])`);
    assert.ok(app.context.operations.length < 8000, `${bg} generated too many drawing operations`);
  }
});

test('repeated large text resizing keeps the group uniform and the notebook restorable', () => {
  const app = createApp();
  app.run(`page().objects=[
    {id:'text',type:'text',x:100,y:100,color:'#23282F',fontSize:28,lines:['text']},
    {id:'line',type:'line',x0:200,y0:100,x1:300,y1:200,color:'#23282F',width:4}
  ]; state.selectedIds=new Set(['text','line']);`);
  for (let i = 0; i < 6; i++) {
    const previous = app.json('page().objects.map(o=>o.fontSize || o.width)');
    app.run(`{
      const objects=getSelectedObjects(), b=contentBounds(objects), startW={x:b.x+b.w+7,y:b.y+b.h+7};
      const resize={objects,handle:'se',startW,startBounds:b,sos:JSON.parse(JSON.stringify(objects)),snapped:false};
      doResize({x:startW.x+b.w*13,y:startW.y+b.h*13},resize);
    }`);
    const next = app.json('page().objects.map(o=>o.fontSize || o.width)');
    assert.ok(next[0] <= 10000);
    assert.ok(Math.abs(next[0] / previous[0] - next[1] / previous[1]) < 1e-10);
    assert.equal(app.run('validateNotebook(serializeBoard()).pages[0].objects.length'), 2);
  }
  assert.ok(app.run('page().objects[0].fontSize') > 9999);
});

test('resize applies one scale when a selected object reaches its dimension or width limit', () => {
  const app = createApp();
  app.run(`page().objects=[
    {id:'line',type:'line',x0:0,y0:0,x1:100,y1:100,color:'#23282F',width:900000},
    {id:'note',type:'sticky',x:200,y:100,w:100,h:100,fontSize:20,text:'note',color:'#FFE9A8'}
  ]; state.selectedIds=new Set(['line','note']);
  {
    const objects=getSelectedObjects(), b=contentBounds(objects), startW={x:b.x+b.w,y:b.y+b.h};
    const resize={objects,handle:'se',startW,startBounds:b,sos:JSON.parse(JSON.stringify(objects)),snapped:false};
    doResize({x:startW.x+b.w*13,y:startW.y+b.h*13},resize);
  }`);
  const [line, note] = app.json('page().objects');
  assert.ok(line.width <= 1e6);
  assert.ok(Math.abs(line.width / 900000 - note.w / 100) < 1e-12);
  assert.equal(app.run('validateNotebook(serializeBoard()).pages[0].objects.length'), 2);
});

test('translation constrains the whole selection and duplication remains restorable at the coordinate edge', () => {
  const app = createApp();
  app.run(`page().objects=[
    {id:'a',type:'line',x0:999999995,y0:0,x1:999999999,y1:100,color:'#23282F',width:4},
    {id:'b',type:'line',x0:0,y0:0,x1:100,y1:100,color:'#23282F',width:4}
  ]; state.selectedIds=new Set(['a','b']);`);
  assert.deepEqual(app.json('constrainTranslation(getSelectedObjects(),24,24)'), {dx:1,dy:24});
  app.run('duplicateSelection()');
  const objects = app.json('page().objects');
  assert.equal(objects[2].x1, 1e9);
  assert.equal(objects[3].x0, 1);
  assert.equal(app.run('validateNotebook(serializeBoard()).pages[0].objects.length'), 4);
});

test('rotation rejects a candidate exceeding the coordinate limit without creating history', () => {
  const app = createApp();
  app.run(`page().objects=[{id:'line',type:'line',x0:8e8,y0:8e8,x1:1e9,y1:1e9,color:'#23282F',width:4}];
    const fixtureRotate={objects:page().objects,center:{x:9e8,y:9e8},startAngle:0,sos:JSON.parse(JSON.stringify(page().objects)),snapped:false};
    doRotate({x:9e8+100,y:9e8+100},{},fixtureRotate);`);
  assert.equal(app.run('page().objects[0].x0'), 8e8);
  assert.equal(app.run('page().undo.length'), 0);
  assert.equal(app.run('validateNotebook(serializeBoard()).pages[0].objects.length'), 1);
});

test('blur, pagehide and hidden visibility finish mutations, reset Space and persist immediately', () => {
  for (const event of ['blur', 'pagehide', 'visibilitychange']) {
    const app = createApp();
    imageSelection(app);
    pointer(app, 'pointerdown', 1, 150, 150);
    pointer(app, 'pointermove', 1, 160, 150);
    app.run('spaceHeld=true');
    if (event === 'visibilitychange') {
      app.document.visibilityState = 'hidden';
      app.documentHandlers.visibilitychange.forEach(callback=>callback({}));
    } else app.fire(event);
    assert.equal(app.run('spaceHeld'), false);
    assert.equal(app.run('action'), null);
    assert.equal(app.run('activePtrs.size'), 0);
    assert.equal(app.run('page().thumbDirty'), true);
    assert.equal(JSON.parse(app.storageWrites.at(-1).value).pages[0].objects[0].x, 110);
  }
});

test('zooming and drawing from an extreme valid view produce a restorable notebook', () => {
  const app = createApp();
  app.run('page().view={zoom:0.2,panX:1e9,panY:1e9}; setZoom(5,100,100)');
  assert.deepEqual(app.json('page().view'), {zoom:5,panX:1e9,panY:1e9});
  app.elements.get('board').dispatch('wheel', {deltaX:-1e9,deltaY:-1e9,clientX:100,clientY:100});
  assert.equal(app.run('page().view.panX'), 1e9);
  app.run('page().view.zoom=0.2');
  assert.deepEqual(app.json('worldFromClient(100,100)'), {x:-1e9,y:-1e9});
  pointer(app, 'pointerdown', 1, 100, 100);
  pointer(app, 'pointerup', 1, 100, 100);
  app.run("state.tool='sticky'");
  pointer(app, 'pointerdown', 2, 100, 100);
  pointer(app, 'pointerup', 2, 100, 100);
  app.run('commitEditor()');
  assert.equal(app.run('page().objects[1].x'), -1e9);
  assert.equal(app.run('page().objects[1].y'), -1e9);
  assert.equal(app.run('validateNotebook(serializeBoard()).pages[0].objects.length'), 2);
});
