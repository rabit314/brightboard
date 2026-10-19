const test = require('node:test');
const assert = require('node:assert/strict');
const {crc32} = require('node:zlib');
const {createApp} = require('./helpers.cjs');
const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');

function chunks(bytes) {
  const result = [];
  for (let offset=8;offset+12<=bytes.length;) {
    const length=bytes.readUInt32BE(offset), end=offset+length+12;
    assert.ok(end<=bytes.length);
    result.push({type:bytes.toString('ascii',offset+4,offset+8),data:bytes.subarray(offset+8,end-4),
      raw:bytes.subarray(offset,end),crc:bytes.readUInt32BE(end-4)});
    offset=end;
  }
  return result;
}
function setDrawing(app,w,h) {
  app.run(`page().objects=[{id:'drawing',type:'rect',x0:0,y0:0,x1:${w},y1:${h},width:4,color:'#23282F',fill:false}];`);
}

test('PNG density and render scale increase for larger drawings', async () => {
  const app=createApp();
  const small=app.json('pngExportPlan({x:0,y:0,w:800,h:500})');
  const medium=app.json('pngExportPlan({x:0,y:0,w:2400,h:500})');
  const large=app.json('pngExportPlan({x:0,y:0,w:4500,h:500})');
  assert.equal(small.dpi,300);
  assert.ok(medium.dpi>small.dpi && large.dpi>medium.dpi);
  assert.equal(large.dpi,384);
  assert.ok(small.scale>2 && medium.scale>small.scale && large.scale>medium.scale);
  setDrawing(app,4500,500);
  await app.run('exportPNG()');
  const c=app.canvases.at(-1);
  assert.ok(c.encodedWidth>9000);
  assert.ok(c.encodedWidth<=16000);
  assert.equal(c.width,1);
  assert.equal(app.elements.get('toast').textContent,'PNG downloaded');
});

test('large and extreme boards retain aspect ratio with bounded export memory', () => {
  const app=createApp();
  for (const [w,h] of [[5000,4000],[100000,100000],[20000,300],[300,20000],[2e9,1],[1,2e9]]) {
    const plan=app.json(`pngExportPlan({x:0,y:0,w:${w},h:${h}})`);
    const W=Math.max(1,Math.floor(plan.w*plan.scale)),H=Math.max(1,Math.floor(plan.h*plan.scale));
    assert.ok(W>=1&&H>=1&&W<=16000&&H<=16000);
    assert.ok(W*H<=64000000);
    if (w===5000) assert.ok(W*H>16000000);
    assert.ok(Math.abs(W-plan.w*plan.scale)<1 && Math.abs(H-plan.h*plan.scale)<=1);
  }
  app.run('navigator.deviceMemory=4;');
  const limited=app.json('pngExportPlan({x:0,y:0,w:5000,h:4000})');
  assert.ok(Math.floor(limited.w*limited.scale)*Math.floor(limited.h*limited.scale)<=32000000);
});

test('print DPI metadata has a valid CRC and preserves every compressed image byte', async () => {
  const app=createApp();
  app.run(`globalThis.sourcePng=new Blob([new Uint8Array(${JSON.stringify([...fixture])})],{type:'image/png'});`);
  const at300=await app.run('pngWithDpi(sourcePng,300)');
  const b300=Buffer.from(await at300.arrayBuffer());
  const encoded=chunks(b300), density=encoded.find(c=>c.type==='pHYs');
  assert.equal(encoded.filter(c=>c.type==='pHYs').length,1);
  assert.equal(density.data.readUInt32BE(0),11811);
  assert.equal(density.data.readUInt32BE(4),11811);
  assert.equal(density.data[8],1);
  assert.equal(crc32(density.raw.subarray(4,-4)),density.crc);
  assert.ok(encoded.findIndex(c=>c.type==='pHYs')<encoded.findIndex(c=>c.type==='IDAT'));
  assert.deepEqual(encoded.filter(c=>c.type!=='pHYs').map(c=>c.raw),chunks(fixture).map(c=>c.raw));
  app.run(`globalThis.png300=new Blob([new Uint8Array(${JSON.stringify([...b300])})]);`);
  const at384=await app.run('pngWithDpi(png300,384)');
  const updated=chunks(Buffer.from(await at384.arrayBuffer()));
  assert.equal(updated.filter(c=>c.type==='pHYs').length,1);
  assert.equal(updated.find(c=>c.type==='pHYs').data.readUInt32BE(0),15118);
  assert.deepEqual(updated.filter(c=>c.type!=='pHYs').map(c=>c.raw),chunks(fixture).map(c=>c.raw));
});

test('invalid encoded PNGs are rejected instead of producing corrupt downloads', async () => {
  const app=createApp();
  await assert.rejects(app.run(`pngWithDpi(new Blob(['invalid']),300)`));
  await assert.rejects(app.run(`pngWithDpi(new Blob([new Uint8Array(${JSON.stringify([...fixture.subarray(0,40)])})]),300)`));
});

test('encoding failure retries at lower resolution and releases every render buffer', async () => {
  const app=createApp();setDrawing(app,4500,500);
  const create=app.document.createElement, attempts=[];
  app.document.createElement=tag=>{
    const c=create(tag);
    if(tag==='canvas'){
      const encode=c.toBlob.bind(c);
      c.toBlob=callback=>{attempts.push([c.width,c.height]);if(attempts.length===1)callback(null);else encode(callback);};
    }
    return c;
  };
  await app.run('exportPNG()');
  assert.equal(attempts.length,2);
  assert.ok(Math.abs(attempts[0][0]/2-attempts[1][0])<1);
  assert.ok(Math.abs(attempts[0][1]/2-attempts[1][1])<1);
  assert.equal(app.elements.get('toast').textContent,'PNG downloaded');
  assert.ok(app.canvases.slice(-2).every(c=>c.width===1&&c.height===1));
  assert.equal(app.elements.get('exportBtn').disabled,false);
});

test('pending exports reject duplicate requests and keep the clicked drawing on retry', async () => {
  const app=createApp();setDrawing(app,4500,500);
  app.run(`globalThis.exportFrames=[];globalThis.paintForTest=paintBoard;
    paintBoard=function(c,W,H,view,bg,objects,id){exportFrames.push({bg,color:objects[0]?.color});return paintForTest(c,W,H,view,bg,objects,id);};`);
  const create=app.document.createElement;
  let pending, count=0;
  app.document.createElement=tag=>{
    const c=create(tag);
    if(tag==='canvas'){
      const encode=c.toBlob.bind(c);
      c.toBlob=callback=>{if(++count===1)pending=callback;else encode(callback);};
    }
    return c;
  };
  const first=app.run('exportPNG()');
  assert.equal(app.elements.get('exportBtn').disabled,true);
  await app.run('exportPNG()');
  assert.equal(count,1);
  app.run(`page().objects[0].color='#FFFFFF';page().bg='blank';`);
  pending(null);
  await first;
  assert.deepEqual(app.json('exportFrames'),[{bg:'grid',color:'#23282F'},{bg:'grid',color:'#23282F'}]);
  assert.equal(app.elements.get('exportBtn').disabled,false);
  assert.equal(app.elements.get('exportBtn').getAttribute('aria-busy'),'false');
});

test('permanent encoding failure stops after three attempts and restores the export button', async () => {
  const app=createApp();setDrawing(app,2000,1000);
  const create=app.document.createElement;
  let count=0;
  app.document.createElement=tag=>{const c=create(tag);if(tag==='canvas')c.toBlob=callback=>{count++;callback(null);};return c;};
  await app.run('exportPNG()');
  assert.equal(count,3);
  assert.match(app.elements.get('toast').textContent,/Could not export PNG/);
  assert.equal(app.elements.get('exportBtn').disabled,false);
  assert.equal(app.run('pngExportBusy'),false);
});
