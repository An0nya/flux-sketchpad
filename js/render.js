(function(O) {
  'use strict';
  const {V,Geometry:Geo}=O;
  const palette=t=>{const stops=[[8,15,24],[27,66,92],[50,128,145],[130,220,197],[255,242,182]],z=V.clamp(t,0,1)*4,i=Math.min(3,Math.floor(z)),f=z-i;return stops[i].map((v,k)=>Math.round(v+(stops[i+1][k]-v)*f));};
  class Renderer {
    constructor(app) {this.app=app;this.canvases={};this.views={};this.handles=[];this.surfacePolygons=[];this.mapViews={intent:{zoom:1,pan:[0,0]},heatmap:{zoom:1,pan:[0,0]}};this.smallView={yaw:.6,pitch:.45,zoom:1,pan:[0,0]};for(const id of ['scene','surfaces','intent','heatmap'])this.canvases[id]=document.getElementById(id);this.heat=document.createElement('canvas');}
    context(id) {const canvas=this.canvases[id],r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,r.width,r.height);return {c,w:r.width,h:r.height};}
    camera(id,w,h) {
      const s=this.app.state,v=id==='scene'?s.view:this.smallView;
      let center,extent;
      if(id==='scene'){center=V.mul(V.add(s.envelope.center,s.target.center),.5);extent=Math.max(V.distance(s.envelope.center,s.target.center)+Math.max(...s.envelope.size)*.7,s.target.width*1.4);}
      else {const pts=s.surfaces.flatMap(f=>f.vertices||[f.center]);if(pts.length){const b=Geo.bounds(pts);center=V.mul(V.add(b.min,b.max),.5);extent=Math.max(8,V.len(V.sub(b.max,b.min))*1.15);}else{center=s.envelope.center;extent=Math.max(...s.envelope.size);}}
      const forward=V.axis(v.yaw,v.pitch),right=[Math.cos(v.yaw),0,-Math.sin(v.yaw)],up=V.cross(forward,right);
      let scale=Math.min(w,h)*1.45/extent*v.zoom,shift=[0,0];
      if(id==='scene'){
        const tf=V.frame(s.target.normal),points=[...this.envelopeLines(s.envelope).flat(),s.source.position,...[-1,1].flatMap(x=>[-1,1].map(y=>V.add(s.target.center,V.world([x*s.target.width/2,y*s.target.height/2,0],tf))))];
        const xx=points.map(p=>V.dot(V.sub(p,center),right)),yy=points.map(p=>V.dot(V.sub(p,center),up)),xmin=Math.min(...xx),xmax=Math.max(...xx),ymin=Math.min(...yy),ymax=Math.max(...yy);
        scale=Math.min((w-65)/Math.max(1,xmax-xmin),(h-85)/Math.max(1,ymax-ymin))*v.zoom;shift=[(xmin+xmax)/2,(ymin+ymax)/2];
      }
      const project=p=>{const q=V.sub(p,center);return [w/2+(V.dot(q,right)-shift[0])*scale+v.pan[0],h/2-(V.dot(q,up)-shift[1])*scale+v.pan[1],V.dot(q,forward)];};
      return this.views[id]={project,right,up,forward,scale,center,w,h};
    }
    path(c,points,stroke,fill,width=1) {if(!points.length)return;c.beginPath();c.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))c.lineTo(p[0],p[1]);if(fill){c.closePath();c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
    text(c,x,y,t,color='#a8bcc8',size=10){c.font=`${size}px -apple-system, sans-serif`;c.fillStyle=color;c.fillText(t,x,y);}
    heatImage() {
      const s=this.app.state,n=s.target.resolution,g=this.app.result?.grid;if(this.heat.width!==n){this.heat.width=n;this.heat.height=n;}const c=this.heat.getContext('2d'),img=c.createImageData(n,n);let max=0;if(g)for(const x of g)max=Math.max(max,x);
      for(let i=0;i<n*n;i++){const rgb=palette(max&&g?Math.sqrt(g[i]/max):0);img.data.set([...rgb,255],i*4);}c.putImageData(img,0,0);
    }
    envelopeLines(e) {
      const out=[],C=e.center,R=e.size.map(x=>x/2),p=q=>V.add(C,q);
      if(e.kind==='box') {const vertices=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push(p([x*R[0],y*R[1],z*R[2]]));for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)if([0,1,2].filter(k=>vertices[i][k]!==vertices[j][k]).length===1)out.push([vertices[i],vertices[j]]);}
      else if(e.kind==='cylinder'){for(const y of [-1,1])out.push(Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2;return p([Math.cos(a)*R[0],y*R[1],Math.sin(a)*R[2]]);}));for(let i=0;i<8;i++){const a=i/8*Math.PI*2;out.push([-1,1].map(y=>p([Math.cos(a)*R[0],y*R[1],Math.sin(a)*R[2]])));}}
      else for(let k=0;k<3;k++)out.push(Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2,q=[0,0,0];q[(k+1)%3]=Math.cos(a)*R[(k+1)%3];q[(k+2)%3]=Math.sin(a)*R[(k+2)%3];return p(q);}));return out;
    }
    handle(c,p,label,color,id) {c.beginPath();c.arc(p[0],p[1],5,0,Math.PI*2);c.fillStyle='#101c26';c.fill();c.strokeStyle=color;c.lineWidth=1.5;c.stroke();this.text(c,p[0]+10,p[1]-8,label,color,9);this.handles.push({p,id});}
    drawSource(c,project,s) {
      const frame=V.frame(s.axis),center=s.position,R=s.size/2,point=q=>project(V.add(center,V.world(q,frame)));
      if(s.kind==='point') {const p=project(center);c.beginPath();c.arc(p[0],p[1],4,0,Math.PI*2);c.fillStyle='#ffe0a5';c.fill();}
      else if(s.kind==='planar'){const q=s.shape==='rectangle'?[[-R,-R*s.aspect,0],[R,-R*s.aspect,0],[R,R*s.aspect,0],[-R,R*s.aspect,0]]:Array.from({length:33},(_,i)=>[R*Math.cos(i/32*Math.PI*2),R*Math.sin(i/32*Math.PI*2),0]);this.path(c,q.map(point),'#ffe3a2','#f4c17caa',2);}
      else if(s.shape==='cylinder') {for(const z of [-s.height/2,s.height/2])this.path(c,Array.from({length:33},(_,i)=>point([R*Math.cos(i/32*Math.PI*2),R*Math.sin(i/32*Math.PI*2),z])),'#f4c17c','#f4c17c33');for(let i=0;i<6;i++){const a=i/6*Math.PI*2;this.path(c,[-1,1].map(z=>point([R*Math.cos(a),R*Math.sin(a),z*s.height/2])),'#f4c17c66');}}
      else for(let k=0;k<3;k++)this.path(c,Array.from({length:33},(_,i)=>{const a=i/32*Math.PI*2,p=[0,0,0];p[(k+1)%3]=R*Math.cos(a);p[(k+2)%3]=R*Math.sin(a);return point(p);}),'#f4c17c','#f4c17c10');
      const a=project(center),b=project(V.add(center,V.mul(s.axis,5)));this.path(c,[a,b],'#f4c17c',null,2);const angle=Math.atan2(b[1]-a[1],b[0]-a[0]);this.path(c,[[b[0]-7*Math.cos(angle-.4),b[1]-7*Math.sin(angle-.4)],b,[b[0]-7*Math.cos(angle+.4),b[1]-7*Math.sin(angle+.4)]],'#f4c17c',null,2);
    }
    drawScene(id='scene') {
      const {c,w,h}=this.context(id),s=this.app.state,cam=this.camera(id,w,h),project=cam.project,isMain=id==='scene';
      if(isMain) {
        this.handles=[];
        const step=5,z=s.envelope.center[2]-s.envelope.size[2]/2;
        for(let i=-30;i<=30;i+=step){this.path(c,[[i,-30,z],[i,30,z]].map(project),'#56708015');this.path(c,[[-30,i,z],[30,i,z]].map(project),'#56708015');}
        for(const line of this.envelopeLines(s.envelope))this.path(c,line.map(project),'#69889f55');
        const f=V.frame(s.target.normal),p=V.add(s.target.center,V.world([-s.target.width/2,-s.target.height/2,0],f)),a=project(p),b=project(V.add(p,V.mul(f.u,s.target.width))),d=project(V.add(p,V.mul(f.v,s.target.height)));
        c.save();c.globalAlpha=.72;c.transform((b[0]-a[0])/this.heat.width,(b[1]-a[1])/this.heat.width,(d[0]-a[0])/this.heat.height,(d[1]-a[1])/this.heat.height,a[0],a[1]);c.imageSmoothingEnabled=s.view.smooth;c.drawImage(this.heat,0,0);c.restore();
        this.path(c,[a,b,[b[0]+d[0]-a[0],b[1]+d[1]-a[1]],d,a],'#b7a6ef88');
      }
      const faces=s.surfaces.map((f,i)=>({f,i,pts:Geo.corners(f,f.focal?4:1).map(project)})).sort((a,b)=>a.pts.reduce((s,p)=>s+p[2],0)/a.pts.length-b.pts.reduce((s,p)=>s+p[2],0)/b.pts.length);
      if(!isMain)this.surfacePolygons=[];
      for(const {f,i,pts}of faces) {
        const selected=s.selection===f.id,col=f.type==='refract'?'#b9afff':f.type==='absorb'?'#74818c':'#88d7d4';
        this.path(c,pts,selected?'#fff0b3':col+(isMain?'88':'bb'),selected?'#e9bb6b66':col+(isMain?'1c':'22'),selected?2:.7);
        if(!isMain){this.surfacePolygons.push({pts,id:f.id});const center=f.center||V.mul(f.vertices.reduce((a,p)=>V.add(a,p),[0,0,0]),1/3),normal=f.normal||V.unit(V.cross(V.sub(f.vertices[1],f.vertices[0]),V.sub(f.vertices[2],f.vertices[0])));
          if(s.view.normals)this.path(c,[center,V.add(center,V.mul(normal,1.5))].map(project),'#f4c17caa');
          if(s.view.surfacePairs&&i%Math.max(1,Math.ceil(faces.length/80))===0){
            const incoming=V.unit(V.sub(center,s.source.position)),front=V.dot(incoming,normal)<0,points=[V.sub(center,V.mul(incoming,3)),center];
            if(f.type==='reflect'&&(front||f.twoSided))points.push(V.add(center,V.mul(V.reflect(incoming,normal),3)));
            if(f.type==='refract'){const refracted=O.snell(incoming,normal,front?1:f.ior,front?f.ior:1);points.push(V.add(center,V.mul(refracted.d,3)));}
            this.path(c,points.map(project),'#f4c17c99');
          }
        }
      }
      if(isMain) {
        if(s.view.rays&&this.app.result?.paths)for(const path of this.app.result.paths)this.path(c,path.points.map(project),path.via?'#f4c17c26':'#b8a6ee30',null,.65);
        this.drawSource(c,project,s.source);
        this.handle(c,project(s.source.position),'SOURCE','#f4c17c','source');
        this.handle(c,project(V.add(s.source.position,[0,0,5])),'SOURCE Z','#d7ad77','sourceZ');
        this.handle(c,project(s.target.center),'TARGET · drag distance','#b7a6ef','target');
        const corner=V.add(s.envelope.center,V.mul(s.envelope.size,.5));this.handle(c,project(corner),'ENVELOPE','#8eacbf','envelope');
        if(!s.target.linked){const p=project(s.target.aim);this.text(c,p[0],p[1],'⊕ AIM','#cbb4ef',14);}
        if(this.app.preview){this.path(c,this.app.preview.map(project),'#ffe3a0',null,2);}
        const axisOrigin=[35,h-37],axisScale=18;
        for(const [vec,label,col]of [[[1,0,0],'X','#83ccde'],[[0,1,0],'Y','#f4c17c'],[[0,0,1],'Z','#b7a6ef']]){const q=[axisOrigin[0]+V.dot(vec,cam.right)*axisScale,axisOrigin[1]-V.dot(vec,cam.up)*axisScale];this.path(c,[axisOrigin,q],col);this.text(c,q[0]+3,q[1],label,col,9);}
      } else if(!s.surfaces.length)this.text(c,20,h/2,'Your optical surfaces will appear here.');
    }
    mapGeometry(id,w,h) {const v=this.mapViews[id],size=Math.min(w-12,h-12)*v.zoom;return {x:(w-size)/2+v.pan[0],y:(h-size)/2+v.pan[1],size};}
    mapUV(id,x,y) {const r=this.canvases[id].getBoundingClientRect(),m=this.mapGeometry(id,r.width,r.height);return {u:(x-m.x)/m.size,v:(y-m.y)/m.size};}
    drawMap(id) {
      const {c,w,h}=this.context(id),s=this.app.state,m=this.mapGeometry(id,w,h),n=s.target.resolution;
      if(id==='heatmap'){c.imageSmoothingEnabled=s.view.smooth;c.drawImage(this.heat,m.x,m.y,m.size,m.size);return;}
      if(s.mode==='profile') {
        const range=Math.max(...s.envelope.size)*.65,to=q=>[m.x+q[0]/range*m.size,m.y+m.size/2-q[1]/range*m.size];
        for(let j=-4;j<=4;j++){this.path(c,[[m.x,m.y+m.size/2+j*m.size/8],[m.x+m.size,m.y+m.size/2+j*m.size/8]],'#263b4a');}
        this.path(c,[[m.x,m.y],[m.x,m.y+m.size]],'#88d7d4aa');this.path(c,[[m.x,m.y+m.size/2],[m.x+m.size,m.y+m.size/2]],'#f4c17c66');
        this.path(c,s.profile.map(to),'#88d7d4',null,2);for(const p of s.profile){const q=to(p);c.beginPath();c.arc(q[0],q[1],3,0,Math.PI*2);c.fillStyle='#b7f1e5';c.fill();}
        this.text(c,m.x+5,m.y+12,'z ↑',undefined,9);this.text(c,m.x+m.size-22,m.y+m.size/2-5,'r →',undefined,9);this.text(c,m.x+3,m.y+m.size-5,`width ${range.toFixed(1)} units`,undefined,8);return;
      }
      c.fillStyle='#080f18';c.fillRect(m.x,m.y,m.size,m.size);
      if(s.mode==='paint') {for(let i=0;i<s.paint.length;i++)if(s.paint[i]>0){c.fillStyle=`rgba(136,215,212,${.2+.7*s.paint[i]})`;c.fillRect(m.x+i%n*m.size/n,m.y+Math.floor(i/n)*m.size/n,m.size/n+.15,m.size/n+.15);}}
      else {for(const stamp of s.stamps){const ww=stamp.size/s.target.width*m.size,hh=stamp.size/s.target.height*m.size,x=m.x+stamp.u*m.size,y=m.y+stamp.v*m.size;c.fillStyle=stamp.id===this.app.selectedStamp?'#f4c17c44':'#88d7d433';c.strokeStyle=stamp.id===this.app.selectedStamp?'#f4c17c':'#88d7d4';c.lineWidth=1.5;c.fillRect(x-ww/2,y-hh/2,ww,hh);c.strokeRect(x-ww/2,y-hh/2,ww,hh);this.text(c,x-3,y+3,String(s.stamps.indexOf(stamp)+1),'#dff4ec',9);}}
      if(m.size/n>=4){c.strokeStyle='#719dbb11';c.lineWidth=.5;for(let i=0;i<=n;i++){c.beginPath();c.moveTo(m.x+i*m.size/n,m.y);c.lineTo(m.x+i*m.size/n,m.y+m.size);c.moveTo(m.x,m.y+i*m.size/n);c.lineTo(m.x+m.size,m.y+i*m.size/n);c.stroke();}}
    }
    draw() {this.heatImage();this.drawScene();this.drawScene('surfaces');this.drawMap('intent');this.drawMap('heatmap');}
  }
  O.Renderer=Renderer;
})(Optics);
