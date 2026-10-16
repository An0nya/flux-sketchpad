// External tester only: python3 tests/serve.py 8792; node tests/regress/TG-touge-proto.js 8792
const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||'/Users/anya/Projects/agent-qa/node_modules/playwright'),port=+(process.argv[2]||8792);
(async()=>{const browser=await pw.chromium.launch({channel:'chromium'});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://127.0.0.1:'+port+'/index.html');await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
 await page.evaluate(s=>RF.UI.loadScene(RF.State.deserialize(s),'TG fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
 await page.addScriptTag({url:'/tests/drive-three-page.js'});await page.addScriptTag({url:'/tests/touge-page.js'});const result=await page.evaluate(p=>TGPage.run(p),port);
 for(const c of result.checks)console.log((c.pass?'[PASS] ':'[FAIL] ')+c.name+(c.detail?' '+JSON.stringify(c.detail):''));console.log((errors.length?'[FAIL] ':'[PASS] ')+'TG page errors '+JSON.stringify(errors));process.exitCode=result.pass&&!errors.length?0:1;
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
