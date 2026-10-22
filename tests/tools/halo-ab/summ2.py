import json, glob, os, re, statistics as st
D = os.path.dirname(os.path.abspath(__file__))
res = {}
for f in sorted(glob.glob(os.path.join(D, 'N*-p[12].jsonl'))):
    n = int(re.search(r'N(\d+)-', os.path.basename(f)).group(1))
    for line in open(f):
        r = json.loads(line)
        if r.get('type') == 'row':
            res.setdefault(n, {}).setdefault(r['id'], []).append(r['medianMs'])
        if r.get('type') == 'env':
            res.setdefault(n, {}).setdefault('_haloN', []).append(r.get('haloN'))
print('N  haloN  | one: off  halo4  d4   halo16 d16 | four: off  halo4  d4   halo16 d16')
for n in sorted(res):
    g = res[n]
    def m(k): return st.mean(g[k]) if k in g and g[k] else float('nan')
    hn = g.get('_haloN', [None])[0]
    print(f"{n:<3}{hn!s:<7}| {m('off-one'):5.2f} {m('halo4-one'):6.2f} {m('halo4-one')-m('off-one'):5.2f} {m('halo16-one'):6.2f} {m('halo16-one')-m('off-one'):5.2f} | {m('off-four'):5.2f} {m('halo4-four'):6.2f} {m('halo4-four')-m('off-four'):5.2f} {m('halo16-four'):6.2f} {m('halo16-four')-m('off-four'):5.2f}   runs={len(g.get('off-one',[]))}")
