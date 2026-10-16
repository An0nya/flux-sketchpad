// External tester: python3 tests/serve.py 8772; P1_REAL_GPU=1 node tests/regress/P1-drive-three.js 8772
const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright')),port=+(process.argv[2]||8772);
(async()=>{const browser=await pw.chromium.launch(process.env.P1_REAL_GPU?{channel:'chromium'}:{});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
 await page.evaluate(text=>RF.UI.loadScene(RF.State.deserialize(text),'P1 fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));
 await page.addScriptTag({url:'/tests/drive-three-page.js'});const result=await page.evaluate(p=>P1Page.run(p),port);for(const c of result.checks)console.log((c.pass?'[PASS] ':'[FAIL] ')+c.name+(c.detail?' — '+JSON.stringify(c.detail):''));console.log(JSON.stringify(result));console.log((errors.length?'[FAIL]':'[PASS]')+' P1 no page errors '+JSON.stringify(errors));process.exitCode=result.pass&&!errors.length?0:1;
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
