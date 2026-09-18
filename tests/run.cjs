'use strict';
for(const file of ['math','state','geometry','engine','design','tune','checks'])require('../js/'+file+'.js');
const results=Optics.Checks.run();
for(const r of results)console.log(`${r.pass?'PASS':'FAIL'} ${r.name}\n  ${r.detail}`);
const fs=require('node:fs');fs.writeFileSync('tests/results.json',JSON.stringify({runtime:process.version,at:new Date().toISOString(),results},null,2));
const failures=results.filter(r=>!r.pass);console.log(`\n${results.length-failures.length}/${results.length} passed.`);if(failures.length)process.exitCode=1;
