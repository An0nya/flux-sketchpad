#!/usr/bin/env python3
"""Comparable linear isocandela and log IIHS-sensor road plots from saved trace grids."""
import argparse,json,pathlib
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
p=argparse.ArgumentParser();p.add_argument('inputs',nargs='+');p.add_argument('--out',required=True);args=p.parse_args()
rows=[json.loads(pathlib.Path(f).read_text()) for f in args.inputs]
plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False})
fig,axs=plt.subplots(len(rows),2,figsize=(13,4.6*len(rows)),squeeze=False,layout='constrained',gridspec_kw={'width_ratios':[1.4,1]})
for row,(ax,road) in zip(rows,axs):
    H,V,C=np.array(row['h']),np.array(row['v']),np.array(row['cd'])
    im=ax.pcolormesh(H,V,C/1000,shading='auto',cmap='cividis',vmin=0,vmax=50,rasterized=True)
    levels=[.625,2.5,5,10,20,30,40]
    cs=ax.contour(H,V,C/1000,levels=levels,colors='white',linewidths=.6,alpha=.9)
    ax.clabel(cs,fmt='%g',fontsize=7,inline=True)
    ax.axhline(0,color='#f5a442',lw=.6,ls='--');ax.axvline(0,color='#f5a442',lw=.6,ls='--')
    ax.set(xlabel='Horizontal angle (°; left ← → right)',ylabel='Vertical angle (°)',xlim=(-25,25),ylim=(-10,5))
    fig.colorbar(im,ax=ax,shrink=.8,label='Intensity (kcd), linear 0–50; contours in kcd',extend='max')
    names={'filament7':'HB3 · 7-inch round','filamentBox':'HB3 · deep rectangular','ledUp':'Generic LED · up-firing','led519a':'519A · up-firing','ledRear7':'Generic LED · rear-firing 7-inch','osramSmall':'Osram · small module','projectorLong':'HB3 · long projector'}
    n=row['n'];title=f"{names.get(row['name'],row['name'])} · {row.get('label',row['solver'])} · {row['preset']}"
    ax.set_title(title+'\n'+f"{n['pass']} pass / {n['fail']} fail / {n['unsure']} uncertain · {row['lmWindow']:.0f} lm in window",loc='left',fontsize=11)
    X,Y,E=np.array(row['side']),np.array(row['distance']),np.array(row['lux'])
    rm=road.pcolormesh(X,Y,np.maximum(E,.03),norm=LogNorm(.03,50),cmap='cividis',shading='auto',rasterized=True)
    if E.min()<5<E.max():
        co=road.contour(X,Y,E,levels=[5],colors=['#ff9e3d'],linewidths=1.8)
        road.clabel(co,fmt={5:'5 lx'},fontsize=8)
    for x in [-4.95,-1.65,1.65]:road.axvline(x,color='white',alpha=.6,lw=.7,ls='--')
    road.set(xlabel='Lateral distance (m; left ← → right)',ylabel='Distance ahead (m)',xlim=(-12,12),ylim=(5,100))
    r=row['reach'];road.set_title(f"IIHS sensor · two lamps · logarithmic lux\nFarthest R/L {r['farRight']:.0f}/{r['farLeft']:.0f} m; continuous {r['right']:.0f}/{r['left']:.0f} m",loc='left',fontsize=10)
    cb=fig.colorbar(rm,ax=road,shrink=.8,label='Lux at 25 cm, vertical sensor',extend='max',ticks=[.03,.1,.3,1,3,5,10,30,50])
    cb.ax.set_yticklabels(['0.03','0.1','0.3','1','3','5','10','30','50'])
fig.suptitle('Linear far field at infinity · log road view to 100 m · orange = 5 lux\n25 m judged aim; road uses the app’s 25 m beam approximation · lateral axis expanded',fontsize=11)
dest=pathlib.Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True);fig.savefig(dest,dpi=150);plt.close(fig)
