import { writeFile } from 'node:fs/promises';
const tabs = await (await fetch('http://127.0.0.1:9338/json/list')).json();
const tab = tabs.find(t => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open',r,{once:true}));
let id=0; const pending=new Map(); const errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evalJs=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
await send('Network.enable'); ws.addEventListener('message', e => { const m=JSON.parse(e.data); if(m.method==='Network.responseReceived' && (m.params.response.status>=400 || m.params.type==='Image')) console.log(m.params.response.status,m.params.response.url); }); await send('Runtime.enable');await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:2560,height:1320,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://127.0.0.1:5180/vaal-street/'});
await new Promise(r=>setTimeout(r,2500));
for(const game of ['poe2']){
 await evalJs(`localStorage.setItem('vaal-street.shared.active-game.v1',JSON.stringify('${game}'));location.reload()`);
 await new Promise(r=>setTimeout(r,2500));
 await evalJs('document.fonts.ready');
 await evalJs("document.querySelector('.app-sidebar-toggle[aria-expanded=true]')?.click()");

 await evalJs("[...document.querySelectorAll('.app-tabs > button')].find(b=>b.textContent.includes('Boss profit'))?.click()");
 await new Promise(r=>setTimeout(r,500));
 const shot=await send('Page.captureScreenshot',{format:'png'});
 await writeFile(new URL(`./softened-boss-${game}-desktop.png`,import.meta.url),Buffer.from(shot.data,'base64'));
 console.log(game,await evalJs(`JSON.stringify({title:document.querySelector('.app-brand-subtitle')?.textContent,art:getComputedStyle(document.querySelector('.app-header')).backgroundImage,overflow:document.documentElement.scrollWidth>innerWidth})`));
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await new Promise(r=>setTimeout(r,400));
 const mobile=await send('Page.captureScreenshot',{format:'png'});
 await writeFile(new URL(`./softened-boss-${game}-mobile.png`,import.meta.url),Buffer.from(mobile.data,'base64'));
 console.log(game,'mobile overflow',await evalJs('document.documentElement.scrollWidth>innerWidth'));
 await send('Emulation.setDeviceMetricsOverride',{width:2560,height:1320,deviceScaleFactor:1,mobile:false});
}
console.log('Runtime errors',errors);if(errors.length)process.exitCode=1;ws.close();