const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createApp(options = {}) {
  const elements = new Map(), timers = new Map(), images = [], readers = [], canvases = [];
  const windowHandlers = {}, documentHandlers = {}, storageWrites = [];
  let clock = options.now ?? 1000, timerId = 0;
  const storage = new Map(Object.entries(options.storage || {}));
  const context = {
    font: '10px sans-serif', operations: [], stack: [],
    save() { this.stack.push({font:this.font}); },
    restore() { Object.assign(this, this.stack.pop() || {}); },
    measureText(value) { return {width:String(value).length * (parseFloat(this.font.match(/([\d.]+)px/)?.[1]) || 10) * 0.6}; }
  };
  for (const name of ['beginPath','closePath','moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','arcTo','ellipse','rect','fill','stroke','fillRect','strokeRect','clearRect','fillText','drawImage','clip','translate','rotate','scale','setTransform','setLineDash']) {
    context[name] = function (...args) { this.operations.push({name,args}); };
  }
  function makeElement(tagName = 'div', id = '') {
    const handlers = {}, attrs = {}, classes = new Set();
    const element = {
      id, tagName:tagName.toUpperCase(), dataset:{}, children:[], parentElement:null,
      style:{setProperty(name,value){this[name]=value;}}, value:'', textContent:'', disabled:false, hidden:false, inert:false,
      classList:{add(...values){values.forEach(v=>classes.add(v));},remove(...values){values.forEach(v=>classes.delete(v));},contains(v){return classes.has(v);},toggle(v,on){if(on===undefined)on=!classes.has(v);on?classes.add(v):classes.delete(v);return on;}},
      get className(){return [...classes].join(' ');},set className(v){classes.clear();String(v).split(/\s+/).filter(Boolean).forEach(c=>classes.add(c));},
      get innerHTML(){return this._html || '';},set innerHTML(v){this._html=v;this.children=[];},
      addEventListener(name,callback){(handlers[name] ||= []).push(callback);},
      removeEventListener(name,callback){handlers[name]=(handlers[name]||[]).filter(c=>c!==callback);},
      dispatch(name,event={}) { event.target ||= this; event.preventDefault ||= function(){this.defaultPrevented=true;};event.stopPropagation ||= function(){this.propagationStopped=true;}; for(const cb of handlers[name]||[])cb(event); return event; },
      appendChild(child){child.parentElement=this;this.children.push(child);return child;},
      remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);},
      setAttribute(name,value){attrs[name]=String(value);if(name==='id'){this.id=value;elements.set(value,this);}if(name==='tabindex')this.tabIndex=Number(value);},
      getAttribute(name){return attrs[name] ?? null;},removeAttribute(name){delete attrs[name];},
      contains(child){return this===child || this.children.some(c=>c.contains(child));},
      focus(){document.activeElement=this;},blur(){document.activeElement=document.body;this.dispatch('blur');},
      click(){this.onclick?.({target:this,preventDefault(){},stopPropagation(){}});this.dispatch('click');},
      setSelectionRange(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture(){return true;},
      getContext(){return context;},toDataURL(){return 'data:image/png;base64,aGVsbG8=';},
      toBlob(callback){callback(new Blob(['png']));},
      getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:1280,bottom:720,width:1280,height:720};},
      getClientRects(){return this.hidden||this.style.display==='none'?[]:[this.getBoundingClientRect()];},
      get isConnected(){return !!this.parentElement || this===document.body;},
      querySelectorAll(selector){return query(selector,this.children.flatMap(flatten));},querySelector(selector){return this.querySelectorAll(selector)[0] || null;},
      handlers
    };
    if(id)elements.set(id,element);if(tagName==='canvas')canvases.push(element);
    return element;
  }
  function flatten(e){return [e,...e.children.flatMap(flatten)];}
  function query(selector, candidates = [...elements.values()].flatMap(flatten)) {
    const unique = [...new Set(candidates)];
    if(selector.includes(','))return [...new Set(selector.split(',').flatMap(s=>query(s.trim(),unique)))];
    if(selector.startsWith('#') && selector.includes(' ')){
      const [id,...rest]=selector.split(/\s+/);const base=elements.get(id.slice(1));return base?query(rest.join(' '),base.children.flatMap(flatten)):[];
    }
    if(selector.startsWith('#'))return unique.filter(e=>e.id===selector.slice(1));
    const cls=selector.match(/\.([\w-]+)/)?.[1];
    if(cls)return unique.filter(e=>e.classList.contains(cls) && (!selector.includes(':not(.custom)')||!e.classList.contains('custom')) && (!selector.includes('[data-tool]')||e.dataset.tool));
    if(selector.includes('button')||selector.includes('[tabindex]'))return unique.filter(e=>!e.disabled&&(e.tagName==='BUTTON'||e.tagName==='INPUT'||e.tagName==='TEXTAREA'||e.tabIndex>=0));
    return unique.filter(e=>e.tagName===selector.toUpperCase());
  }
  const document={body:makeElement('body'),activeElement:null,visibilityState:'visible',
    getElementById(id){return elements.get(id) || makeElement('div',id);},createElement:makeElement,
    querySelectorAll:query,querySelector(selector){return query(selector)[0]||null;},
    addEventListener(name,cb){(documentHandlers[name] ||= []).push(cb);},fonts:{addEventListener(){}}
  };
  document.activeElement=document.body;
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const e=makeElement(match[1],match[3]);document.body.appendChild(e);
    for(const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){
      const [,,value]=attr; e.setAttribute(attr[1],value);
      if(attr[1]==='class')e.className=value;
      else if(['min','max','step','value','title'].includes(attr[1]))e[attr[1]]=value;
    }
  }
  for(const tool of ['select','pen','highlighter','eraser','line','rect','ellipse','arrow','text','sticky','laser','hand']){const e=makeElement('button');e.className='tbtn';e.dataset.tool=tool;document.getElementById('toolrail').appendChild(e);}
  for(const bg of ['blank','dots','grid','ruled']){const e=makeElement('button');e.dataset.bg=bg;document.getElementById('bgSeg').appendChild(e);}
  const window={innerWidth:1280,innerHeight:720,devicePixelRatio:1,addEventListener(name,cb){(windowHandlers[name] ||= []).push(cb);}};
  class FakeImage {
    constructor(){this.complete=false;this.naturalWidth=0;this.naturalHeight=0;images.push(this);}
    set src(value){this._src=value;this.complete=false;}get src(){return this._src;}
    load(w=100,h=100){this.complete=true;this.naturalWidth=w;this.naturalHeight=h;this.onload?.();}
    fail(){this.complete=true;this.onerror?.();}
  }
  class FakeFileReader {
    constructor(){readers.push(this);}
    readAsText(file){this.file=file;}readAsDataURL(file){this.file=file;}
    load(value){this.result=value;this.onload?.({target:this});}
  }
  const sandbox={document,window,Image:FakeImage,FileReader:FakeFileReader,Blob,console,
    performance:{now:()=>clock},setTimeout(cb,ms){const id=++timerId;timers.set(id,{cb,ms});return id;},clearTimeout(id){timers.delete(id);},
    setInterval(){return ++timerId;},clearInterval(){},requestAnimationFrame(){},cancelAnimationFrame(){},
    localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){if(options.failStorage?.())throw new Error('QuotaExceededError');storage.set(key,value);storageWrites.push({key,value});}},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},navigator:{},
  };
  window.document=document;
  const vmContext=vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js','app.js'),'utf8'),vmContext,{timeout:5000});
  return {
    run(code){return vm.runInContext(code,vmContext,{timeout:5000});},
    json(code){return JSON.parse(vm.runInContext(`JSON.stringify(${code})`,vmContext,{timeout:5000}));},
    fire(name,event={}){event.target ||= document.body;event.preventDefault ||= function(){this.defaultPrevented=true;};event.stopPropagation ||= function(){this.propagationStopped=true;};for(const cb of windowHandlers[name]||[])cb(event);return event;},
    setNow(value){clock=value;},flushTimers(){const queued=[...timers.values()];timers.clear();queued.forEach(t=>t.cb());},
    elements,document,window,windowHandlers,documentHandlers,images,readers,canvases,timers,storage,storageWrites,context,
  };
}
module.exports={createApp};
