const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers.cjs');

function pointer(app, name, x, y, extra = {}) {
  return app.elements.get('board').dispatch(name, {
    pointerId:1,pointerType:'mouse',button:0,clientX:x,clientY:y,timeStamp:1000,...extra,
  });
}
function draw(app, type, reverse = false) {
  app.run(`setTool(${JSON.stringify(type)});`);
  pointer(app,'pointerdown',reverse?400:200,reverse?320:200);
  pointer(app,'pointermove',reverse?200:400,reverse?200:320);
  pointer(app,'pointerup',reverse?200:400,reverse?200:320);
}

const newShapes = ['roundRect','capsule','triangle','rightTriangle','diamond','pentagon','hexagon','octagon',
  'trapezoid','parallelogram','star','star4','star6','heart','plus','cross','lightning','chevron',
  'blockArrow','doubleArrow','speechBubble','cloud','semicircle','arc'];

test('drawer offers 28 accessible icon-only choices without visible labels or shortcut badges', () => {
  const app = createApp();
  const buttons = app.elements.get('shapeGrid').children;
  assert.equal(buttons.length,28);
  assert.equal(new Set(buttons.map(b=>b.dataset.tool)).size,28);
  for (const b of buttons) {
    assert.ok(b.getAttribute('aria-label'));
    assert.match(b.innerHTML,/<svg/);
    assert.doesNotMatch(b.innerHTML,/<(?:text|span|small)\b/);
    assert.equal(b.textContent,'');
    b.click();
    assert.equal(app.run('state.tool'),b.dataset.tool);
    assert.equal(app.elements.get('shapesBtn').classList.contains('active'),true);
  }
});

for (const [i,type] of newShapes.entries()) {
  test(`${type} supports pointer drawing, preview, precise edge hits, history and backup`, () => {
    const app = createApp();
    app.run(`setTool(${JSON.stringify(type)});state.fill=true;`);
    pointer(app,'pointerdown',200,200);
    pointer(app,'pointermove',400,320);
    assert.equal(app.run('tempShapeObj().type'),type);
    assert.equal(app.run('page().objects.length'),0);
    pointer(app,'pointerup',400,320);
    assert.equal(app.run('page().objects[0].type'),type);
    assert.equal(app.elements.get('fillRow').style.display,type==='arc'?'none':'');
    const count = app.context.operations.length;
    app.run('drawObject(ctx,page().objects[0]);');
    const ops = app.context.operations.slice(count);
    assert.ok(ops.some(op=>op.name==='stroke'));
    assert.equal(ops.some(op=>op.name==='fill'),type!=='arc');
    const p = app.json('shapeOutline(page().objects[0])[0]');
    assert.equal(app.run(`objectHit(page().objects[0],{x:${200+p.x},y:${200+p.y}},0)`),true);
    assert.equal(app.run('objectHit(page().objects[0],{x:1000,y:1000},0)'),false);
    app.run('undo();');
    assert.equal(app.run('page().objects.length'),0);
    app.run('redo();restoreBoard(serializeBoard());');
    assert.equal(app.run('page().objects[0].type'),type);
    draw(app,type,!!(i%2));
    assert.equal(app.run('page().objects.length'),2);
    app.run(`setTool('select');state.selectedIds=new Set(page().objects.map(o=>o.id));chooseColor('#FFFFFF');`);
    assert.equal(app.run('page().objects.every(o=>o.color==="#FFFFFF")'),true);
  });
}

test('polygon and curve selection follows silhouettes rather than their rectangular bounds', () => {
  const app = createApp();
  const hit = (type,x,y) => app.run(`objectHit({type:${JSON.stringify(type)},x0:100,y0:100,x1:300,y1:300,width:2,color:'#23282F'}, {x:${x},y:${y}},0)`);
  assert.equal(hit('triangle',105,105),false);
  assert.equal(hit('triangle',200,240),true);
  assert.equal(hit('diamond',105,105),false);
  assert.equal(hit('diamond',200,200),true);
  assert.equal(hit('heart',105,295),false);
  assert.equal(hit('heart',200,200),true);
  assert.equal(hit('plus',110,110),false);
  assert.equal(hit('plus',200,200),true);
  assert.equal(hit('arc',200,200),false);
  assert.equal(hit('arc',200,100),true);
  assert.equal(hit('semicircle',200,200),true);
});

test('all custom shapes resize, rotate, group, lock, duplicate and paste with valid geometry', () => {
  const app = createApp();
  for (const type of newShapes) draw(app,type);
  app.run(`setTool('select');state.selectedIds=new Set(page().objects.map(o=>o.id));groupSelection();
    globalThis.selection=getSelectedObjects();
    globalThis.resize={objects:selection,sos:JSON.parse(JSON.stringify(selection)),handle:'se',startW:{x:400,y:320},startBounds:contentBounds(selection),snapped:false};
    doResize({x:500,y:420},resize);
    globalThis.rotation={objects:selection,sos:JSON.parse(JSON.stringify(selection)),center:{x:300,y:260},startAngle:0,snapped:false};
    doRotate({x:300,y:360},{shiftKey:true},rotation);`);
  assert.equal(app.run('selection.every(hasValidGeometry)'),true);
  assert.equal(app.run('selection.every(o=>Math.abs(o.angle-Math.PI/2)<1e-10)'),true);
  for (const type of newShapes) {
    app.run(`globalThis.o=page().objects.find(o=>o.type===${JSON.stringify(type)});`);
    assert.equal(app.run(`(()=>{const b=boundsOf(o),cx=(o.x0+o.x1)/2,cy=(o.y0+o.y1)/2,w=Math.abs(o.x1-o.x0),h=Math.abs(o.y1-o.y0);
      return shapeOutline(o).every(p=>{const x=cx+(p.x-w/2)*Math.cos(o.angle)-(p.y-h/2)*Math.sin(o.angle),y=cy+(p.x-w/2)*Math.sin(o.angle)+(p.y-h/2)*Math.cos(o.angle);
        return x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h&&objectHit(o,{x,y},0);});})()`),true,type);
  }
  const before = app.json('page().objects');
  app.run(`toggleSelectionLock();nudge(10,10);deleteSelection();`);
  assert.deepEqual(app.json('page().objects.map(o=>({...o,locked:undefined}))'),before);
  app.run(`toggleSelectionLock();duplicateSelection();pasteBoardObjects({type:'brightboard-clip',objects:getSelectedObjects()});restoreBoard(serializeBoard());`);
  assert.equal(app.run('page().objects.length'),newShapes.length*3);
  assert.equal(app.run('new Set(page().objects.map(o=>o.groupId)).size'),3);
});

test('Shift constrains custom shapes and the eraser respects concave silhouettes', () => {
  const app = createApp();
  app.run(`setTool('star');`);
  pointer(app,'pointerdown',200,200);
  pointer(app,'pointermove',400,320,{shiftKey:true});
  pointer(app,'pointerup',400,400,{shiftKey:true});
  assert.equal(app.run('Math.abs(page().objects[0].x1-page().objects[0].x0)'),200);
  assert.equal(app.run('Math.abs(page().objects[0].y1-page().objects[0].y0)'),200);
  app.run(`eraseAt({x:205,y:205},{last:{x:205,y:205},snapped:false});`);
  assert.equal(app.run('page().objects.length'),1);
  app.run(`eraseAt({x:300,y:300},{last:{x:300,y:300},snapped:false});`);
  assert.equal(app.run('page().objects.length'),0);
});

test('unknown shape kinds cannot replace a valid notebook', () => {
  const app = createApp();
  draw(app,'heart');
  app.run(`globalThis.bad=serializeBoard();bad.pages[0].objects[0].type='unknown-shape';`);
  assert.throws(()=>app.run('restoreBoard(bad);'));
  assert.equal(app.run('page().objects[0].type'),'heart');
});
