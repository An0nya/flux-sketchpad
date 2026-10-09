#!/usr/bin/env python3
"""Local artifact export only; this does not publish to any service."""
import concurrent.futures,json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
B=ROOT/'bench-out/spec-hl-v3';D=ROOT/'docs/spec-hl-v3'
scenes=['filament7','filamentBox','ledUp','led519a','ledRear7','osramSmall']
presets=['ece-r112-b','fmvss-lb2v']
solvers=['spec-hl-v2','spec-hl-v3','sqm-hl','sqm-hl-dish','opus-mosaic-auto','dish-fit-auto']
cases=[B/f'{s}-{p}-{v}' for s in scenes for p in presets for v in solvers]
cases += [B/f'projectorLong-{p}-{v}' for p in presets for v in ['spec-hl-v2','projector-liou']]
cases += [B/'liou-cleanup'/f'projectorLong-{p}-projector-liou' for p in presets]
def field(d):
    subprocess.run(['node',str(ROOT/'tools/spec-hl-v3/farfield.js'),str(d)],check=True,cwd=ROOT,stdout=subprocess.DEVNULL)
    print('FIELD',d.name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:list(ex.map(field,cases))
def plot(ds,out):
    subprocess.run([sys.executable,str(ROOT/'tools/spec-hl-v3/plots.py'),*[str(d/'plot-8000000-1.json') for d in ds],'--out',str(D/out)],check=True,cwd=ROOT)
    print('PLOT',out,flush=True)
for s in scenes:
    for p in presets:
        ds=[B/f'{s}-{p}-{v}' for v in solvers]
        plot(ds[:2],f'{s}-{p}-pair.png');plot(ds,f'{s}-{p}-all.png')
for p in presets:
    ds=[B/f'projectorLong-{p}-spec-hl-v2',B/f'projectorLong-{p}-projector-liou',B/'liou-cleanup'/f'projectorLong-{p}-projector-liou']
    f=ds[-1]/'plot-8000000-1.json';x=json.loads(f.read_text());x['label']='Liou · cleanup shield, f=54';f.write_text(json.dumps(x))
    plot(ds,f'projectorLong-{p}-all.png')
print('DONE: 78 true far-field exports, 26 comparison figures',flush=True)
