/* Linear luminance only. Formula reference: drive.js; display passes stay in drive-anim.js. */
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
uniform float tanH, lane, vergeWidth, ambient, sheen, grain, distance;
uniform vec2 verge;
uniform vec2 arc;
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
vec3 shade(vec3 p,vec3 n,vec3 v,int id) {
  vec3 rho=texelFetch(materials,ivec2(id,0),0).rgb, retro=texelFetch(materials,ivec2(id,1),0).rgb;
  vec4 gloss=texelFetch(materials,ivec2(id,2),0); vec3 r=rho*ambient*(0.5+0.5*n.z)/PI;
  float NoV=dot(n,v);
  for(int i=0;i<64;i++) { if(i>=nLight) break; vec3 d=light[i].xyz-p; float r2=dot(d,d); if(d.z>0.0 && r2>=0.01) r+=rho*lightRGB[i]*light[i].w*max(0.0,dot(d,n))/(PI*r2*sqrt(r2)); }
  if(sheen>0.0 && (id==0||id==4)) for(int i=0;i<64;i++) { if(i>=nReflection) break; r+=reflection[i].w*wetLobe(reflection[i].xyz-p,v)*reflectionRGB[i]; }
  for(int i=0;i<2;i++) { if(i>=nLamp) break; vec3 d=p-lamp[i]; float r2=dot(d,d), rr=sqrt(r2), NoL=-dot(d,n)/rr; if(NoL<=0.0) continue;
    float I=intensity(d); if(I<=0.0) continue;
    if(sheen>0.0 && id==0) r+=vec3(I*wetLobe(-d,v));
    float Ep=I/r2; r+=rho*Ep*NoL/PI + retro*Ep;
    if(gloss.x>0.0 && NoV>0.0) { vec3 l=-d/rr, h=normalize(l+v); float NoH=dot(n,h), VoH=dot(v,h), a2=gloss.x*gloss.x, den=NoH*NoH*(a2-1.0)+1.0;
      float D=a2/(PI*den*den), F=gloss.y+(1.0-gloss.y)*pow(1.0-max(0.0,VoH),5.0), k=gloss.x/2.0;
      r+=vec3(D*F*(NoL/(NoL*(1.0-k)+k))*(NoV/(NoV*(1.0-k)+k))/(4.0*NoV)*Ep);
    }
  }
  return r*lampRGB;
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
  vec3 r; if(t<5000.0) r=surface(eye+t*ray,-ray,t,-ray.z);
  else r=vec3(ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(ray.z)*8.0)));
  gl_FragColor=vec4(r,1);
}
`;

// Keep the original shader byte-for-byte when off: inactive branches can still change compiler rounding.
// Objects import the same ground prefix. Apply here to their materials, without touching model code.
export function withLighting(source) {
  if (!source.includes('float intensity(vec3 d) {') || !source.includes('  for(int i=0;i<2;i++)')) throw Error('P2 shared shading prefix changed');
  return source.replace('uniform sampler2D beam, materials, marks;\n', `uniform sampler2D beam, materials, marks, otherBeam;
uniform vec4 otherLutInfo;
uniform vec2 otherLutSize, trafficDir[16];
uniform vec3 trafficLamp[16];
uniform int nTraffic, otherConvention;
uniform float pitch, yaw;
uniform vec2 cornering;
`)
    .replace('float intensity(vec3 d) {\n', 'float intensity(vec3 d) {\n' + `  if(yaw!=0.0) { float c=cos(yaw), s=sin(yaw); d.xy=vec2(c*d.x+s*d.y,c*d.y-s*d.x); }
  if(pitch!=0.0) { float c=cos(pitch), s=sin(pitch); d=vec3(c*d.x+s*d.z,d.y,c*d.z-s*d.x); }
`)
    .replace('float I=intensity(d);', 'float I=intensity(d)+cornerIntensity(d,lamp[i]);')
    .replace('float wetLobe', `float cornerIntensity(vec3 d,vec3 origin) {
  if((cornering.x==0.0 && cornering.y==0.0) || d.x<=0.0 || d.z>=0.0)return 0.0;
  float h=atan(d.y,d.x), v=atan(d.z,length(d.xy)), rad=PI/180.0;
  return 400.0*exp(-0.5*pow((v+6.0*rad)/(7.0*rad),2.0))*((origin.y>=0.0 ? cornering.x : 0.0)*exp(-0.5*pow((h-55.0*rad)/(22.0*rad),2.0))+(origin.y<0.0 ? cornering.y : 0.0)*exp(-0.5*pow((h+55.0*rad)/(22.0*rad),2.0)));
}
float otherIntensity(vec3 d) {
  vec3 q=normalize(d); float a=q.x, b=-q.y, c=q.z; vec2 hv;
  if(otherConvention==1) hv=vec2(asin(clamp(b,-1.0,1.0)),atan(c,a));
  else if(otherConvention==2) { if(a<=0.0) return 0.0; hv=atan(vec2(b,c)/a); }
  else hv=vec2(atan(b,a),asin(clamp(c,-1.0,1.0)));
  vec2 f=(degrees(hv)-otherLutInfo.xy)/otherLutInfo.z-0.5, base=floor(f), t=f-base;
  if(any(lessThan(base,vec2(0)))||any(greaterThanEqual(base+1.0,otherLutSize))) return 0.0;
  ivec2 k=ivec2(base);
  return mix(mix(texelFetch(otherBeam,k,0).r,texelFetch(otherBeam,k+ivec2(1,0),0).r,t.x),mix(texelFetch(otherBeam,k+ivec2(0,1),0).r,texelFetch(otherBeam,k+ivec2(1,1),0).r,t.x),t.y);
}
` + 'float wetLobe')
    .replace('  for(int i=0;i<2;i++)', `  for(int i=0;i<16;i++) { if(i>=nTraffic) break; vec3 d=p-trafficLamp[i]; float r2=dot(d,d), forward=dot(d.xy,trafficDir[i]);
    if(forward<=0.0 || r2<0.01) continue; float NoL=max(0.0,-dot(d,n)/sqrt(r2)); if(NoL<=0.0) continue;
    vec3 local=vec3(forward,dot(d.xy,vec2(-trafficDir[i].y,trafficDir[i].x)),d.z);
    r+=rho*vec3(1,1,0.93)*otherIntensity(local)*NoL/(PI*r2);
  }
` + '  for(int i=0;i<2;i++)');
}
