const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./helpers.cjs');

test('mouse hover opens shapes without stealing focus and permits crossing into the drawer', () => {
  const app = createApp({hasHover:true});
  const trigger = app.elements.get('shapesBtn'), drawer = app.elements.get('shapeDrawer');
  const editor = app.elements.get('textEditor');
  editor.focus();
  trigger.dispatch('pointerenter',{pointerType:'mouse',buttons:0});
  assert.equal(drawer.hidden,false);
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  assert.equal(app.document.activeElement,editor);
  trigger.dispatch('pointerleave',{relatedTarget:app.document.body});
  assert.equal(drawer.hidden,false);
  drawer.dispatch('pointerenter',{pointerType:'mouse'});
  app.flushTimers();
  assert.equal(drawer.hidden,false);
  drawer.dispatch('pointerleave',{relatedTarget:app.document.body});
  app.flushTimers();
  assert.equal(drawer.hidden,true);
  assert.equal(trigger.getAttribute('aria-expanded'),'false');
});

test('touch, pen, pressed mouse and active drawing do not open the hover drawer', () => {
  const app = createApp();
  const trigger = app.elements.get('shapesBtn'), drawer = app.elements.get('shapeDrawer');
  for (const event of [{pointerType:'touch'},{pointerType:'pen'},{pointerType:'mouse',buttons:1}]) {
    trigger.dispatch('pointerenter',event);
    assert.equal(drawer.hidden,true);
  }
  app.run(`action={type:'draw'};`);
  trigger.dispatch('pointerenter',{pointerType:'mouse',buttons:0});
  assert.equal(drawer.hidden,true);
  app.run(`action=null;activePtrs.set(1,{x:10,y:10,type:'touch'});`);
  trigger.dispatch('pointerenter',{pointerType:'mouse',buttons:0});
  assert.equal(drawer.hidden,true);
  app.run('activePtrs.clear();');
  trigger.click();
  assert.equal(drawer.hidden,false);
  trigger.click();
  assert.equal(drawer.hidden,true);
});

test('hover drawer anchors beside the final toolbox position during its reveal animation', () => {
  const app = createApp({hasHover:true});
  const rail = app.elements.get('toolrail'), drawer = app.elements.get('shapeDrawer');
  rail.offsetLeft = 14;
  rail.offsetWidth = 90;
  rail.getBoundingClientRect = () => ({left:-120,right:-30,top:100,bottom:600,width:90,height:500});
  drawer.getBoundingClientRect = () => ({left:0,right:260,top:0,bottom:470,width:260,height:470});
  app.elements.get('shapesBtn').dispatch('pointerenter',{pointerType:'mouse'});
  assert.equal(drawer.style.left,'116px');
});

test('clicking after hovering keeps shapes open and selecting a shape closes the drawer', () => {
  const app = createApp();
  const trigger = app.elements.get('shapesBtn'), drawer = app.elements.get('shapeDrawer');
  drawer.appendChild(app.elements.get('shapeGrid'));
  trigger.dispatch('pointerenter',{pointerType:'mouse'});
  trigger.click();
  trigger.dispatch('pointerleave',{relatedTarget:app.document.body});
  app.flushTimers();
  assert.equal(drawer.hidden,false);
  const star = app.elements.get('shapeGrid').children.find(b=>b.dataset.tool==='star');
  star.click();
  assert.equal(drawer.hidden,true);
  assert.equal(app.run('state.tool'),'star');
  assert.equal(app.document.activeElement.id,'shapesBtn');
});

test('keyboard focus inside a hovered drawer preserves it until focus and pointer leave', () => {
  const app = createApp();
  const trigger = app.elements.get('shapesBtn'), drawer = app.elements.get('shapeDrawer');
  const first = app.elements.get('shapeGrid').children[0];
  // The fake DOM exposes ID elements separately; nest the grid as it is in HTML.
  drawer.appendChild(app.elements.get('shapeGrid'));
  trigger.dispatch('pointerenter',{pointerType:'mouse'});
  trigger.dispatch('pointerleave',{relatedTarget:app.document.body});
  first.focus();
  app.flushTimers();
  assert.equal(drawer.hidden,false);
  drawer.dispatch('pointerenter',{pointerType:'mouse'});
  app.document.body.focus();
  drawer.dispatch('focusout',{relatedTarget:app.document.body});
  app.flushTimers();
  assert.equal(drawer.hidden,false);
  drawer.dispatch('pointerleave',{relatedTarget:app.document.body});
  app.flushTimers();
  assert.equal(drawer.hidden,true);
});

test('Escape, outside clicks and opening another popup cancel pending hover closes', () => {
  const app = createApp();
  const trigger = app.elements.get('shapesBtn'), drawer = app.elements.get('shapeDrawer');
  trigger.dispatch('pointerenter',{pointerType:'mouse'});
  trigger.dispatch('pointerleave',{relatedTarget:app.document.body});
  app.fire('keydown',{key:'Escape'});
  assert.equal(drawer.hidden,true);
  trigger.click();
  app.flushTimers();
  assert.equal(drawer.hidden,false);
  for (const handler of app.documentHandlers.pointerdown) handler({target:app.document.body});
  assert.equal(drawer.hidden,true);
  trigger.dispatch('pointerenter',{pointerType:'mouse'});
  trigger.dispatch('pointerleave',{relatedTarget:app.document.body});
  app.elements.get('paletteBtn').click();
  assert.equal(drawer.hidden,true);
  app.flushTimers();
  assert.equal(app.elements.get('colorPalette').hidden,false);
});
