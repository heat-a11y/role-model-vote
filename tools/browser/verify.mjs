import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { chromium } from 'playwright-core';
import { site, buildSite } from './site.mjs';

buildSite();
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((q,r)=>{const u=new URL(q.url,'http://x');const f=path.join(site,u.pathname==='/'?'index.html':u.pathname);
if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('x');}
r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const poll={title:'Vote for your favourite role model',subtitle:'Tap the person you look up to most.',active:true,
 options:[{id:'o1',text:'Mr Ali',votes:14},{id:'o2',text:'Ms Chen',votes:9},{id:'o3',text:'Coach Davies',votes:6},{id:'o4',text:'Mrs Okafor',votes:3}],
 classes:{'3A':{roster:30,votes:20},'3B':{roster:28,votes:8},'4C':{roster:26,votes:4}},totalVotes:32};
let bad=0;
const say=(ok,msg,extra)=>{ if(!ok){bad++;console.log('  BAD  '+msg+(extra?'  '+extra:''));} else console.log('  ok   '+msg); };

const p=await b.newPage({viewport:{width:1440,height:960}});
await p.goto(base+'/kiosk.html?poll=demo&class=3A',{waitUntil:'load'});
await p.waitForTimeout(1200);
await p.evaluate(async d=>{const t=window.__testApi;await t.setDoc(t.doc({},'polls','demo'),JSON.parse(JSON.stringify(d)));},poll);
await p.waitForTimeout(700);

const k=await p.evaluate(()=>{
  const body=getComputedStyle(document.body);
  const btns=[...document.querySelectorAll('[data-opt]')];
  const first=btns[0];
  const cs=first?getComputedStyle(first):null;
  const h1=document.querySelector('#hd-title');
  return {
    count:btns.length,
    bodyBg:body.backgroundColor, bodyColor:body.color, bodyFont:body.fontFamily,
    cssLoaded:[...document.styleSheets].some(s=>{try{return s.cssRules.length>50}catch(e){return false}}),
    btnRect:first?first.getBoundingClientRect().toJSON():null,
    btnRadius:cs?cs.borderRadius:null,
    btnBgImage:cs?cs.backgroundImage:null,
    btnColor:cs?cs.color:null,
    btnDisplay:cs?cs.display:null,
    gridCols:document.getElementById('options')?getComputedStyle(document.getElementById('options')).gridTemplateColumns:null,
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    titleFont:h1?getComputedStyle(h1).fontSize:null,
    pillBg:document.getElementById('net-pill')?getComputedStyle(document.getElementById('net-pill')).backgroundColor:null,
    heldVisible:(()=>{const e=document.getElementById('held-pill');if(!e)return 'missing';return getComputedStyle(e).display!=='none';})(),
    heldHiddenAttr:(()=>{const e=document.getElementById('held-pill');return e?e.hasAttribute('hidden'):'missing';})(),
    svgCount:document.querySelectorAll('svg').length,
    svgSizes:[...document.querySelectorAll('svg')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height);}),
    svgPaths:document.querySelectorAll('svg path').length,
    firstText:first?first.innerText.replace(/\n/g,' | '):null
  };
});
console.log('\nKiosk render checks');
say(k.cssLoaded,'stylesheet actually applied (compiled css parsed)');
say(k.count===4,'four candidate buttons rendered','saw '+k.count);
say(k.bodyBg==='rgb(2, 6, 23)','dark slate body background',k.bodyBg);
say(k.btnBgImage&&k.btnBgImage.includes('gradient'),'candidate cards have a gradient fill',(k.btnBgImage||'').slice(0,60));
say(k.btnRadius&&parseFloat(k.btnRadius)>=20,'candidate cards are big rounded touch targets',k.btnRadius);
say(k.btnRect&&k.btnRect.width>200&&k.btnRect.height>=140,'cards are large enough to tap',JSON.stringify(k.btnRect&&{w:Math.round(k.btnRect.width),h:Math.round(k.btnRect.height)}));
say(k.gridCols&&k.gridCols.split(' ').length===2,'two-column layout on a wide screen',k.gridCols);
say(!k.overflowX,'no horizontal overflow');
say(k.svgCount>=2,'inline svg icons rendered (no icon font, no CDN)',k.svgCount+' svgs, '+k.svgPaths+' paths');
say(k.svgSizes.every(x=>/^([1-9]\d*)x\1$/.test(x)),'every visible icon has real square dimensions',JSON.stringify(k.svgSizes));
say(k.pillBg&&k.pillBg!=='rgba(0, 0, 0, 0)','connection pill has a background',k.pillBg);
say(k.heldHiddenAttr===true&&k.heldVisible===false,'"0 waiting to sync" badge is not shown when nothing is held','attr='+k.heldHiddenAttr+' display-visible='+k.heldVisible);
say(/Mr Ali/.test(k.firstText||''),'candidate name visible on the card',k.firstText);

// second candidate must differ in colour from first (gradient cycling works)
const grads=await p.evaluate(()=>[...document.querySelectorAll('[data-opt]')].map(e=>getComputedStyle(e).backgroundImage.slice(0,90)));
say(new Set(grads).size===4,'each candidate gets a distinct gradient',new Set(grads).size+' distinct');

await p.close();

const d=await b.newPage({viewport:{width:1440,height:1100}});
await d.goto(base+'/dashboard.html?poll=demo',{waitUntil:'load'});
await d.waitForTimeout(1200);
await d.evaluate(async x=>{const t=window.__testApi;await t.setDoc(t.doc({},'polls','demo'),JSON.parse(JSON.stringify(x)));},poll);
await d.waitForTimeout(700);
const r=await d.evaluate(()=>{
  const bars=[...document.querySelectorAll('.bar-track > div')];
  const widths=bars.map(e=>getComputedStyle(e).transform);
  return {
    bars:bars.length,
    widths,
    total:(document.querySelector('#view').innerText.match(/Total votes\s*\n?\s*(\d+)/i)||[])[1],
    tiles:document.querySelectorAll('#view .stat-value').length,
    gateDisabled:document.getElementById('btn-gate').disabled,
    loginCard:!!document.querySelector('#admin-form'),
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth
  };
});
console.log('\nDashboard render checks');
say(r.bars>=4,'result bars rendered for each candidate','saw '+r.bars);
say(new Set(r.widths).size>=3,'bars have different lengths reflecting the vote split',JSON.stringify(r.widths));
say(r.tiles>=4,'statistic tiles rendered','saw '+r.tiles);
say(r.gateDisabled===true,'open-voting button locked for a guest (no master sign-in)');
say(r.loginCard===true,'master sign-in form is shown');
say(!r.overflowX,'no horizontal overflow');

await d.click('[data-tab="classes"]'); await d.waitForTimeout(400);
const c=await d.evaluate(()=>{const t=document.querySelector('#view').innerText;
  return {over:/over roll/i.test(t), rows:document.querySelectorAll('#view tbody tr').length};});
console.log('\nClasses tab');
say(c.rows>=3,'a row per class','saw '+c.rows);
say(c.over,'a class over its roll size is flagged');

await d.click('[data-tab="audit"]'); await d.waitForTimeout(500);
const a=await d.evaluate(()=>document.querySelector('#view').innerText);
console.log('\nVerification tab');
say(/Counter total/i.test(a),'shows counter vs signed records');
say(/disagree|differ/i.test(a),'flags the mismatch while records are missing (honest, not silently green)');

await d.click('#btn-announce'); await d.waitForTimeout(400);
const w=await d.evaluate(()=>document.querySelector('#view').innerText);
console.log('\nWinner view');
say(/Winner/i.test(w),'announcement view renders');
say(/Mr Ali/.test(w),'names the leader');
await d.close();

await b.close(); server.close();
console.log('\n'+(bad?bad+' problem(s)':'All render checks passed')+'\n');
process.exit(bad?1:0);
