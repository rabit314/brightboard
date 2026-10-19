// Optional real-browser checks: node tests/mobile-browser.cjs (Chrome, or CHROME_BIN).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'mobile-review');
fs.mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = http.createServer((req, res) => {
  const file = { '/': 'index.html', '/js/app.js': 'js/app.js', '/css/style.css': 'css/style.css' }[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(path.join(root, file)));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = spawn(process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(output, 'profile-' + Date.now())}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let launchError, ws, send;
  chrome.on('error', error => { launchError = error; });
  try {
    const profile = chrome.spawnargs.find(arg => arg.startsWith('--user-data-dir=')).slice(16);
    let port;
    for (let i = 0; i < 60; i++) {
      if (launchError) throw launchError;
      try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); break; } catch {}
      await pause(100);
    }
    assert.ok(port, 'Chrome started');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    const pending = new Map(), errors = []; let nextId = 0;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id); pending.delete(message.id);
        message.error ? request.reject(message.error) : request.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    });
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const run = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const frame = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 1]) => ({ x, y, id, radiusX: 3, radiusY: 3 })) });
    const tap = async selector => {
      const scrolled = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();if(el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;el.scrollIntoView({behavior:'instant',block:'nearest',inline:'nearest'});return true;})()`);
      if (scrolled) await pause(1200); // Wait for the scroll gesture to settle before tapping.
      await frame();
      const point = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
      assert.ok(point.hit, `${selector} is reachable at ${JSON.stringify(point)} in ${await run('innerWidth+"x"+innerHeight')}`);
      await touch('touchStart', [[point.x, point.y]]); await pause(80); await touch('touchEnd', []);
      await pause(250);
      await frame();
    };
    const drag = async (x, y, endX, endY) => {
      await touch('touchStart', [[x, y]]);
      for (let i = 1; i <= 10; i++) await touch('touchMove', [[x + (endX - x) * i / 10, y + (endY - y) * i / 10]]);
      await touch('touchEnd', []); await frame();
      await pause(1200); // Let Chrome finish the touch gesture before tapping controls.
    };
    const screenshot = async name => fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const until = async (condition, message) => {
      for (let i = 0; i < 80; i++) { if (await condition()) return; await pause(100); }
      assert.fail(message);
    };
    const upload = async (selector, file) => {
      const { root: doc } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: doc.nodeId, selector });
      await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    };
    const downloads = path.join(output, 'downloads-' + Date.now());
    fs.mkdirSync(downloads);
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const layout = async (width, height, mobile = true) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      await pause(250);
      await frame();
    };
    await send('Runtime.enable');
    await layout(390, 844);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 80; i++) { if (await run('typeof APP_VERSION!=="undefined" && !!$("mobileOptionsBtn").onclick')) break; await pause(100); }
    await run('localStorage.clear(); hideHint();');
    await frame();

    // Portrait phones, landscape phones, and tablets retain an unobstructed canvas.
    const viewports = process.argv.includes('--quick') ? [[390,844]] : [[320,568], [360,640], [390,844], [430,932], [844,390], [768,1024], [1024,768], [1366,1024]];
    for (const [width, height] of viewports) {
      await layout(width, height);
      const geometry = await run(`(()=>{const rect=id=>{const r=$(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,bar:rect('topbar'),rail:rect('toolrail'),pages:rect('pagestrip'),area:boardArea(),hidden:document.body.classList.contains('auto-hide-panels')};})()`);
      assert.equal(geometry.width, width);
      assert.equal(geometry.overflow, false);
      assert.equal(geometry.hidden, false);
      for (const rect of [geometry.bar, geometry.rail, geometry.pages]) {
        assert.ok(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= height, JSON.stringify(geometry));
      }
      assert.ok(geometry.bar.bottom < geometry.pages.top - 60, JSON.stringify(geometry));
      assert.ok(geometry.pages.bottom <= geometry.rail.top || geometry.pages.left >= geometry.rail.right, JSON.stringify(geometry));
      await screenshot(`${width}x${height}`);
      await tap('#mobileOptionsBtn');
      for (const selector of ['#bgSeg [data-bg="dots"]', '#zoomIn', '#zoomOut', '#fitBtn']) await tap(selector);
      await tap('#backupBtn');
      assert.equal(await run('$("backupModal").classList.contains("show")'), true);
      await tap('#backupCloseBtn');
      await tap('#mobileOptionsBtn');
      await tap('#helpBtn');
      assert.equal(await run('$("helpPanel").classList.contains("show")'), true);
      await run('toggleHelp(false)');
      await tap('#mobileOptionsBtn');
    }

    await layout(390,844);
    await tap('#toolrail [data-tool="pen"]');
    await drag(120,250,290,330);
    assert.equal(await run('page().objects.length'),1);
    assert.equal(await run('page().objects[0].type'),'stroke');
    await tap('#undoBtn');
    assert.equal(await run('page().objects.length'),0);
    await tap('#redoBtn'); assert.equal(await run('page().objects.length'),1);
    await tap('#paletteBtn');
    await tap('#colorGrid [data-col="#3B82F6"]');
    assert.equal(await run('state.color'),'#3B82F6');

    // Scroll the shape drawer to its last row and draw the selected shape.
    await tap('#shapesBtn');
    await screenshot('shape-drawer');
    await tap('#shapeDrawer [data-tool="arc"]');
    assert.equal(await run('state.tool'),'arc');
    await drag(140,370,280,450);
    await tap('#toolrail [data-tool="select"]');
    assert.equal(await run('state.tool'),'select');
    await drag(210,370,230,390);
    assert.ok(await run('state.selectedIds.size>0'));
    await tap('#selDup');
    await tap('#selLock'); assert.equal(await run('getSelectedObjects()[0].locked'),true);
    await tap('#selLock'); assert.equal(await run('getSelectedObjects()[0].locked'),false);
    await tap('#selDel');

    // Two fingers navigate without leaving the first finger's pen mark behind.
    await tap('#toolrail [data-tool="pen"]');
    const count = await run('page().objects.length');
    await touch('touchStart', [[130,300]]);
    await touch('touchStart', [[130,300],[240,400,2]]);
    await touch('touchMove', [[110,280],[280,440,2]]);
    await touch('touchEnd', []);
    await pause(1200);
    assert.equal(await run('page().objects.length'),count);
    assert.ok(await run('page().view.zoom>1'));
    assert.equal(await run('activePtrs.size'),0);
    assert.equal(await run('action'),null);

    // Text stays accessible at the edge of the screen and after a keyboard resize.
    await tap('#toolrail [data-tool="text"]');
    assert.equal(await run('state.tool'),'text');
    await touch('touchStart', [[370,630]]); await touch('touchEnd', []); await frame();
    assert.equal(await run('document.activeElement.id'),'textEditor');
    await send('Input.insertText', { text: 'Mobile text\nSecond line' });
    await layout(390,380); // Chrome's resizes-content keyboard viewport.
    const editor = await run(`(()=>{const r=$('textEditor').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width};})()`);
    assert.ok(editor.left>=0 && editor.right<=390 && editor.top>=60 && editor.bottom<=380,JSON.stringify(editor));
    assert.ok(editor.width>=200,'Text near the edge has enough room to edit');
    assert.ok(editor.bottom-editor.top>=80,'Both text lines fit above the keyboard');
    await screenshot('keyboard-viewport');
    await tap('#editorDone');
    assert.equal(await run('editing'),null);
    assert.equal(await run('page().objects.at(-1).lines[0]'),'Mobile text');
    await layout(390,844);
    await tap('#toolrail [data-tool="sticky"]');
    await touch('touchStart', [[190,460]]); await touch('touchEnd', []);
    await send('Input.insertText', { text: 'Touch note' });
    await tap('#editorDone');
    assert.equal(await run('page().objects.at(-1).text'),'Touch note');
    await tap('#addPage'); assert.equal(await run('pages.length'),2);
    await tap('.pthumb'); assert.equal(await run('state.pageIndex'),0);
    assert.equal(await run('pages.length'),2,'Switching a page must not hit its delete button');
    const saveError = await run('(()=>{try{validateNotebook(serializeBoard());return null;}catch(e){return e.message;}})()');
    assert.equal(saveError, null);
    assert.equal(await run('saveNow()'), true);
    assert.equal(await run('JSON.parse(localStorage.getItem(SAVE_KEY)).pages.length'),2);
    await screenshot('drawing');

    // The mobile image picker, PNG download and JSON round trip use real files.
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await tap('#insertImgBtn');
    const priorImages = await run('page().objects.filter(o=>o.type==="image").length');
    await upload('#imageInput', path.join(output, '390x844.png'));
    await until(async () => await run('page().objects.filter(o=>o.type==="image").length') === priorImages + 1, 'Mobile image import finished');
    await tap('#mobileOptionsBtn');
    await tap('#fitBtn');
    await tap('#exportBtn');
    await until(() => fs.readdirSync(downloads).some(name => name.endsWith('.png')), 'PNG downloaded');
    const png = fs.readFileSync(path.join(downloads, fs.readdirSync(downloads).find(name => name.endsWith('.png'))));
    assert.ok(png.readUInt32BE(16) > 300 && png.readUInt32BE(20) > 300);
    await tap('#backupBtn');
    await tap('#downloadBackupBtn');
    await until(() => fs.readdirSync(downloads).some(name => name.endsWith('.json')), 'JSON downloaded');
    const backupPath = path.join(downloads, fs.readdirSync(downloads).find(name => name.endsWith('.json')));
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    assert.equal(backup.pages.length, 2);
    await run('clearCurrentPage();');
    await tap('#mobileOptionsBtn');
    await tap('#backupBtn');
    await tap('#uploadBackupBtn');
    await upload('#backupInput', backupPath);
    await until(async () => await run('$("toast").textContent') === 'Notebook restored from JSON', 'JSON restored');
    assert.equal(await run('page().objects.length'), backup.pages[0].objects.length);

    // Desktop retains its full toolbar and hover panels.
    await layout(1440,900,false);
    assert.equal(await run('getComputedStyle($("boardOptions")).display'),'contents');
    assert.equal(await run('getComputedStyle($("mobileOptionsBtn")).display'),'none');
    await run('setTool("pen");');
    await screenshot('desktop');
    assert.deepEqual(errors,[]);
    console.log(`Mobile browser checks passed: ${viewports.length} touch viewports, drawing, menus, selection, pinch, keyboard layout, pages, autosave, image import, PNG/JSON downloads, JSON restore, desktop.`);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} ws.close(); }
    chrome.kill(); server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
