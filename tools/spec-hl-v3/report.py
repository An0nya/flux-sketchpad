#!/usr/bin/env python3
"""Collect retained experiments into a local, standalone comparison gallery."""
import html,json,pathlib,shutil,statistics
ROOT=pathlib.Path(__file__).resolve().parents[2];B=ROOT/'bench-out/spec-hl-v3';D=ROOT/'docs/spec-hl-v3'
names={'filament7':'Filament · 7-inch round','filamentBox':'Filament · deep rectangular','ledUp':'Default LED · up-firing','led519a':'519A · up-firing','ledRear7':'LED · rear-firing 7-inch','osramSmall':'Osram · small envelope','projectorLong':'Filament · long projector'}
presets={'ece-r112-b':'ECE R112 B','fmvss-lb2v':'FMVSS LB2V'}
solvers=['spec-hl-v2','spec-hl-v3','sqm-hl','sqm-hl-dish','opus-mosaic-auto','dish-fit-auto']
def fmt(x):return f'{x:g}'
def pf(d):return '/'.join(str(d['n'][k])for k in ['pass','fail','unsure'])
def reach(d,far=True):return '/'.join(fmt(d['road'][k])for k in (['farRight','farLeft']if far else ['right','left']))
cases=[];index={}
for name in names:
 for preset in presets:
  choices=solvers if name!='projectorLong' else ['spec-hl-v2','projector-liou','liou-cleanup']
  for solver in choices:
   directory=B/f'{name}-{preset}-{solver}' if solver!='liou-cleanup' else B/'liou-cleanup'/f'{name}-{preset}-projector-liou'
   data=json.loads((directory/'result-8000000-1.json').read_text());assert data['harnessVersion']==2
   data['label']=solver;data['artifactDirectory']=str(directory.relative_to(ROOT))
   data.pop('roadSamples',None)
   solve=json.loads((directory/'solve.json').read_text());data['solveMs']=solve['solveMs'];data['notes']=solve['notes']
   repeat=directory/'result-8000000-71.json'
   if repeat.exists():
    r=json.loads(repeat.read_text());data['repeat']={k:r[k]for k in ['seed','n','shift','road','rows','shoulderFraction5lx']}
   cases.append(data);index[name,preset,solver]=data
   if solver=='spec-hl-v3' or name=='projectorLong':
    (D/'scenes').mkdir(exist_ok=True);shutil.copy(directory/'scene.json',D/'scenes'/f'{name}-{preset}-{solver}.json')
(D/'results.json').write_text(json.dumps(cases,indent=2))
lines=['# All measured cases','', '8 million rays, seed 1; 100-facet limit. P/F/U = pass / definite fail / uncertain. Reach is right/left in metres at the judged aim. Farthest reach can hide a nearer gap; continuous reach cannot. These are stock simulated judgments, not certified lamps.','', '| Scene | Preset | Solver | P/F/U | Farthest R/L | Continuous R/L | Window lm | Shoulder ≥5 lx | Solve s |','|---|---|---|---:|---:|---:|---:|---:|---:|']
for d in cases:
 lines.append(f"| {names[d['name']]} | {presets[d['preset']]} | {d['label']} | {pf(d)} | {reach(d)} | {reach(d,False)} | {d['lmWindow']:.0f} | {100*d['shoulderFraction5lx']:.0f}% | {d['solveMs']/1000:.1f} |")
lines+=['','Shoulder coverage samples both road edges every 2 m from 50–80 m (32 samples). It describes that interval only. Window lumens are light inside the preset’s measuring window, not total optical efficiency.','', '## Independent ray sample, same saved optics','', '| Scene | Preset | Solver | Seed 1 P/F/U | Seed 71 P/F/U | Seed 1 R/L | Seed 71 R/L |','|---|---|---|---:|---:|---:|---:|']
for d in cases:
 if 'repeat'in d:lines.append(f"| {names[d['name']]} | {presets[d['preset']]} | {d['label']} | {pf(d)} | {pf(d['repeat'])} | {reach(d)} | {reach(d['repeat'])} |")
lines+=['','## Definite failures, seed 1','']
for d in cases:
 fails=[r for r in d['rows']if r['verdict']=='fail']
 if fails:
  lines.append(f"- {names[d['name']]} / {presets[d['preset']]} / {d['label']}: "+'; '.join(f"{r['name']}: {r['value']:.4g} vs {'minimum'if r['isMin']else 'maximum'} {r['bound']:.4g}" for r in fails))
(D/'ALL-RESULTS.md').write_text('\n'.join(lines)+'\n')
table=['| Configuration | ECE v2 → v3 reach R/L | ECE v2 → v3 F/U | FMVSS v2 → v3 reach R/L | FMVSS v2 → v3 F/U |','|---|---:|---:|---:|---:|']
for n in list(names)[:-1]:
 ds=[index[n,p,s]for p in presets for s in ['spec-hl-v2','spec-hl-v3']]
 f=lambda d:f"{d['n']['fail']}/{d['n']['unsure']}"
 table.append(f'| {names[n]} | {reach(ds[0])} → {reach(ds[1])} | {f(ds[0])} → {f(ds[1])} | {reach(ds[2])} → {reach(ds[3])} | {f(ds[2])} → {f(ds[3])} |')
(D/'comparison-table.md').write_text('\n'.join(table)+'\n')
options=''.join(f'<option value="{n}">{html.escape(v)}</option>'for n,v in names.items())
data=json.dumps([{k:d[k]for k in ['name','preset','label','n','road','lmWindow','shoulderFraction5lx']}for d in cases])
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spec headlamp v3 — measured comparisons</title><style>
body{font:17px/1.5 system-ui;margin:auto;padding:28px;max-width:1300px;color:#202933;background:#f4f3ee}h1{font-size:30px;margin-bottom:6px}p{max-width:1000px}select{padding:10px;font:inherit;margin:5px 20px 5px 5px}a{color:#075aa8}img{width:100%;height:auto;background:white}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;text-align:left;border-bottom:1px solid #bec7cf}th{background:#e4eaf0}details{margin:20px 0}summary{cursor:pointer;font-weight:650;padding:12px;background:#e4eaf0}.scroll{overflow-x:auto}footer{margin-top:24px;font-size:14px}.note{border-left:4px solid #c67a13;padding-left:15px}
</style><h1>Spec headlamp v3</h1><p>Exploring · six source/housing configurations · two regulation presets · saved optics judged at 8 million rays.</p><p class="note">V3 improves some cases and falls back to v2 in others. It is experimental. Zero definite failures with uncertain rows is not a compliance pass. Read the <a href="REPORT.md">report</a>, <a href="ALL-RESULTS.md">all measurements and repeat runs</a>, or <a href="results.json">raw rows and settings</a>.</p>
<label>Configuration <select id="scene">OPTIONS</select></label><label>Specification <select id="preset"><option value="ece-r112-b">ECE R112 B</option><option value="fmvss-lb2v">FMVSS LB2V</option></select></label>
<p>Left: <b>linear isocandela</b>, outgoing angles at infinity, at the 25 m judgment’s aim. Right: <b>log road view to 100 m</b>, the app’s 25 m beam approximation, two identical lamps and a vertical sensor 25 cm high. Orange is 5 lux. Every figure uses the same scales; colour saturates at 50 kcd / 50 lux. The road’s lateral axis is expanded.</p>
<a id="large"><img id="pair" alt="Linear isocandela and logarithmic road comparison"></a><p id="downloads"></p>
<div class="scroll"><table><thead><tr><th>Solver</th><th>Pass/fail/uncertain</th><th>Farthest R/L, m</th><th>Continuous R/L, m</th><th>Window lm</th><th>50–80 m shoulders ≥5 lx</th></tr></thead><tbody id="rows"></tbody></table></div>
<details id="baseline"><summary>Show all six solvers on these same scales</summary><a id="allLink"><img id="all" loading="lazy" alt="All solver comparisons"></a></details>
<footer>Measurements are simulations of declared fixtures, not production vehicles. The 5-lux outline is not ground illuminance. <a href="browser-v3.jpg">Actual browser solve</a> · <a href="REPORT.md#reproduce">Reproduction commands</a></footer>
<script>const data=DATA;const $=id=>document.getElementById(id);function render(){const n=$('scene').value,p=$('preset').value,long=n==='projectorLong',base=n+'-'+p;const file=base+(long?'-all.png':'-pair.png');$('pair').src=file;$('large').href=file;$('all').src=base+'-all.png';$('allLink').href=$('all').src;$('baseline').hidden=long;$('rows').innerHTML=data.filter(d=>d.name===n&&d.preset===p).map(d=>`<tr><td>${d.label}</td><td>${d.n.pass}/${d.n.fail}/${d.n.unsure}</td><td>${d.road.farRight}/${d.road.farLeft}</td><td>${d.road.right}/${d.road.left}</td><td>${Math.round(d.lmWindow)}</td><td>${Math.round(d.shoulderFraction5lx*100)}%</td></tr>`).join('');const solvers=long?['spec-hl-v2','projector-liou','liou-cleanup']:['spec-hl-v3'];$('downloads').innerHTML='Saved scene JSON: '+solvers.map(s=>`<a href="scenes/${base}-${s}.json" download>${s}</a>`).join(' · ');}$('scene').addEventListener('change',render);$('preset').addEventListener('change',render);render();</script></html>'''
(D/'index.html').write_text(page.replace('OPTIONS',options).replace('DATA',data))
print(f'Exported {len(cases)} cases, {sum("repeat" in d for d in cases)} independent repeats; gallery, tables, raw rows and scenes.')
