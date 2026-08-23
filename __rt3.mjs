import WebSocket from 'ws'
import { readdirSync } from 'node:fs'
const SC='/private/tmp/claude-501/-Users-shaswatamitra-Desktop-Files-Work-Projects-github-jojo/f34d0cf9-cc58-4b88-94a8-d8f177bf948d/scratchpad'
const c=await(await fetch('http://127.0.0.1:9891/json/new?about:blank',{method:'PUT'})).json()
const ws=new WebSocket(c.webSocketDebuggerUrl);let id=0;const pend=new Map();const errs=[]
ws.on('message',m=>{const d=JSON.parse(m)
 if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id)}
 if(d.method==='Runtime.exceptionThrown')errs.push(d.params.exceptionDetails.text)})
await new Promise(r=>ws.on('open',r))
const send=(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))})
const ev=async e=>(await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true})).result?.result?.value
await send('Page.enable');await send('Runtime.enable');await send('DOM.enable')
const go=async u=>{await send('Page.navigate',{url:u});await new Promise(r=>setTimeout(r,4500))}
const count=(db,store,pred)=>ev(`(async()=>{
 const d=await new Promise(r=>{const q=indexedDB.open('${db}');q.onsuccess=()=>r(q.result)});
 if(![...d.objectStoreNames].includes('${store}'))return 0;
 const k=await new Promise(r=>{const q=d.transaction('${store}').objectStore('${store}').getAllKeys();q.onsuccess=()=>r(q.result)});
 d.close(); return ${pred};})()`)
const nodes=()=>count('jojo','nodes','k.length')
const docs=()=>count('jojo-files','blobs',"k.filter(x=>String(x).startsWith('Documents/')).length")

await go('http://localhost:4200/settings')
console.log('  before wipe   nodes/docs:', await nodes(), '/', await docs())

// A true wipe: delete both databases outright, the way "clear browsing data" would.
await ev(`(async()=>{ for (const n of ['jojo','jojo-files']) {
  await new Promise(r=>{const q=indexedDB.deleteDatabase(n);q.onsuccess=()=>r();q.onerror=()=>r();q.onblocked=()=>r()})
} return true })()`)
await new Promise(r=>setTimeout(r,1500))
await go('http://localhost:4200/settings?wiped=1')
console.log('  AFTER WIPE    nodes/docs:', await nodes(), '/', await docs())

// Restore from the file alone.
const file = SC+'/dl/'+readdirSync(SC+'/dl').filter(f=>f.endsWith('.json'))[0]
const doc=await send('DOM.getDocument',{depth:-1})
const inp=await send('DOM.querySelector',{nodeId:doc.result.root.nodeId,selector:'input[accept*="json"]'})
await send('DOM.setFileInputFiles',{nodeId:inp.result.nodeId,files:[file]})
await new Promise(r=>setTimeout(r,2200))
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Replace everything/.test(b.textContent.trim()));if(b)b.click()})()`)
await new Promise(r=>setTimeout(r,6000))
console.log('  AFTER RESTORE nodes/docs:', await nodes(), '/', await docs())
console.log('  document bytes intact   :', await ev(`(async()=>{
 const d=await new Promise(r=>{const q=indexedDB.open('jojo-files');q.onsuccess=()=>r(q.result)});
 const all=await new Promise(r=>{const q=d.transaction('blobs').objectStore('blobs').getAll();q.onsuccess=()=>r(q.result)});
 const rec=all.find(x=>x&&x.data); return rec? new TextDecoder().decode(rec.data.slice(0,8))+' ('+rec.data.byteLength+' bytes)':'none'})()`))
console.log('  records visible in app  :', await ev(`document.body.innerText.length > 500`))
console.log('  errors:', errs.length?errs.slice(0,2).join(' | '):'none')
process.exit(0)
