import json, glob, sys, os
D = sys.argv[1]
rows = {}
for f in sorted(glob.glob(os.path.join(D, '*-p[12].jsonl'))):
    name = os.path.basename(f)[:-6]
    for line in open(f):
        r = json.loads(line)
        if r.get('type') == 'env':
            print('ENV', name, r.get('unmaskedDriveCanvas') or r.get('unmaskedFresh'), r.get('viewport'))
        if r.get('type') == 'row':
            rows.setdefault(r['id'], {})[name] = r
ids = ['off-one','tbl4-one','halo4-one','tbl16-one','halo16-one','off-four','tbl4-four','halo4-four','tbl16-four','halo16-four']
for i in ids:
    out = []
    for k in sorted(rows.get(i, {})):
        r = rows[i][k]
        out.append(f"{k}: med {r['medianMs']:.2f} p95 {r['p95Ms']:.2f} px {r['canvasPx']} cars {r['carsMin']}-{r['carsMax']} share {r['carsShare']} start {r['startDist']:.1f}")
    print(i); print('\n'.join('   ' + o for o in out))
