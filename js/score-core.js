/* SmokeSpot public demonstration scoring core.
 * Independent synthetic-only adaptation of v3.7.37 formulas and the later near-boundary deduction. No original GIS or API keys included.
 * These scores compare proxy indicators, not actual tobacco smoke exposure.
 */
export const PROFILES = Object.freeze({
  balance: { label:'보호 균형', weights:[35,25,25,15] },
  distance: { label:'건물·보행 이격', weights:[45,25,20,10] },
  population: { label:'인구 노출 회피', weights:[25,15,40,20] }
});
export const clamp = (v,min=0,max=1) => Math.max(min,Math.min(max,v));
export function quantile(values,q){
  const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
  if(!a.length)return null;
  const t=(a.length-1)*q,i=Math.floor(t);
  return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(t-i);
}
export function referenceFromRows(rows){
  const wall=rows.filter(r=>Number.isFinite(r.wallM)).map(r=>r.wallM);
  // Unobserved footpaths must not be treated as verified separation.
  const foot=rows.filter(r=>r.footObserved && Number.isFinite(r.footM)).map(r=>r.footM);
  const range=(a)=>{
    const lo=quantile(a,.1),hi=quantile(a,.9);
    return a.length>=6&&Number.isFinite(lo)&&Number.isFinite(hi)&&hi-lo>=1?[lo,hi]:null;
  };
  return { wall:range(wall), foot:range(foot), n:rows.length,footN:foot.length };
}
export const reverse=(v,lo,hi)=>Number.isFinite(v)&&Number.isFinite(lo)&&Number.isFinite(hi)&&hi>lo?clamp((hi-v)/(hi-lo)):null;
const relative=(value,range,fallback)=>range && Number.isFinite(value)?clamp((value-range[0])/(range[1]-range[0])):fallback;
export function scoreLocation(row,{profile='balance',method='mixed',reference,calibration,customWeights=null,penaltyEnabled=true}){
  const validCustom=Array.isArray(customWeights)&&customWeights.length===4&&customWeights.every(v=>Number.isInteger(v)&&v>=0&&v<=100)&&customWeights.reduce((a,b)=>a+b,0)===100;
  const weights=(profile==='custom'&&validCustom)?customWeights:(PROFILES[profile]?.weights||PROFILES.balance.weights);
  if(!row || row.status!=='scored') return null;
  const r=reverse(row.resRaw,calibration.Rlo,calibration.Rhi);
  const l=reverse(row.livingRaw,calibration.Llo,calibration.Lhi);
  if(!Number.isFinite(r)||!Number.isFinite(l)||!Number.isFinite(row.wallM)||!Number.isFinite(row.footM))return null;
  const absolute=[clamp(row.wallM/50),clamp(row.footM/25),r,l];
  const relativeFactors=[relative(row.wallM,reference?.wall,absolute[0]),row.footObserved?relative(row.footM,reference?.foot,absolute[1]):absolute[1],r,l];
  const mixed=[.75*absolute[0]+.25*relativeFactors[0],.75*absolute[1]+.25*relativeFactors[1],r,l];
  const sum=(f)=>f.reduce((s,x,i)=>s+x*weights[i],0);
  const absScore=sum(absolute),mixedScore=sum(mixed);
  // The local app uses a reference-boundary 0–10 point deduction. For this
  // synthetic-only demo, the 10 refers to arbitrary map units, NOT meters.
  // No penalty can overturn a blocked/excluded location.
  const distance=Number.isFinite(row.protectionDistance)?Math.max(0,row.protectionDistance):Infinity;
  const deduction=penaltyEnabled?Math.max(0,Math.min(10,10-distance)):0;
  const factors=method==='mixed'?mixed:absolute;
  const baseScore=sum(factors);
  return {score:Math.max(0,baseScore-deduction),prePenaltyScore:baseScore,nearbyPenalty:deduction,
    absScore:Math.max(0,absScore-deduction),mixedScore:Math.max(0,mixedScore-deduction),components:factors.map((v,i)=>v*weights[i]),factors,weights,
    footObserved:row.footObserved,wallM:row.wallM,footM:row.footM,
    relativeFactors, warnings:row.footObserved?[]:['25m 이내 보도 도형 미검출 — 실제 보행로 없음으로 단정 불가']};
}
export const scoreBand=s=>s<35?0:s<50?1:s<65?2:s<80?3:4;
export const BAND_COLORS=['#F1A6A0','#F3C38F','#F0D98C','#93D3BF','#42B594'];
// This is the same four-neighbour, five-band, max-cells flood-fill logic used
// for the sector grouping rules in the local v3.7.37 app. No GIS files needed.
export function groupSectors(cells,{maxCells=65}={}){
  const lookup=new Map(cells.map(r=>[`${r.i},${r.j}`,r]));
  const visited=new Set(),groups=[];
  const offsets=[[1,0],[-1,0],[0,1],[0,-1]];
  for(const [key,start] of lookup){
    if(visited.has(key))continue;
    const queue=[start],members=[];visited.add(key);
    for(let head=0;head<queue.length;head++){
      const r=queue[head];members.push(r);
      if(members.length>=maxCells)continue;
      for(const [di,dj] of offsets){
        if(queue.length>=maxCells)break;
        const nk=`${r.i+di},${r.j+dj}`,other=lookup.get(nk);
        if(!other||visited.has(nk)||scoreBand(other.p.score)!==scoreBand(start.p.score))continue;
        visited.add(nk);queue.push(other);
      }
    }
    groups.push(members);
  }
  groups.sort((a,b)=>{
    const k=c=>c.reduce((s,r)=>s+r.p.score,0)/c.length+Math.min(3,Math.sqrt(c.length)/3);
    return k(b)-k(a);
  });
  return groups.map((members,index)=>{
    const scores=members.map(x=>x.p.score),sum=scores.reduce((a,b)=>a+b,0);
    return {id:index+1,cells:members,average:sum/members.length,min:Math.min(...scores),max:Math.max(...scores),
      centroid:{x:members.reduce((a,r)=>a+r.x,0)/members.length,y:members.reduce((a,r)=>a+r.y,0)/members.length}};
  });
}
export function pickCandidates(rows,count=2,separation=15){
  if(count<=0)return [];
  const chosen=[];
  for(const row of rows.slice().sort((a,b)=>b.p.score-a.p.score)){
    if(row.wallM<5)continue; // hypothesis / manual-review guard, not a statutory distance
    if(chosen.every(v=>Math.hypot(v.x-row.x,v.y-row.y)>=separation))chosen.push(row);
    if(chosen.length===count)break;
  }
  return chosen;
}
