// External tester only: node tests/bench/TG-touge-proto.js 8792
const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||'/Users/anya/Projects/agent-qa/node_modules/playwright'),port=+(process.argv[2]||8792);
(async()=>{const browser=await pw.chromium.launch({channel:'chromium'});try{for(const phone of [false,true]){
 const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1600,height:900},deviceScaleFactor:phone?2:1}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://127.0.0.1:'+port+'/index.html');await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
 await page.evaluate(s=>RF.UI.loadScene(RF.State.deserialize(s),'TG fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));await page.addScriptTag({url:'/tests/drive-three-page.js'});await page.addScriptTag({url:'/tests/touge-page.js'});
 const result=await page.evaluate(args=>TGPage.bench(args),{phone,port});console.log(JSON.stringify({errors,...result}));if(errors.length||result.stats.renderer!=='three')process.exitCode=1;await page.screenshot({path:'/tmp/TG-bench-'+(phone?'phone':'desktop')+'.png'});await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
