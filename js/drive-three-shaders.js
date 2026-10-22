/* Linear luminance only. Formula reference: drive.js; display passes stay in drive-anim.js. */
// HALO-AB test hook: the halo bin count N (default 24 = today). ?halobins=N on the page URL sets it (4..32). Read by the halo table and the lookup shader alike.
export const HALO_N = (() => { const v = +new URLSearchParams(globalThis.location ? location.search : '').get('halobins'); return v >= 4 && v <= 32 ? Math.round(v) : 24; })();
export const vertex = `
varying vec2 screen;
void main() { screen = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const ground = `
precision highp float;
precision highp int;
uniform sampler2D beam, materials, marks;
uniform vec4 lutInfo;
uniform vec2 lutSize, size;
uniform vec3 eye, lamp[2], lampRGB;
uniform int nLamp, convention, nMark, nPart, nLight, nReflection, nSkip, nCross;
uniform vec4 part[16], partShape[16], light[64], reflection[64];
uniform vec3 lightRGB[64], reflectionRGB[64];
uniform vec2 skip[16];
uniform vec4 crossing[16];
uniform float tanH, lane, vergeWidth, ambient, sheen, grain, distance, wetModel, wetness;
uniform vec2 verge;
uniform vec2 arc;
uniform float sigma;   // fog extinction per metre (look.visibility: 3.912 / V); 0 = off
float fogT(float d) { return sigma>0.0 ? exp(-sigma*d) : 1.0; }   // transmittance over a light path (drive.js fogD)
uniform int scatterSteps;   // in-scatter steps (look.scatter; 0 = off; only with sigma>0). drive.js inScatter is the CPU twin
uniform float scatGFwd, scatGBack, scatWFwd, scatRMin, scatSMax;   // drive.js SCAT
// SL: the traffic scatter table (js/drive-three-halo.js). A screen-space table (1/8 of the view, six tiles side by side) holds, per cell, the oncoming
// lamps' single-scatter integral over six distance bins whose edges follow the nearest lamp (fixed ladder 8, 14, 22, 34, 60, 120 m when it is far). haloScatter(d) sums the bins up to the fragment's
// own end distance d (ground hit, object eye distance, sky = 120 m), interpolated in log d like tableC, so the lit air in FRONT of a surface adds to it and the
// air BEHIND it does not. haloOn is a uniform: off costs one branch, and toggling never changes the shader text (no recompile).
uniform int haloOn; uniform sampler2D haloTex; uniform vec2 haloUV, haloTab;   // haloUV: 1 / pixels of the target this pass draws; haloTab: cells per tile
uniform float haloE[${HALO_N}];   // the upper edge of each bin: fixed geometric 0.5..120 m, HALO_N bins (HDX3; see HALO_EDGES in drive-three-halo.js)
// Cubic B-spline read of one bin tile in 4 bilinear fetches (the linear trick: B-spline weights are all positive, so two taps per axis are exact). It
// removes the cell-grid stairs plain bilinear leaves on a sharp-edged glow. Tap centres are clamped inside the tile, so no bin bleeds into its neighbour.
vec3 haloBin(int k, vec2 pc, vec2 f, vec2 tab) {
  vec2 f2=f*f, f3=f2*f, w0=(1.0-f)*(1.0-f)*(1.0-f)/6.0, w1=(3.0*f3-6.0*f2+4.0)/6.0, w2=(-3.0*f3+3.0*f2+3.0*f+1.0)/6.0, w3=f3/6.0;
  vec2 g0=w0+w1, g1=w2+w3, h0=pc-1.0+w1/g0, h1=pc+1.0+w3/g1;   // pc: texel index of the cell holding the fragment; taps land between texel centres
  h0=clamp(h0+0.5,vec2(0.5),tab-0.5); h1=clamp(h1+0.5,vec2(0.5),tab-0.5);
  float x0=(float(k)*tab.x+h0.x), x1=(float(k)*tab.x+h1.x), inv=1.0/(tab.x*${HALO_N}.0);
  return g0.y*(g0.x*texture(haloTex,vec2(x0*inv,h0.y/tab.y)).rgb+g1.x*texture(haloTex,vec2(x1*inv,h0.y/tab.y)).rgb)
       + g1.y*(g0.x*texture(haloTex,vec2(x0*inv,h1.y/tab.y)).rgb+g1.x*texture(haloTex,vec2(x1*inv,h1.y/tab.y)).rgb);
}
vec3 haloScatter(float d) {
  if(haloOn==0 || d<=0.5) return vec3(0.0);
  vec2 p=gl_FragCoord.xy*haloUV*haloTab-0.5, pc=floor(p), f=p-pc;
  float dd=min(d,120.0);
  // running total at each bin's upper edge (knots); HDX3: monotone cubic Hermite (Fritsch-Carlson, linear C, log d) between knots
  vec3 Cc[${HALO_N}]; vec3 C=vec3(0.0);
  for(int k=0;k<${HALO_N};k++) { C+=haloBin(k,pc,f,haloTab); Cc[k]=C; }
  if(dd<=haloE[0]) return Cc[0]*log(dd/0.5)/log(haloE[0]/0.5);   // bin 0: log d from 0.5 m (C(0.5)=0)
  int s=0; for(int k=0;k<${HALO_N - 1};k++) if(dd>haloE[k]) s=k;   // segment s: knots s..s+1 bracket dd
  const float h=${HALO_N === 24 ? '0.22836' : (Math.log(240) / HALO_N).toFixed(8)};          // ln(240)/HALO_N: the knots are log-uniform (HALO_EDGES)
  vec3 dS=(Cc[s+1]-Cc[s])/h, dP=(Cc[max(s-1,0)+1]-Cc[max(s-1,0)])/h, dN=(Cc[min(s+1,${HALO_N - 2})+1]-Cc[min(s+1,${HALO_N - 2})])/h;
  vec3 mP=vec3(0.0), mN=vec3(0.0);
  vec3 ab=dP*dS, ms=step(vec3(1e-30),ab); mP=ms*2.0*ab/mix(vec3(1.0),dP+dS,ms);   // harmonic mean where the slopes agree in sign, else 0
  vec3 ab2=dS*dN, ms2=step(vec3(1e-30),ab2); mN=ms2*2.0*ab2/mix(vec3(1.0),dS+dN,ms2);
  vec3 mA=(s==0 ? dS : mP), mB=(s==${HALO_N - 2} ? dS : mN);
  float t=(log(dd)-log(haloE[s]))/h, t2=t*t, t3=t2*t;
  return (2.0*t3-3.0*t2+1.0)*Cc[s] + (t3-2.0*t2+t)*h*mA + (-2.0*t3+3.0*t2)*Cc[s+1] + (t3-t2)*h*mB;
}
varying vec2 screen;
const float PI = 3.141592653589793;
float coverage(float a, float h, float lo, float hi) { return max(0.0, min(a+h,hi)-max(a-h,lo))/(2.0*h); }
float integral(float x, vec4 p) { float u=x-p.x, n=floor(u/p.z); return n*p.w+min(u-n*p.z,p.w); }
float longitudinal(float s, float h, vec4 p) { if(p.z==0.0) return 1.0; float a=max(s-h,p.x), b=min(s+h,p.y); return b>a ? (integral(b,p)-integral(a,p))/(2.0*h) : 0.0; }
float intensity(vec3 d) {
  vec3 q=normalize(d); float a=q.x, b=-q.y, c=q.z; vec2 hv;
  if(convention==1) hv=vec2(asin(clamp(b,-1.0,1.0)),atan(c,a));
  else if(convention==2) { if(a<=0.0) return 0.0; hv=atan(vec2(b,c)/a); }
  else hv=vec2(atan(b,a),asin(clamp(c,-1.0,1.0)));
  vec2 f=(degrees(hv)-lutInfo.xy)/lutInfo.z-0.5, base=floor(f), t=f-base;
  if(any(lessThan(base,vec2(0)))||any(greaterThanEqual(base+1.0,lutSize))) return 0.0;
  ivec2 k=ivec2(base);
  return mix(mix(texelFetch(beam,k,0).r,texelFetch(beam,k+ivec2(1,0),0).r,t.x),mix(texelFetch(beam,k+ivec2(0,1),0).r,texelFetch(beam,k+ivec2(1,1),0).r,t.x),t.y);
}
float wetLobe(vec3 d,vec3 v) {
  float rr=length(d); vec3 h=normalize(d/rr+v); float vl=max(length(v.xy),1e-12);
  float along=dot(h.xy,v.xy)/vl, across=dot(h.xy,vec2(-v.y,v.x))/vl;
  float F=0.02+0.98*pow(1.0-max(0.0,v.z),5.0);
  return F*exp(-0.5*(pow(along/0.23,2.0)+pow(across/0.025,2.0)))*max(0.0,h.z)*4.0/(rr*rr);
}
// Anisotropic GGX wet sheen (look.wetModel 'ggx'); the same math as wetGGX in js/drive.js. Returns f*cos/r^2 per candela.
// d = point -> light (unnormalised), v = point -> eye (unit), n = surface normal. Tangent T follows the view direction horizontal part.
float wetGGX(vec3 d,vec3 v,vec3 n) {
  float rr=length(d); vec3 l=d/rr, h=normalize(l+v);
  float NoV=dot(n,v), NoL=dot(n,l);
  if(NoV<=0.0 || NoL<=0.0) return 0.0;
  const float a=0.25, b=0.05;
  vec3 pt=v-n*NoV; vec3 t=length(pt)>1e-6 ? normalize(pt) : vec3(1.0,0.0,0.0), bt=cross(n,t);
  float ht=dot(h,t), hb=dot(h,bt), hn=dot(h,n);
  float e=ht*ht/(a*a)+hb*hb/(b*b)+hn*hn, D=1.0/(PI*a*b*e*e);
  float lt=dot(l,t), lb=dot(l,bt), vt=dot(v,t), vb=dot(v,bt);
  float Lv=(sqrt(1.0+(a*a*vt*vt+b*b*vb*vb)/(NoV*NoV))-1.0)*0.5, Ll=(sqrt(1.0+(a*a*lt*lt+b*b*lb*lb)/(NoL*NoL))-1.0)*0.5;
  float G=1.0/(1.0+Lv+Ll), VoH=dot(v,h), F=0.02+0.98*pow(1.0-max(0.0,VoH),5.0);
  return D*F*G/(4.0*NoV*rr*rr);
}
vec3 shade(vec3 p,vec3 n,vec3 v,int id) {
  vec3 rho=texelFetch(materials,ivec2(id,0),0).rgb, retro=texelFetch(materials,ivec2(id,1),0).rgb;
  vec4 gloss=texelFetch(materials,ivec2(id,2),0); vec3 r=rho*ambient*(0.5+0.5*n.z)/PI;
  float NoV=dot(n,v);
  for(int i=0;i<64;i++) { if(i>=nLight) break; vec3 d=light[i].xyz-p; float r2=dot(d,d); if(d.z>0.0 && r2>=0.01) r+=rho*lightRGB[i]*light[i].w*max(0.0,dot(d,n))/(PI*r2*sqrt(r2))*fogT(sqrt(r2)); }
  // wet sheen: 0 asphalt, 4 concrete, 5 white paint, 6 yellow paint (the order of MAT_DEF in drive.js; SB2 adds the paint ids, drive.js SHEEN_IDS)
  if(sheen>0.0 && (id==0||id==4||id==5||id==6)) for(int i=0;i<64;i++) { if(i>=nReflection) break; r+=wetness*reflection[i].w*(wetModel>0.5 ? wetGGX(reflection[i].xyz-p,v,n) : wetLobe(reflection[i].xyz-p,v))*fogT(length(reflection[i].xyz-p))*reflectionRGB[i]; }
  for(int i=0;i<2;i++) { if(i>=nLamp) break; vec3 d=p-lamp[i]; float r2=dot(d,d), rr=sqrt(r2), NoL=-dot(d,n)/rr; if(NoL<=0.0) continue;
    float I=intensity(d); I*=fogT(rr); if(I<=0.0) continue;
    if(sheen>0.0 && (id==0||id==5||id==6)) r+=vec3(wetness*I*(wetModel>0.5 ? wetGGX(-d,v,n) : wetLobe(-d,v)));
    float Ep=I/r2; r+=rho*Ep*NoL/PI + retro*Ep;
    if(gloss.x>0.0 && NoV>0.0) { vec3 l=-d/rr, h=normalize(l+v); float NoH=dot(n,h), VoH=dot(v,h), a2=gloss.x*gloss.x, den=NoH*NoH*(a2-1.0)+1.0;
      float D=a2/(PI*den*den), F=gloss.y+(1.0-gloss.y)*pow(1.0-max(0.0,VoH),5.0), k=gloss.x/2.0;
      r+=vec3(D*F*(NoL/(NoL*(1.0-k)+k))*(NoV/(NoV*(1.0-k)+k))/(4.0*NoV)*Ep);
    }
  }
  return r*lampRGB;
}
// Visible beam in fog (SC2): single in-scatter off the own lamps. Same math as inScatter in js/drive.js (the CPU twin), one table of constants.
// beamI is the lamp's intensity toward d; withLighting adds the cornering term to it for the object shaders (as it does in the lamp loop of surface).
float beamI(vec3 d,vec3 origin) { return intensity(d); }
float hgP(float g,float c) { return (1.0-g*g)/(4.0*PI*pow(1.0+g*g-2.0*g*c,1.5)); }
// Per-pixel jitter: the same integer hash as scatterJitter in drive.js, on the pixel index (row 0 = top, as the CPU rows).
float scatterJitter() { uint x=uint(gl_FragCoord.x), y=uint(size.y)-1u-uint(gl_FragCoord.y); uint h=(x*0x27d4eb2du)^(y*0x165667b1u); h=(h^(h>>15u))*0x85ebca6bu; h=(h^(h>>13u))*0xc2b2ae35u; h^=h>>16u; return float(h)/4294967296.0; }
// dir: unit eye ray; sEnd: the surface's eye distance (or huge for sky), capped at scatSMax. Stratified log steps from s0 = min(1, s1/4) to s1.
vec3 inScatter(vec3 dir,float sEnd,float jit) {
  vec3 acc=vec3(0.0);
  float s1=min(sEnd,scatSMax);
  if(sigma<=0.0 || s1<=0.0) return acc;
  float s0=min(1.0,s1*0.25), q=pow(s1/s0,1.0/float(scatterSteps));
  for(int k=0;k<16;k++) { if(k>=scatterSteps) break;
    float a=s0*pow(q,float(k)), b=a*q, s=a*pow(q,jit), ds=b-a, Tv=exp(-sigma*s);
    vec3 P=eye+s*dir;
    for(int i=0;i<2;i++) { if(i>=nLamp) break;
      vec3 d=P-lamp[i]; float r2=dot(d,d); if(r2<=0.0) continue; float r=sqrt(r2);
      float I=beamI(d,lamp[i]); if(I<=0.0) continue;
      float cs=-dot(d,dir)/r, p=scatWFwd*hgP(scatGFwd,cs)+(1.0-scatWFwd)*hgP(scatGBack,cs);
      float E=I/max(r2,scatRMin*scatRMin);
      acc+=sigma*p*E*exp(-sigma*r)*Tv*ds*lampRGB;
    }
  }
  return acc;
}
vec4 roadFrame(vec2 p) {
  if(nPart==0) {
    if(arc.x==0.0) return vec4(p,1,0);
    float R=arc.x, sg=arc.y, a=atan(p.x,R-sg*p.y); return vec4(a*R,sg*(R-length(vec2(p.x,p.y-sg*R))),cos(a),sg*sin(a));
  }
  float best=1e30; vec4 ans=vec4(p,1,0);
  for(int i=0;i<16;i++) { if(i>=nPart) break; vec4 q=part[i], z=partShape[i]; float ca=cos(q.z), sn=sin(q.z); vec2 d=p-q.xy;
    float lx=dot(d,vec2(ca,sn)), ly=dot(d,vec2(-sn,ca)); float u=q.w!=0.0 ? atan(q.w*lx,1.0-q.w*ly)/q.w : lx;
    u=clamp(u,i==0 ? -1e5 : 0.0,i==nPart-1 ? 1e5 : z.y); float b=q.z+q.w*u; vec2 t=vec2(cos(b),sin(b));
    vec2 pos=q.xy+(q.w!=0.0 ? vec2(sin(b)-sn,ca-cos(b))/q.w : u*vec2(ca,sn)); vec2 e=p-pos; float dd=dot(e,e);
    if(dd<best) { best=dd; ans=vec4(z.x+u,dot(e,vec2(-t.y,t.x)),t); }
  } return ans;
}
vec3 surface(vec3 p,vec3 v,float t,float sinB) {
  vec4 f=roadFrame(p.xy); float s=f.x, off=f.y; vec2 normal=vec2(-f.w,f.z);
  float hw=max(t*tanH/size.x,1e-4), hl=hw/max(sinB,0.003), hh=max(length(v.xy),1e-12);
  float ho=length(vec2(hw*dot(normal,vec2(-v.y,v.x))/hh,hl*dot(normal,v.xy)/hh));
  float rest=1.0; vec3 r=vec3(0), n=vec3(0,0,1);
  for(int i=0;i<128;i++) { if(i>=nMark) break; vec4 m=texelFetch(marks,ivec2(i,0),0), pat=texelFetch(marks,ivec2(i,1),0); bool cut=false;
    if(m.w>0.0) for(int j=0;j<16;j++) { if(j>=nSkip) break; if(s>skip[j].x && s<skip[j].y) cut=true; }
    if(cut) continue; float c=coverage(off,ho,m.x,m.y)*longitudinal(s,hl,pat); if(c<=0.0) continue;
    r+=c*shade(p,n,v,int(m.z)); rest-=c;
  }
  float e0=-lane/2.0, e1=1.5*lane;
  for(int i=0;i<16;i++) { if(i>=nCross) break; vec4 c=crossing[i]; float a=longitudinal(s,hl,vec4(c.x,c.y,1e9,c.y-c.x))*coverage(off,ho,c.z,c.w); if(a>0.0) { r+=a*rest*shade(p,n,v,0); rest*=1.0-a; } }
  if(rest>0.0) {
    r+=rest*coverage(off,ho,e0,e1)*shade(p,n,v,0);
    r+=rest*(coverage(off,ho,e0-vergeWidth,e0)+coverage(off,ho,e1,e1+vergeWidth))*shade(p,n,v,int(verge.x));
    r+=rest*(coverage(off,ho,-1e9,e0-vergeWidth)+coverage(off,ho,e1+vergeWidth,1e9))*shade(p,n,v,int(verge.y));
  }
  if(grain>0.0 && off>e0-vergeWidth && off<e1+vergeWidth) {
    float noise=0.0; for(int i=0;i<3;i++) { float scale=i==0?0.15:(i==1?0.6:2.4), weight=i==0?0.45:(i==1?0.35:0.2); float f=clamp((hl/scale-0.4)/0.8,0.0,1.0);
      noise+=weight*(1.0-f*f*(3.0-2.0*f))*sin((s+distance)/scale*2.7+sin(off/scale*3.1))*sin(off/scale*2.3+0.7); }
    r*=1.0+grain*noise;
  } return r;
}
void main() {
  vec3 ray=normalize(vec3(1.0,-screen.x*tanH,screen.y*tanH*size.y/size.x)); float t=ray.z < -1e-6 ? -eye.z/ray.z : 1e20;
  vec3 r; if(t<5000.0) { r=surface(eye+t*ray,-ray,t,-ray.z); if(sigma>0.0) { float T=exp(-sigma*t); r=r*T+ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(ray.z)*8.0))*(1.0-T); } }
  else r=vec3(ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(ray.z)*8.0)));
  if(scatterSteps>0) r+=inScatter(ray,t<5000.0?t:1e20,scatterJitter());
  if(haloOn>0) r+=haloScatter(t<5000.0?t:1e20);
  gl_FragColor=vec4(r,1);
}
`;

// Keep the original shader byte-for-byte when off: inactive branches can still change compiler rounding.
// Objects import the same ground prefix. Apply here to their materials, without touching model code.
// BA5: atlas = true reads each lamp's beam from the GPU atlas (beam-atlas.js) instead of the one otherBeam table.
// atlas = false is main's text, byte for byte (pinned by tests/beam-atlas.js).
const ATLAS_N = 16;
export const ATLAS_HEAD = `uniform vec4 beamMeta[${ATLAS_N}], beamGrid[${ATLAS_N}], beamTint[${ATLAS_N}], trafficBeamIdx[${ATLAS_N}];
int tbeam=0;
vec3 otint=vec3(1.0,1.0,0.93);
`;
export const OTHER_LEGACY = `float otherIntensity(vec3 d) {
  vec3 q=normalize(d); float a=q.x, b=-q.y, c=q.z; vec2 hv;
  if(otherConvention==1) hv=vec2(asin(clamp(b,-1.0,1.0)),atan(c,a));
  else if(otherConvention==2) { if(a<=0.0) return 0.0; hv=atan(vec2(b,c)/a); }
  else hv=vec2(atan(b,a),asin(clamp(c,-1.0,1.0)));
  vec2 f=(degrees(hv)-otherLutInfo.xy)/otherLutInfo.z-0.5, base=floor(f), t=f-base;
  if(any(lessThan(base,vec2(0)))||any(greaterThanEqual(base+1.0,otherLutSize))) return 0.0;
  ivec2 k=ivec2(base);
  return mix(mix(texelFetch(otherBeam,k,0).r,texelFetch(otherBeam,k+ivec2(1,0),0).r,t.x),mix(texelFetch(otherBeam,k+ivec2(0,1),0).r,texelFetch(otherBeam,k+ivec2(1,1),0).r,t.x),t.y);
}
`;
export const OTHER_ATLAS = `float otherIntensity(vec3 d) {
  vec3 q=normalize(d); float a=q.x, b=-q.y, c=q.z; vec2 hv;
  vec4 g=beamGrid[tbeam], m=beamMeta[tbeam], tn=beamTint[tbeam];
  int conv=int(tn.w+0.5);
  if(conv==1) hv=vec2(asin(clamp(b,-1.0,1.0)),atan(c,a));
  else if(conv==2) { if(a<=0.0) return 0.0; hv=atan(vec2(b,c)/a); }
  else hv=vec2(atan(b,a),asin(clamp(c,-1.0,1.0)));
  vec2 f=(degrees(hv)-g.xy)*g.zw-0.5, base=floor(f), t=f-base;
  if(any(lessThan(base,vec2(0)))||any(greaterThanEqual(base+1.0,m.yz))) return 0.0;
  ivec2 k=ivec2(base)+ivec2(0,int(m.x+0.5));
  return m.w*mix(mix(texelFetch(otherBeam,k,0).r,texelFetch(otherBeam,k+ivec2(1,0),0).r,t.x),mix(texelFetch(otherBeam,k+ivec2(0,1),0).r,texelFetch(otherBeam,k+ivec2(1,1),0).r,t.x),t.y);
}
`;
const LOOP_LEGACY = `  for(int i=0;i<64;i++) { if(i>=nTraffic) break; vec3 d=p-trafficLamp[i].xyz; float r2=dot(d,d), forward=dot(d.xy,trafficDir[i]);
    if(forward<=0.0 || r2<0.01) continue; float NoL=max(0.0,-dot(d,n)/sqrt(r2)); if(NoL<=0.0) continue;
    vec3 local=vec3(forward,dot(d.xy,vec2(-trafficDir[i].y,trafficDir[i].x)),d.z);
    r+=rho*vec3(1,1,0.93)*otherIntensity(local)*NoL/(PI*r2)*trafficLamp[i].w*fogT(sqrt(r2));
  }
`;
const LOOP_ATLAS = `  for(int i=0;i<64;i++) { if(i>=nTraffic) break; vec3 d=p-trafficLamp[i].xyz; float r2=dot(d,d), forward=dot(d.xy,trafficDir[i]);
    if(forward<=0.0 || r2<0.01) continue; float NoL=max(0.0,-dot(d,n)/sqrt(r2)); if(NoL<=0.0) continue;
    vec3 local=vec3(forward,dot(d.xy,vec2(-trafficDir[i].y,trafficDir[i].x)),d.z);
    tbeam=int(trafficBeamIdx[i>>2][i&3]+0.5); otint=vec3(1.0,1.0,0.93)*beamTint[tbeam].rgb;
    r+=rho*otint*otherIntensity(local)*NoL/(PI*r2)*trafficLamp[i].w*fogT(sqrt(r2));
  }
`;
export function withLighting(source, atlas = false) {
  if (!source.includes('float intensity(vec3 d) {') || !source.includes('  for(int i=0;i<2;i++)')) throw Error('P2 shared shading prefix changed');
  return source.replace('uniform sampler2D beam, materials, marks;\n', `uniform sampler2D beam, materials, marks, otherBeam;
uniform vec4 otherLutInfo;
uniform vec2 otherLutSize, trafficDir[64];
uniform vec4 trafficLamp[64];
uniform int nTraffic, otherConvention;
uniform float pitch, yaw;
uniform vec2 cornering;
` + (atlas ? ATLAS_HEAD : ''))
    .replace('float intensity(vec3 d) {\n', 'float intensity(vec3 d) {\n' + `  if(yaw!=0.0) { float c=cos(yaw), s=sin(yaw); d.xy=vec2(c*d.x+s*d.y,c*d.y-s*d.x); }
  if(pitch!=0.0) { float c=cos(pitch), s=sin(pitch); d=vec3(c*d.x+s*d.z,d.y,c*d.z-s*d.x); }
`)
    .replace('float I=intensity(d);', 'float I=intensity(d)+cornerIntensity(d,lamp[i]);')
    .replace('float beamI(vec3 d,vec3 origin) { return intensity(d); }', 'float beamI(vec3 d,vec3 origin) { return intensity(d)+cornerIntensity(d,origin); }')
    .replace('float wetLobe', `float cornerIntensity(vec3 d,vec3 origin) {
  if((cornering.x==0.0 && cornering.y==0.0) || d.x<=0.0 || d.z>=0.0)return 0.0;
  float h=atan(d.y,d.x), v=atan(d.z,length(d.xy)), rad=PI/180.0;
  return 400.0*exp(-0.5*pow((v+6.0*rad)/(7.0*rad),2.0))*((origin.y>=0.0 ? cornering.x : 0.0)*exp(-0.5*pow((h-55.0*rad)/(22.0*rad),2.0))+(origin.y<0.0 ? cornering.y : 0.0)*exp(-0.5*pow((h+55.0*rad)/(22.0*rad),2.0)));
}
${atlas ? OTHER_ATLAS : OTHER_LEGACY}` + 'float wetLobe')
    .replace('  for(int i=0;i<2;i++)', `${atlas ? LOOP_ATLAS : LOOP_LEGACY}` + '  for(int i=0;i<2;i++)');
}

// SD1 table (look.scatterMode 'table'). A pre-pass fills three RGBA half-float targets (banks) with 12 segment integrals of the
// same single-scatter integrand as inScatter (scalar; lampRGB multiplies at lookup). The lookup gives the cumulative value at a
// distance, interpolated in log d between edges 0.5 m .. 120 m. Direct mode never sees this text: tableSource() is applied only when
// the table is on, so the direct shader strings stay byte-identical. CPU twin: scatterTableBins / scatterTableAt in js/drive.js.
const TABLE_DECL = `uniform int scatMode;   // 1 = table mode: inScatter reads the table (SD1)
uniform sampler2D scatBank0, scatBank1, scatBank2;   // bins 0-3, 4-7, 8-11 (RGBA), at the table's resolution
uniform vec2 scatUV;   // 1 / (pixels of the target this pass draws): gl_FragCoord * scatUV is the table texture coordinate
// SM: the lookup takes its three texels as arguments, so the cycle crossfade can read a second bank set with the same code.
float tableCBanks(float d, vec4 a, vec4 b, vec4 c) {
  if(d<=0.0) return 0.0;
  float C=0.0, prevC=0.0, prevE=0.0;
  for(int k=0;k<12;k++) {
    float bin=k<4 ? a[k] : (k<8 ? b[k-4] : c[k-8]);
    float e=0.5*pow(240.0,float(k)/11.0);
    C+=bin;
    if(d<=e) return k==0 ? C*d/e : mix(prevC,C,log(d/prevE)/log(e/prevE));
    prevC=C; prevE=e;
  }
  return C;
}
float tableC(float d) {
  vec2 uv=gl_FragCoord.xy*scatUV;
  return tableCBanks(d, texture(scatBank0,uv), texture(scatBank1,uv), texture(scatBank2,uv));
}
// SM: cycle blend. scatFade 1 mixes the lookup of bank set A (scatBank0..2) and bank set B (scatBankB0..2) by scatFract; 0 reads A alone.
uniform sampler2D scatBankB0, scatBankB1, scatBankB2;
uniform float scatFade, scatFract;
float tableCMix(float d) {
  if(scatFade<0.5) return tableC(d);
  vec2 uv=gl_FragCoord.xy*scatUV;
  return mix(tableC(d), tableCBanks(d, texture(scatBankB0,uv), texture(scatBankB1,uv), texture(scatBankB2,uv)), scatFract);
}
vec3 inScatterDirect(vec3 dir,float sEnd,float jit);
// SF2: scatGain multiplies the lookup only (table mode); it never enters the table, so it does not rebuild it.
uniform float scatGain;
vec3 inScatter(vec3 dir,float sEnd,float jit) { return scatMode==1 ? tableCMix(min(sEnd,scatSMax))*lampRGB*scatGain : inScatterDirect(dir,sEnd,jit); }
`;
const TABLE_MAIN = `uniform int tableBank, tableSteps, tableSeed;
uniform int tableBias, tableBinN[12];   // NE: near-eye bias on; per-bin sample counts from RF.Drive.tableBinSteps (off: tableSteps formula)
uniform float tableH;
float tableJitter() { uint x=uint(gl_FragCoord.x), y=uint(tableH)-1u-uint(gl_FragCoord.y); uint h=(x*0x27d4eb2du)^(y*0x165667b1u)^(uint(tableSeed)*0x9e3779b9u); h=(h^(h>>15u))*0x85ebca6bu; h=(h^(h>>13u))*0xc2b2ae35u; h^=h>>16u; return float(h)/4294967296.0; }
// SE3: near-eye fade. tableFade 1 weights the integrand by smoothstep(S0,S1,s) (0 = the SD table, unchanged).
uniform float tableFade, tableFadeS0, tableFadeS1;   // SF2: the fade range (metres) is a uniform, set from look.scatterNearFadeRange
float tableIntegrand(vec3 dir,float s) {
  vec3 P=eye+s*dir; float f=0.0;
  float w=mix(1.0,smoothstep(tableFadeS0,tableFadeS1,s),tableFade);
  for(int i=0;i<2;i++) { if(i>=nLamp) break;
    vec3 d=P-lamp[i]; float r2=dot(d,d); if(r2<=0.0) continue; float r=sqrt(r2);
    float I=beamI(d,lamp[i]); if(I<=0.0) continue;
    float cs=-dot(d,dir)/r, p=scatWFwd*hgP(scatGFwd,cs)+(1.0-scatWFwd)*hgP(scatGBack,cs);
    float E=I/max(r2,scatRMin*scatRMin);
    f+=sigma*p*E*exp(-sigma*r)*exp(-sigma*s)*w;
  }
  return f;
}
void main() {
  vec3 ray=normalize(vec3(1.0,-screen.x*tanH,screen.y*tanH*size.y/size.x));
  float jit=tableJitter(); int n=max(1,(tableSteps+6)/12);
  vec4 outv=vec4(0.0);
  for(int j=0;j<4;j++) {
    int k=tableBank*4+j;
    int nk=tableBias==0 ? n : tableBinN[k];
    float hi=0.5*pow(240.0,float(k)/11.0), lo=k==0 ? 0.0 : 0.5*pow(240.0,float(k-1)/11.0);
    float acc=0.0;
    for(int m=0;m<64;m++) { if(m>=nk) break;   // NE4: constant bound 64 (was 32); the per-slice cap, the parser clamp and the presets all stop at 64
      if(k==0) { float ds=hi/float(nk), s=(float(m)+jit)*ds; acc+=tableIntegrand(ray,s)*ds; }
      else { float a=lo*pow(hi/lo,float(m)/float(nk)), b=lo*pow(hi/lo,float(m+1)/float(nk)), s=a*pow(b/a,jit); acc+=tableIntegrand(ray,s)*(b-a); }
    }
    outv[j]=acc;
  }
  gl_FragColor=outv;
}
`;
const DIRECT_HEAD = 'vec3 inScatter(vec3 dir,float sEnd,float jit) {';
// Table mode for a lit shader source: the direct in-scatter becomes the table lookup. Sources without the direct function pass through.
export function tableSource(source) {
  if (!source.includes(DIRECT_HEAD)) return source;
  return source.replace(DIRECT_HEAD, TABLE_DECL + DIRECT_HEAD.replace('inScatter(', 'inScatterDirect('));
}
// The table pass: the ground prefix (shading of the same look, lit or not) and the bin integrals in place of main.
export function tablePassSource(source) {
  return source.slice(0, source.indexOf('vec4 roadFrame')) + TABLE_MAIN;
}
// Separable Gaussian over the table (radius 6 texels), one axis per pass. sig 0 copies.
export const tableBlurSource = `uniform sampler2D src;
uniform vec2 texel, dirTexel;
uniform float sig;
void main() {
  vec2 uv=gl_FragCoord.xy*texel;
  if(sig<=0.0) { gl_FragColor=texture(src,uv); return; }
  vec4 acc=vec4(0.0); float wsum=0.0;
  for(int i=-6;i<=6;i++) { float w=exp(-0.5*float(i*i)/(sig*sig)); acc+=w*texture(src,uv+float(i)*dirTexel*texel); wsum+=w; }
  gl_FragColor=acc/wsum;
}
`;
