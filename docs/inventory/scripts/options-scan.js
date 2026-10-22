// Usage (repo root): node tests/gate.js --full --list > /tmp/gate.txt; node docs/inventory/scripts/options-scan.js /tmp/gate.txt /tmp/reads.json
// Per DV_DEF option: reader files/lines (js/) and test files that set it. See docs/inventory/OPTIONS.md 'Method'.
const fs=require('fs'),path=require('path');
const DV=eval('('+fs.readFileSync('js/spec-ui.js','utf8').split('\n')[839].match(/const DV_DEF = (\{.*\});/)[1]+')');
const dvKeys=Object.keys(DV);const GENERIC=new Set(['scene','seed','speed','res','tex','mt','wild','density','fov','ev','smooth','samples','playing','wet','view','glare','cline','scatter','ambient','tiles']);
const extra=['airLevel','haloQuality','wetness','deerBehaviour','ownLow','ownHigh','scatterTableSteps','view','pedStop','lampRule'];
const keys=dvKeys.concat(extra);
const readFiles=fs.readdirSync('js').filter(f=>/^(drive|spec-ui|ui|scene-details|lamp-dist|beams|beam-atlas|table-pace)/.test(f)&&f.endsWith('.js')).map(f=>'js/'+f);
const PRE='(?:\\bo|\\.o|\\bI\\.o|dvOpts\\([a-z]+\\)|\\bopts|\\blook|\\bp|\\bsrc|\\bui\\.dvOpts|\\bflags|\\bcfg|\\bopt|\\bV\\.p|\\bV\\.info\\.o|\\bgameOptions)';
const SKIP=['tests/fixtures','tests/bench','tests/tools','drive-controls-fixtures','touge-r2-fixtures','touge-proto-runner'];
function walk(d,o=[]){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(SKIP.some(s=>p.includes(s)))continue;const s=fs.statSync(p);if(s.isDirectory())walk(p,o);else if(/\.js$/.test(f))o.push(p)}return o}
const tf=walk('tests');const cache={};const rd=f=>cache[f]||(cache[f]=fs.readFileSync(f,'utf8').split('\n'));
const gate=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean);
const gateFiles=new Set(gate.map(n=>n.startsWith('node:')?'tests/'+n.slice(5)+'.js':'tests/regress/'+n+'.js'));
const out={};
for(const k of keys){
 const rRead=new RegExp(PRE+'\\.'+k+'\\b|(?:^|[{,\\s])'+k+'\\s*:\\s*(?:o|I\\.o|opts)\\.|\\[\\s*[\'"]'+k+'[\'"]');
 const rLit=new RegExp('(?:^|[{,(\\s])'+k+'\\s*:');
 const reads={};
 for(const f of readFiles){const L=rd(f);let n=0,first=[];L.forEach((l,i)=>{if(rRead.test(l)){n++;if(first.length<4)first.push(i+1)}});if(n)reads[f]={n,first}}
 const kebab=k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());const rSet=new RegExp("data-anim=?[\"']?"+kebab+"\\b|setDV\\([^)]*['\"]"+k+"['\"]|setOwn\\(['\"]"+k+"['\"]|data-(?:dv|anim)=?[\"']?"+k+"\\b|\\(\\s*(?:[\\w.]+,\\s*)?['\"]"+k+"['\"]\\s*,|dvOpts(?:\\([a-z]+\\))?\\."+k+"\\s*=[^=]|\\b"+k+"\\s*:\\s*[^,}]");
 const tests={},asserts={};
 for(const f of tf){const L=rd(f);let n=0,first=0;L.forEach((l,i)=>{if(!rSet.test(l))return; if(GENERIC.has(k)&&!/dvOpts|setDV|setOwn|setOpt|setOption|data-dv|data-anim|\.o\.|opts\(/i.test(l))return;const cnt=dvKeys.filter(x=>new RegExp('\\b'+x+'\\s*:').test(l)).length;if(cnt>=5)return; n++;if(!first)first=i+1});if(n)tests[f]={n,first,gate:gateFiles.has(f)}}
 const rA=new RegExp('\\.'+k+'\\b');for(const f of tf){const L=rd(f);let n=0;L.forEach(l=>{if(rA.test(l))n++});if(n&&!tests[f])asserts[f]={n,gate:gateFiles.has(f)}}
 out[k]={def:DV[k],reads,tests,asserts};
}
fs.writeFileSync(process.argv[3],JSON.stringify(out));
const nt=Object.keys(out).filter(k=>!Object.keys(out[k].tests).length);const na=Object.keys(out).filter(k=>!Object.keys(out[k].tests).length);console.log('no SET-test, but asserted:',na.filter(k=>Object.keys(out[k].asserts).length).join(' '));console.log('no test any:',nt.join(' '));
const ng=Object.keys(out).filter(k=>Object.keys(out[k].tests).length&&!Object.values(out[k].tests).some(t=>t.gate));console.log('tests but none in gate:',ng.join(' '));
console.log(tf.length,'test js scanned; gate files',[...gateFiles].filter(f=>fs.existsSync(f)).length,'/',gateFiles.size);
