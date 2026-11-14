/* 100% fictional XY-coordinate demonstration dataset. Deliberately no real location. */
export const WORLD={width:1000,height:700};
export const buildings=[
  [95,105,145,115],[275,125,140,125],[475,82,125,147],[665,90,140,148],
  [72,310,160,105],[300,316,125,138],[505,310,138,118],[720,315,150,120],
  [130,500,155,125],[365,510,150,120],[605,490,142,128],[800,525,125,115],
  [425,220,45,45],[685,245,65,45]
];
export const roads=[[0,252,1000,36],[250,0,34,700],[452,0,28,700],[0,468,1000,27],[695,0,29,700]];
export const paths=[
  [[0,296],[1000,296]],[[0,505],[1000,505]],[[235,0],[235,700]],
  [[487,0],[487,700]],[[739,0],[739,700]],[[0,70],[1000,70]]
];
export const excluded=[{x:84,y:29,r:54,label:'가상 교육시설 보호구역'}];
export const park={x:812,y:18,w:176,h:121};
// Synthetic 100m and 250m statistics: deterministic, not real census or people counts.
const noise=(x,y)=>{const n=Math.sin(x*127.1+y*311.7)*43758.5453123;return n-Math.floor(n);};
export const residents=[];
for(let y=-150;y<=850;y+=100)for(let x=-150;x<=1150;x+=100){
 const density=0.40+0.39*Math.exp(-((x-490)**2+(y-370)**2)/90000)+0.22*Math.exp(-((x-150)**2+(y-530)**2)/70000);
 residents.push({x,y,pop:Math.round(55+490*density+100*noise(x,y))});
}
export const living=[];
for(let y=-125;y<=875;y+=250)for(let x=-125;x<=1125;x+=250){
 const base=1050+2500*Math.exp(-((x-520)**2+(y-260)**2)/130000)+650*noise(x,y);
 const hours=Array.from({length:24},(_,hour)=>base*(0.52+0.6*Math.exp(-(((hour-15)/6)**2))+0.15*noise(x+hour,y)));
 living.push({x,y,hours});
}
export function distanceRect(px,py,[x,y,w,h]){
 const dx=Math.max(x-px,0,px-(x+w));
 const dy=Math.max(y-py,0,py-(y+h));
 return Math.hypot(dx,dy);
}
export function inRect(px,py,[x,y,w,h],padding=0){return px>=x-padding&&px<=x+w+padding&&py>=y-padding&&py<=y+h+padding;}
export function distanceSegment(px,py,[a,b]){
 const dx=b[0]-a[0],dy=b[1]-a[1];
 const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/(dx*dx+dy*dy)));
 return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
}
export function rawLocation(x,y){
 if(x<2||x>998||y<2||y>698)return {x,y,status:'range',reason:'가상 분석 범위 밖'};
 if(buildings.some(r=>inRect(x,y,r,2)) || roads.some(r=>inRect(x,y,r,2)) || inRect(x,y,[park.x,park.y,park.w,park.h],2) || excluded.some(z=>Math.hypot(x-z.x,y-z.y)<z.r+2))
   return {x,y,status:'blocked',reason:'모형의 건물·차도·보호영역 중첩'};
 const wallM=Math.min(...buildings.map(r=>distanceRect(x,y,r)));
 const footActual=Math.min(...paths.map(s=>distanceSegment(x,y,s)));
 const nearResidents=residents.filter(c=>Math.hypot(x-c.x,y-c.y)<240);
 const resWeighted=nearResidents.reduce((s,c)=>s+c.pop*Math.max(0,1-Math.hypot(x-c.x,y-c.y)/240)**2,0);
 const resWeight=nearResidents.reduce((s,c)=>s+Math.max(0,1-Math.hypot(x-c.x,y-c.y)/240)**2,0);
 const resRaw=resWeight>0?resWeighted/resWeight:null;
 const nearby=living.reduce((best,c)=>Math.hypot(x-c.x,y-c.y)<Math.hypot(x-best.x,y-best.y)?c:best,living[0]);
 const hours=nearby.hours,sorted=hours.slice().sort((a,b)=>a-b);
 const p90=sorted[20]+(sorted[21]-sorted[20])*0.7;
 const livingRaw=0.75*(hours.reduce((s,v)=>s+v,0)/24)+0.25*p90;
 const parkBoundary=distanceRect(x,y,[park.x,park.y,park.w,park.h]);
 const circleBoundary=Math.min(...excluded.map(z=>Math.max(0,Math.hypot(x-z.x,y-z.y)-z.r)));
 const protectionDistance=Math.min(parkBoundary,circleBoundary);
 return {x,y,status:'scored',wallM:Math.min(50,wallM),footM:Math.min(25,footActual),footObserved:footActual<=25,resRaw,livingRaw,protectionDistance};
}
