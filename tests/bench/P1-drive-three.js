// External tester: P1_REAL_GPU=1 node tests/bench/P1-drive-three.js 8772
const fs=require('fs'),path=require('path'),pw=require(process.env.PLAYWRIGHT||(require('child_process').execSync('npm root -g').toString().trim()+'/playwright')),port=+(process.argv[2]||8772);
(async()=>{const browser=await pw.chromium.launch({channel:'chromium'});try{for(const phone of [false,true]){
 const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1600,height:900},deviceScaleFactor:phone?2:1}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>localStorage.clear());await page.goto('http://localhost:'+port+'/index.html');await page.waitForFunction(()=>window.RF&&RF.UI&&RF.UI.loadScene);
 await page.evaluate(text=>RF.UI.loadScene(RF.State.deserialize(text),'P1 fixture'),fs.readFileSync(path.join(__dirname,'../fixtures/MG2-default-lamp.json'),'utf8'));await page.addScriptTag({url:'/tests/drive-three-page.js'});
 const result=await page.evaluate(phone=>P1Page.bench({phone}),phone);console.log(JSON.stringify({errors,...result}));if(errors.length)process.exitCode=1;await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
