/* Same float32 node data, distances and march constants as Drive.Models (CPU reference). */
const M=globalThis.RF.Drive.Models;
export const sdf = `
uniform sampler2D sdfNodes;
uniform sampler2D treeCard;
float sdfId;
float modelDistance(vec3 p) {
 float best=1e20; sdfId=0.0;
 for(int i=0;i<${M.MAX_NODES};i++) {
  if(i>=int(planes.y))break;
  vec4 a=texelFetch(sdfNodes,ivec2(i*3,int(planes.x)),0),b=texelFetch(sdfNodes,ivec2(i*3+1,int(planes.x)),0),c=texelFetch(sdfNodes,ivec2(i*3+2,int(planes.x)),0);
  vec3 q=p-a.xyz;float d;
  if(b.w>0.5){float ca=c.x,sn=c.y;q.xy=vec2(ca*q.x+sn*q.y,-sn*q.x+ca*q.y);d=(length(q/b.xyz)-1.0)*min(b.x,min(b.y,b.z));}
  else {vec3 v=b.xyz-a.xyz;float h=clamp(dot(q,v)/max(1e-12,dot(v,v)),0.0,1.0);d=length(q-v*h)-a.w;}
  if(d<best)sdfId=c.w;
  float h=max(${M.BLEND}-abs(best-d),0.0)/${M.BLEND};best=min(best,d)-h*h*${M.BLEND*.25};
 }
 return best;
}
bool modelTrace(vec3 o,vec3 ray,out float t,out vec3 n,out float id,out float work) {
 float b=dot(o,ray),c=dot(o,o)-shape.x*shape.x,disc=b*b-c;work=0.0;
 if(disc<0.0)return false;
 t=max(.0001,-b-sqrt(disc));float end=-b+sqrt(disc);
 for(int i=0;i<${M.STEPS};i++) {
  if(t>=end)break;work+=1.0;
  vec3 p=o+t*ray;float d=modelDistance(p);
  if(d<${M.EPS}){id=sdfId;vec2 e=vec2(.001,0);n=normalize(vec3(modelDistance(p+e.xyy)-modelDistance(p-e.xyy),modelDistance(p+e.yxy)-modelDistance(p-e.yxy),modelDistance(p+e.yyx)-modelDistance(p-e.yyx)));return true;}
  t+=max(d*.8,.0005);
 }
 return false;
}
`;
