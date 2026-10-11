const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers.cjs');

function region(app, rows, x, y) {
  const colours = {'.':[252,250,243,255], '#':[0,0,0,255], '~':[240,238,231,255]};
  const data = rows.flatMap(row=>[...row].flatMap(ch=>colours[ch]));
  app.run(`testFill = floodRegion(new Uint8ClampedArray(${JSON.stringify(data)}),${rows[0].length},${rows.length},${x},${y});`);
  return app.json('({count:testFill.count,minX:testFill.minX,minY:testFill.minY,maxX:testFill.maxX,maxY:testFill.maxY,mask:Array.from(testFill.mask)})');
}

test('bucket fills a connected enclosed region without crossing its outline', () => {
  const app = createApp();app.run('var testFill;');
  const result = region(app,['.....','.###.','.#.#.','.###.','.....'],2,2);
  assert.equal(result.count,1);
  assert.equal(result.mask[12],1);
  assert.deepEqual([result.minX,result.minY,result.maxX,result.maxY],[2,2,2,2]);
  const outside = region(app,['.....','.###.','.#.#.','.###.','.....'],0,0);
  assert.equal(outside.count,16);
  assert.equal(outside.mask[12],0);
});

test('bucket respects disconnected regions, gaps and antialiased colours', () => {
  const app = createApp();app.run('var testFill;');
  assert.equal(region(app,['..#..','..#..'],0,0).count,4);
  assert.equal(region(app,['..#..','.....'],0,0).count,9);
  assert.equal(region(app,['.~#..'],0,0).count,2);
  const boundaries = region(app,['..#..'],999,-999);
  assert.equal(boundaries.count,2);
  assert.throws(()=>app.run('floodRegion(new Uint8ClampedArray(4),2048,2048,0,0);'));
});

test('drawing opacity survives backup, while invalid values cannot replace the notebook', () => {
  const app = createApp();
  app.run(`page().objects.push({id:'stroke',type:'stroke',mode:'pen',width:12,color:'#D93A3A',opacity:0.35,points:[{x:100,y:100,w:1}]});restoreBoard(serializeBoard());`);
  assert.equal(app.run('page().objects[0].opacity'),0.35);
  for(const value of [-1,0,1.1,NaN]) {
    assert.throws(()=>app.run(`{const invalid = serializeBoard();invalid.pages[0].objects[0].opacity=${value};restoreBoard(invalid);}`));
    assert.equal(app.run('page().objects[0].opacity'),0.35);
  }
});
