(function(O) {
  'use strict';
  const {V}=O;
  class Input {
    constructor(app,renderer) {this.app=app;this.r=renderer;this.active=new Map();for(const [id,canvas]of Object.entries(renderer.canvases)){
      canvas.addEventListener('pointerdown',e=>this.down(id,e));canvas.addEventListener('pointermove',e=>this.move(id,e));canvas.addEventListener('pointerup',e=>this.up(id,e));canvas.addEventListener('pointercancel',e=>this.up(id,e));
      canvas.addEventListener('wheel',e=>{e.preventDefault();const v=this.view(id);v.zoom=V.clamp(v.zoom*Math.exp(-e.deltaY*.0015),.2,8);this.r.draw();},{passive:false});
    }}
    point(id,e){const b=this.r.canvases[id].getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];}
    view(id){return id==='scene'?this.app.state.view:id==='surfaces'?this.r.smallView:this.r.mapViews[id];}
    down(id,e) {
      e.preventDefault();const p=this.point(id,e);if(e.isTrusted)this.r.canvases[id].setPointerCapture(e.pointerId);this.active.set(e.pointerId,{id,p,start:p});
      const same=[...this.active.values()].filter(a=>a.id===id);if(same.length===2){this.gesture={distance:Math.hypot(same[0].p[0]-same[1].p[0],same[0].p[1]-same[1].p[1]),center:[(same[0].p[0]+same[1].p[0])/2,(same[0].p[1]+same[1].p[1])/2]};this.drag=null;return;}
      this.drag={id,last:p,start:p,moved:false};
      if(id==='scene'){const h=this.r.handles.find(h=>Math.hypot(h.p[0]-p[0],h.p[1]-p[1])<15);if(h)this.drag.handle=h.id;}
      if(id==='intent')this.paint(p,true);
    }
    move(id,e) {
      const a=this.active.get(e.pointerId);if(!a)return;const p=this.point(id,e);a.p=p;
      const same=[...this.active.values()].filter(a=>a.id===id);
      if(same.length===2&&this.gesture){const q=same.map(a=>a.p),distance=Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]),center=[(q[0][0]+q[1][0])/2,(q[0][1]+q[1][1])/2],v=this.view(id);v.zoom=V.clamp(v.zoom*distance/Math.max(1,this.gesture.distance),.2,8);v.pan[0]+=center[0]-this.gesture.center[0];v.pan[1]+=center[1]-this.gesture.center[1];this.gesture={distance,center};this.r.draw();return;}
      const d=this.drag;if(!d||d.id!==id)return;const dx=p[0]-d.last[0],dy=p[1]-d.last[1];if(Math.hypot(p[0]-d.start[0],p[1]-d.start[1])>3)d.moved=true;
      if(id==='scene'&&d.handle) {
        const s=this.app.state,cam=this.r.views.scene;
        if(d.handle==='source'){const delta=V.add(V.mul(cam.right,dx/cam.scale),V.mul(cam.up,-dy/cam.scale));this.app.edit('source.position',V.add(s.source.position,delta),true);}
        else if(d.handle==='sourceZ'||d.handle==='target'){const dz=(dx*V.dot([0,0,1],cam.right)-dy*V.dot([0,0,1],cam.up))/cam.scale;const path=d.handle==='sourceZ'?'source.position':'target.center',old=d.handle==='sourceZ'?s.source.position:s.target.center;this.app.edit(path,V.add(old,[0,0,dz]),true);}
        else {const f=Math.exp((dx-dy)*.004);this.app.edit('envelope.size',s.envelope.size.map(x=>V.clamp(x*f,1,150)),true);}
      }else if(id==='scene'||id==='surfaces') {const v=this.view(id);if(e.shiftKey){v.pan[0]+=dx;v.pan[1]+=dy;}else{v.yaw+=dx*.009;v.pitch+=dy*.009;}this.r.draw();}
      else if(id==='intent'&&this.app.state.mode!=='profile')this.paint(p,false);
      d.last=p;
    }
    paint(p,first) {
      const app=this.app,s=app.state,{u,v}=this.r.mapUV('intent',...p);if(u<0||v<0||u>1||v>1)return;
      if(s.mode==='paint') {const n=s.target.resolution,x=Math.floor(u*n),y=Math.floor(v*n),r=s.design.brush;for(let yy=Math.max(0,y-r);yy<=Math.min(n-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(n-1,x+r);xx++)if((xx-x)**2+(yy-y)**2<=r*r)s.paint[yy*n+xx]=app.erasing?0:s.design.paintLevel;this.r.drawMap('intent');}
      else if(s.mode==='stamp') {
        if(first){const old=[...s.stamps].reverse().find(t=>Math.abs(t.u-u)<t.size/s.target.width/2&&Math.abs(t.v-v)<t.size/s.target.height/2);if(old){app.selectedStamp=old.id;s.design.stampSize=old.size;}else{const id='stamp-'+(++app.serial);s.stamps.push({id,u,v,size:s.design.stampSize});app.selectedStamp=id;}app.sync();}
        const selected=s.stamps.find(t=>t.id===app.selectedStamp);if(selected){selected.u=u;selected.v=v;}app.generate(true);
      } else if(first) {const range=Math.max(...s.envelope.size)*.65;s.profile.push([u*range,(.5-v)*range]);O.Design.profileMesh(s);app.run(true);}
    }
    up(id,e) {
      const d=this.drag;this.active.delete(e.pointerId);if(this.active.size<2)this.gesture=null;
      if(d&&d.id===id){if(id==='surfaces'&&!d.moved){const p=this.point(id,e);const hit=[...this.r.surfacePolygons].reverse().find(x=>this.inPolygon(p,x.pts));if(hit){this.app.state.selection=hit.id;this.app.syncInspector();document.getElementById('surface-inspector').open=true;this.r.draw();}}
        if(id==='intent'&&this.app.state.mode==='stamp')this.app.generate();
        else if(id==='scene'&&d.handle||id==='intent'&&this.app.state.mode==='profile')this.app.run();this.app.persist();}
      this.drag=null;
    }
    inPolygon(p,pts){let b=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],c=pts[j];if((a[1]>p[1])!==(c[1]>p[1])&&p[0]<(c[0]-a[0])*(p[1]-a[1])/(c[1]-a[1])+a[0])b=!b;}return b;}
  }
  O.Input=Input;
})(Optics);
