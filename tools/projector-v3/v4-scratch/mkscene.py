# mkscene.py <out.json> [off=20] [dia=90] [len=200]  -- scene-4 (HB3, FMVSS LB2V) with a cylinder envelope, axis x (toward the target), filament `off` mm in from the rear end
import json,sys
out=sys.argv[1]; off=float(sys.argv[2]) if len(sys.argv)>2 else 20; dia=float(sys.argv[3]) if len(sys.argv)>3 else 90; L=float(sys.argv[4]) if len(sys.argv)>4 else 200
d=json.load(open('/Users/anya/Downloads/reflector-scene-4.json'))
s=d['source']; y0,z0=s['pos'][1],s['pos'][2]; xs=s['pos'][0]
d['envelope']={'shape':'cylinder','center':[xs-off+L/2,y0,z0],'half':[L/2,dia/2,dia/2],'axis':0,'keepOut':0}
d['groups']['A']['surfaces']=[]
d['name']='cyl %gx%g off %g'%(dia,L,off)
json.dump(d,open(out,'w'))
print(out,d['envelope'])
