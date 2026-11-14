import {PROFILES,quantile,referenceFromRows,scoreLocation,scoreBand,BAND_COLORS,groupSectors,pickCandidates} from './score-core.js';
import {WORLD,buildings,roads,paths,excluded,park,rawLocation} from './synthetic-data.js';

const $=id=>document.getElementById(id),canvas=$('mapCanvas'),wrap=$('canvasWrap'),ctx=canvas.getContext('2d');
const state={center:{x:835,y:275},radius:100,model:'mixed',profile:'balance',customWeights:[35,25,25,15],penaltyEnabled:true,candidateCount:2,pick:false,visible:true,
  full:[],sectors:[],selectedSector:null,refined:[],candidates:[],activeCandidate:null,hoverSector:null,stage:'full',
  reference:null,calibration:null,lastPointer:null,transform:{scale:1,dx:0,dy:0},ready:false};
const fmt=x=>Number.isFinite(x)?x.toFixed(1):'—';
const setStatus=s=>{$('status').textContent=s;};
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function deriveCalibration(){
  const all=[];
  for(let y=24;y<WORLD.height;y+=25)for(let x=24;x<WORLD.width;x+=25){
    const row=rawLocation(x,y);if(row.status==='scored')all.push(row);
  }
  const range=(k)=>[quantile(all.map(r=>r[k]),.1),quantile(all.map(r=>r[k]),.9)];
  const [Rlo,Rhi]=range('resRaw'),[Llo,Lhi]=range('livingRaw');
  state.calibration={Rlo,Rhi,Llo,Lhi};
}
function sampleArea(){
  const rows=[],blocked=[];
  const step=10,r=state.radius,center=state.center,n=Math.ceil(r/step);
  for(let j=-n;j<=n;j++)for(let i=-n;i<=n;i++){
    const x=center.x+i*step,y=center.y+j*step;
    if(Math.hypot(x-center.x,y-center.y)>r+1e-4)continue;
    const raw=rawLocation(x,y),row={...raw,i,j,size:step};
    if(row.status==='scored')rows.push(row);else blocked.push(row);
  }
  return {rows,blocked};
}
function scoreOptions(){return {profile:state.profile,customWeights:state.customWeights,penaltyEnabled:state.penaltyEnabled,method:state.model,reference:state.reference,calibration:state.calibration};}
function runSearch(){
  state.model=$('model').value;state.profile=$('profile').value;
  state.stage='full';state.selectedSector=null;state.candidates=[];state.activeCandidate=null;
  const {rows,blocked}=sampleArea();
  state.reference=referenceFromRows(rows);
  state.full=rows.map(row=>({...row,p:scoreLocation(row,scoreOptions())})).filter(r=>r.p);
  state.blocked=blocked;
  state.sectors=groupSectors(state.full,{maxCells:65});
  state.activeSectorIndex=new Map();
  for(const s of state.sectors)for(const c of s.cells)state.activeSectorIndex.set(`${c.i},${c.j}`,s);
  state.ready=true;setStatus('분석 완료');
  $('metricCells').textContent=state.full.length.toLocaleString();$('metricSectors').textContent=state.sectors.length.toLocaleString();
  $('mapTitle').textContent=`반경 ${state.radius} · 전체 섹터`;
  $('stageInfo').textContent=`${state.full.length}개 격자를 평가하고 ${state.sectors.length}개 섹터로 묶었어. 색이 있는 섹터를 클릭해 정밀 분석해 봐.`;
  $('back').hidden=true;
  showIntro();render();
}
function refineSelected(){
  const sector=state.selectedSector;
  if(!sector)return;
  // Refine the four 5m subcells of each chosen 10m cell; keep the ORIGINAL
  // 10m full-area reference, never re-normalize within the selected sector.
  const refined=[];
  for(const cell of sector.cells)for(const [dx,dy] of [[-2.5,-2.5],[2.5,-2.5],[-2.5,2.5],[2.5,2.5]]){
    const x=cell.x+dx,y=cell.y+dy,raw=rawLocation(x,y);
    if(raw.status!=='scored')continue;
    const p=scoreLocation(raw,scoreOptions());
    if(p)refined.push({...raw,p,i:Math.round(x*2),j:Math.round(y*2),size:5});
  }
  state.refined=refined;state.candidates=pickCandidates(refined,state.candidateCount,15);state.activeCandidate=null;state.stage='refined';
  $('mapTitle').textContent=`섹터 ${sector.id} · 5 단위 정밀 분석`;
  $('back').hidden=false;setStatus('정밀 분석 완료');
  $('stageInfo').textContent=`섹터 ${sector.id}에서 ${refined.length}개 세부 격자를 평가했어. 추천 위치는 ${state.candidates.length}곳이야.`;
  renderCandidateList();render();
}
function showIntro(){
  $('detailTitle').textContent='섹터를 선택하세요';
  $('detailLead').textContent='색이 있는 구역을 클릭하면 내부 점수, 비교 결과, 정밀 분석을 확인할 수 있어요.';
  $('detailContent').innerHTML='<div class="empty"><span>▥</span><p>섹터·추천 위치의 평가 근거가 여기에 표시됩니다.</p></div>';
}
function showSector(sector){
  if(!sector)return;
  state.selectedSector=sector;state.stage='full';state.activeCandidate=null;
  $('detailTitle').textContent=`섹터 ${sector.id}`;
  $('detailLead').textContent='이 구역은 점수 수준이 비슷한 인접 격자들을 러프하게 묶은 결과예요. 실제 토지 경계가 아니에요.';
  const abs=sector.cells.reduce((a,c)=>a+c.p.absScore,0)/sector.cells.length;
  const mix=sector.cells.reduce((a,c)=>a+c.p.mixedScore,0)/sector.cells.length;
  $('detailContent').innerHTML=`<div class="detail-metric"><small>선택한 평가 방식 · 구역 평균</small><strong>${fmt(sector.average)} <small>/ 100</small></strong></div>
    <div class="detail-row"><span>점수 범위</span><b>${fmt(sector.min)} – ${fmt(sector.max)}</b></div>
    <div class="detail-row"><span>평가 격자</span><b>${sector.cells.length}개</b></div>
    <div class="detail-row"><span>고정거리 평가 평균</span><b>${fmt(abs)}</b></div>
    <div class="detail-row"><span>지역 비교 반영 평균</span><b>${fmt(mix)}</b></div>
    <button id="refineBtn" class="detail-button">이 섹터 정밀 분석 · 후보 추천</button><p class="detail-note">이 구역은 모형의 평가 결과이며 실제 설치 적법성이나 연기 노출 안전을 보장하지 않아요.</p>`;
  $('refineBtn').onclick=refineSelected;render();
}
function showCell(cell){
  if(!cell?.p)return;
  $('detailTitle').textContent='선택 격자 · 보호 점수';
  $('detailLead').textContent='정밀 분석된 격자 한 곳의 점수를 확인합니다. 추천 위치와는 별도예요.';
  $('detailContent').innerHTML=`<div class="detail-metric"><small>보호점수</small><strong>${fmt(cell.p.score)} <small>/100</small></strong></div>
    <div class="detail-row"><span>고정거리 평가</span><b>${fmt(cell.p.absScore)}</b></div>
    <div class="detail-row"><span>지역 비교 반영</span><b>${fmt(cell.p.mixedScore)}</b></div>
    <div class="detail-row"><span>건물 경계 거리</span><b>${fmt(cell.wallM)} 단위</b></div>
    <div class="detail-row"><span>보도 경계 거리</span><b>${fmt(cell.footM)} 단위</b></div>
    <button id="showRecommended" class="detail-button">추천 위치 목록으로</button>
    <p class="detail-note">가상의 좌표와 데이터이므로 실제 설치 판단에는 사용할 수 없어요.</p>`;
  $('showRecommended').onclick=renderCandidateList;
}
function renderCandidateList(){
  const sector=state.selectedSector;
  $('detailTitle').textContent=`섹터 ${sector.id} · 정밀 분석`;
  $('detailLead').textContent='선택 섹터만 5단위 격자로 재평가했어요. 전체 탐색 영역의 상대평가 기준은 그대로 유지합니다.';
  $('detailContent').innerHTML=`<div class="detail-metric"><small>정밀 평가 완료</small><strong>${state.refined.length} <small>격자</small></strong></div>
    <div class="detail-row"><span>추천 후보</span><b>${state.candidates.length}곳</b></div>
    ${state.candidates.length?state.candidates.map((c,i)=>`<button class="cand-btn" data-candidate="${i}"><strong>추천 ${i+1} · 보호점수 ${fmt(c.p.score)}점</strong><small>고정거리 ${fmt(c.p.absScore)} · 지역 비교 ${fmt(c.p.mixedScore)}</small></button>`).join(''):'<p class="detail-note">조건에 맞는 추천 위치가 없어요. 5m 미만 건물 근접 지점은 자동 추천하지 않습니다.</p>'}
    <p class="detail-note">자동 후보는 검토 지점일 뿐 법적·관리상 설치 가능 판정이 아니에요.</p>`;
  document.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>showCandidate(Number(b.dataset.candidate)));
}
function showCandidate(index){
 const c=state.candidates[index];if(!c)return;
 state.activeCandidate=index;
 $('detailTitle').textContent=`추천 위치 ${index+1}`;
 $('detailLead').textContent='재떨이·표지형 야외 흡연 지점에 대한 공간 보호 대리지표입니다.';
 $('detailContent').innerHTML=`<div class="detail-metric"><small>선택한 평가 방식</small><strong>${fmt(c.p.score)} <small>/ 100</small></strong></div>
 <div class="detail-row"><span>고정거리 평가</span><b>${fmt(c.p.absScore)}</b></div><div class="detail-row"><span>지역 비교 반영</span><b>${fmt(c.p.mixedScore)}</b></div>
 <div class="detail-row"><span>건물 경계 거리</span><b>${fmt(c.wallM)} (최대 50)</b></div>
 <div class="detail-row"><span>보도 경계 거리</span><b>${fmt(c.footM)} (최대 25)</b></div>
 <div class="detail-row"><span>네 항목 합계</span><b>${fmt(c.p.prePenaltyScore)}점</b></div>
 <div class="detail-row"><span>보호시설 가까움 감점</span><b>${state.penaltyEnabled?'−'+fmt(c.p.nearbyPenalty)+'점':'OFF'}</b></div>
 ${['건물 이격','보도 이격','주거인구','생활인구'].map((s,i)=>`<div class="detail-row"><span>${s}</span><b>${fmt(c.p.components[i])} / ${c.p.weights[i]}</b></div>`).join('')}
 ${c.p.warnings.map(s=>`<p class="detail-note">${escapeHTML(s)}</p>`).join('')}
 <p class="detail-note">토지 권리, 인허가, 출입구·환기구, 실제 보행 및 관리 여부는 미확인입니다.</p>
 <button class="detail-button" id="showOther">다른 추천 후보 보기</button>`;
 $('showOther').onclick=renderCandidateList;render();
}
function mapTransform(){
 const w=canvas.clientWidth||900,h=canvas.clientHeight||600;
 const dpr=Math.min(2,window.devicePixelRatio||1);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const mobile=w<700;
 const scale=mobile?Math.max(w/WORLD.width,h/WORLD.height):Math.min(w/WORLD.width,h/WORLD.height);
 const dx=mobile?w/2-state.center.x*scale:(w-WORLD.width*scale)/2;
 const dy=mobile?h/2-state.center.y*scale:(h-WORLD.height*scale)/2;
 state.transform={scale,dx,dy};
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 ctx.translate(dx,dy);ctx.scale(scale,scale);
}
function drawBackground(){
 ctx.fillStyle='#EDF2EC';ctx.fillRect(0,0,WORLD.width,WORLD.height);
 ctx.strokeStyle='#D6E4D9';ctx.lineWidth=1;
 for(let x=0;x<=WORLD.width;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,WORLD.height);ctx.stroke();}
 for(let y=0;y<=WORLD.height;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(WORLD.width,y);ctx.stroke();}
 ctx.fillStyle='#D8E8D6';ctx.fillRect(park.x,park.y,park.w,park.h);
 ctx.fillStyle='#6D9278';ctx.font='700 15px system-ui';ctx.fillText('가상 녹지',park.x+20,park.y+63);
 // Roads
 for(const [x,y,w,h] of roads){ctx.fillStyle='#FFFFFF';ctx.fillRect(x-4,y-4,w+8,h+8);ctx.fillStyle='#CAD8CF';ctx.fillRect(x,y,w,h);}
 ctx.lineWidth=2;ctx.strokeStyle='#f3f6f1';ctx.setLineDash([8,13]);
 for(const [x,y,w,h] of roads){ctx.beginPath();if(w>h){ctx.moveTo(x,y+h/2);ctx.lineTo(x+w,y+h/2);}else{ctx.moveTo(x+w/2,y);ctx.lineTo(x+w/2,y+h);}ctx.stroke();}
 ctx.setLineDash([]);
 // Walk paths
 ctx.strokeStyle='#e6eee5';ctx.lineWidth=10;
 for(const [a,b] of paths){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
 ctx.strokeStyle='#9caea4';ctx.lineWidth=2;ctx.setLineDash([3,7]);
 for(const [a,b] of paths){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}ctx.setLineDash([]);
 for(const [x,y,w,h] of buildings){
  ctx.shadowColor='rgba(61,82,67,.09)';ctx.shadowBlur=10;ctx.shadowOffsetY=3;
  ctx.fillStyle='#D6DED4';ctx.fillRect(x,y,w,h);
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.strokeStyle='#B7C5B9';ctx.lineWidth=1.5;ctx.strokeRect(x,y,w,h);
 }
 const z=excluded[0];ctx.fillStyle='rgba(206,144,146,.17)';ctx.beginPath();ctx.arc(z.x,z.y,z.r,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='rgba(183,115,116,.45)';ctx.lineWidth=2;ctx.stroke();
 ctx.fillStyle='#a37372';ctx.font='12px system-ui';ctx.fillText('가상 보호구역',100,39);
 ctx.fillStyle='#7c9083';ctx.font='12px system-ui';ctx.fillText('가상 상가 지역',385,34);
 ctx.fillText('가상 주거 지역',775,674);
}
function drawBoundary(cell,lookup,selectedID){
 const half=cell.size/2,x=cell.x,y=cell.y,i=cell.i,j=cell.j,edges=[[1,0,x+half,y-half,x+half,y+half],[-1,0,x-half,y-half,x-half,y+half],[0,1,x-half,y+half,x+half,y+half],[0,-1,x-half,y-half,x+half,y-half]];
 ctx.beginPath();for(const [di,dj,x1,y1,x2,y2] of edges){if(lookup.get(`${i+di},${j+dj}`)!==selectedID){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}}
 ctx.stroke();
}
function render(){
 mapTransform();drawBackground();
 if(state.ready){
  ctx.lineWidth=2.5;ctx.strokeStyle='rgba(22,65,52,.55)';ctx.setLineDash([6,6]);ctx.beginPath();ctx.arc(state.center.x,state.center.y,state.radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  if(state.visible){
   ctx.save();ctx.beginPath();ctx.arc(state.center.x,state.center.y,state.radius,0,Math.PI*2);ctx.clip();ctx.fillStyle='rgba(26,43,40,.30)';ctx.fillRect(state.center.x-state.radius,state.center.y-state.radius,state.radius*2,state.radius*2);ctx.restore();
   const rows=state.stage==='full'?state.full:state.refined;
   for(const cell of rows){
     const sector=state.activeSectorIndex.get(`${cell.i},${cell.j}`);
     const isSelected=state.stage==='refined'||!state.selectedSector||sector?.id===state.selectedSector.id;
     ctx.globalAlpha=isSelected?.92:.37;
     ctx.fillStyle=BAND_COLORS[scoreBand(cell.p.score)];
     ctx.fillRect(cell.x-cell.size/2+.45,cell.y-cell.size/2+.45,cell.size-.9,cell.size-.9);
   }ctx.globalAlpha=1;
   if(state.stage==='full'){
     ctx.strokeStyle='rgba(255,255,255,.94)';ctx.lineWidth=2.7;
     for(const cell of state.full){
       const s=state.activeSectorIndex.get(`${cell.i},${cell.j}`);
       if(state.selectedSector && s?.id!==state.selectedSector.id)continue;
       drawBoundary(cell,state.activeSectorIndex,s?.id);
     }
   }
  }
  ctx.fillStyle='#1d5e48';ctx.strokeStyle='white';ctx.lineWidth=3;ctx.beginPath();ctx.arc(state.center.x,state.center.y,5.5,0,Math.PI*2);ctx.fill();ctx.stroke();
  if(state.stage==='refined'){
    for(const [i,c] of state.candidates.entries()){
      ctx.fillStyle=state.activeCandidate===i?'#173c2c':'#186b4a';ctx.strokeStyle='#fff';ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(c.x,c.y,13.5,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='800 14px system-ui';ctx.fillText(i+1,c.x,c.y+1);ctx.textAlign='left';ctx.textBaseline='alphabetic';
    }
  }
 }
}
function coordsForEvent(e){
 const rect=canvas.getBoundingClientRect(),px=e.clientX-rect.left,py=e.clientY-rect.top;
 const {scale,dx,dy}=state.transform;
 return {x:(px-dx)/scale,y:(py-dy)/scale,px,py};
}
function hitCell(pos){
 const cells=state.stage==='full'?state.full:state.refined;
 return cells.find(r=>Math.abs(pos.x-r.x)<=r.size/2&&Math.abs(pos.y-r.y)<=r.size/2);
}
function hover(e){
 if(!state.ready||state.pick){$('tooltip').hidden=true;return;}
 const pos=coordsForEvent(e),hit=hitCell(pos);
 const box=$('tooltip');
 if(hit){
  const s=state.stage==='full'?state.activeSectorIndex.get(`${hit.i},${hit.j}`):state.selectedSector;
  box.innerHTML=`<b>${s?'섹터 '+s.id+' · ':''}보호점수 ${fmt(hit.p.score)}점</b><div>기존 ${fmt(hit.p.absScore)} · 혼합 ${fmt(hit.p.mixedScore)}</div><div>클릭해 상세 정보 보기</div>`;
 }else if(Math.hypot(pos.x-state.center.x,pos.y-state.center.y)<=state.radius){
  const raw=rawLocation(pos.x,pos.y);
  box.textContent=raw.status==='scored'?'격자 중앙이 아니어서 점수가 표시되지 않은 위치':raw.reason||'평가 제외 또는 미산정';
 }else{box.hidden=true;return;}
 box.style.left=Math.max(7,Math.min(canvas.clientWidth-232,pos.px+15))+'px';
 box.style.top=Math.max(7,Math.min(canvas.clientHeight-89,pos.py+15))+'px';box.hidden=false;
}
function clickMap(e){
 const pos=coordsForEvent(e);
 if(state.pick){state.pick=false;$('focusHint').hidden=true;state.center={x:Math.max(25,Math.min(975,pos.x)),y:Math.max(25,Math.min(675,pos.y))};runSearch();return;}
 if(state.stage==='refined'){
  const ix=state.candidates.findIndex(c=>Math.hypot(c.x-pos.x,c.y-pos.y)<17);
  if(ix>=0){showCandidate(ix);return;}
 }
 const hit=hitCell(pos);
 if(hit){
  if(state.stage==='full')showSector(state.activeSectorIndex.get(`${hit.i},${hit.j}`));
  else showCell(hit);
 }else if(Math.hypot(pos.x-state.center.x,pos.y-state.center.y)<=state.radius){
  const raw=rawLocation(pos.x,pos.y);
  const reason=raw.status==='scored'?'색이 없는 지점은 해당 평가 격자의 중심이 아닐 수 있어요. 격자 간격은 10 단위예요.':raw.reason||'평가 불가';
  $('detailTitle').textContent='빈 공간의 의미';$('detailLead').textContent='0점이 아니라 별도로 평가되지 않은 위치예요.';
  $('detailContent').innerHTML=`<p class="detail-note">${escapeHTML(reason)}</p><button class="detail-button" id="returnDetail">섹터 목록으로</button>`;
  $('returnDetail').onclick=()=>{state.selectedSector=null;showIntro();render();};
 }
}
function back(){state.stage='full';state.candidates=[];state.activeCandidate=null;$('back').hidden=true;$('mapTitle').textContent=`반경 ${state.radius} · 전체 섹터`;if(state.selectedSector)showSector(state.selectedSector);else showIntro();render();}
// Custom allocation controls use the same 100-point total as the local model.
const CUSTOM_LABELS=['건물 거리','보도 거리','주거인구','생활인구'];
const CUSTOM_KEYS=['balance','distance','population'];
function redistributeWeights(index,value){
 const old=state.customWeights.slice();
 const target=Math.max(0,Math.min(100,Math.round(value)));
 const otherIds=[0,1,2,3].filter(i=>i!==index);
 const remaining=100-target;
 const prev=otherIds.reduce((s,i)=>s+old[i],0);
 const v=Array(4).fill(0);v[index]=target;
 if(prev>0){
   let used=0;
   for(const i of otherIds.slice(0,-1)){v[i]=Math.floor(remaining*old[i]/prev);used+=v[i];}
   v[otherIds.at(-1)]=remaining-used;
 }else{const q=Math.floor(remaining/3);otherIds.forEach((i,k)=>v[i]=k<2?q:remaining-q*2);}
 state.customWeights=v;
}
function renderCustomWeights(){
 $('customPanel').hidden=state.profile!=='custom';
 const root=$('customSliders');if(state.profile!=='custom')return;
 const colors={balance:'#e99b32',distance:'#3782ed',population:'#9465c6'};
 root.innerHTML=CUSTOM_LABELS.map((label,i)=>{
 const marks=CUSTOM_KEYS.map(k=>({v:PROFILES[k].weights[i],color:colors[k]}));
 const groups=[...new Set(marks.map(m=>m.v))];
 return `<div class="weight-item"><div class="weight-label"><b>${label}</b><strong id="weightValue${i}">${state.customWeights[i]}점</strong></div><div class="weight-range"><input type="range" min="0" max="100" step="1" data-weight="${i}" value="${state.customWeights[i]}" aria-label="${label} 배점">${groups.map(v=>{const m=marks.filter(x=>x.v===v);return `<i class="weight-tick" style="left:calc(8px + (100% - 16px)*${v/100});background:${m.length>1?'linear-gradient(90deg,'+m.map((x,j)=>x.color+' '+(j*100/m.length)+'% '+((j+1)*100/m.length)+'%').join(',')+')':m[0].color}" title="${m.map(x=>x.color===colors.balance?'보호 균형':x.color===colors.distance?'건물·보행 이격':'인구 노출 회피').join(' · ')} ${v}점"></i>`}).join('')}</div></div>`;
 }).join('');
 root.querySelectorAll('[data-weight]').forEach(el=>el.addEventListener('input',()=>{
 redistributeWeights(Number(el.dataset.weight),Number(el.value));
 // Change numeric labels and other thumbs without redrawing the active thumb.
 root.querySelectorAll('[data-weight]').forEach(input=>{const idx=Number(input.dataset.weight);input.value=state.customWeights[idx];$('weightValue'+idx).textContent=state.customWeights[idx]+'점';});
 runSearch();
 }));
}
$('customPanel').querySelectorAll('[data-preset]').forEach(btn=>btn.onclick=()=>{
 state.customWeights=[...PROFILES[btn.dataset.preset].weights];
 $('profile').value='custom';state.profile='custom';renderCustomWeights();runSearch();
});
$('penaltyEnabled').onchange=()=>{state.penaltyEnabled=$('penaltyEnabled').checked;runSearch();};
$('candidateCount').onchange=()=>{state.candidateCount=Number($('candidateCount').value);runSearch();};
$('run').onclick=()=>runSearch();
$('pick').onclick=()=>{state.pick=!state.pick;$('focusHint').hidden=!state.pick;setStatus(state.pick?'중심 선택 중':'준비됨');$('tooltip').hidden=true;};
$('back').onclick=back;
$('toggleTiles').onclick=()=>{state.visible=!state.visible;$('toggleTiles').textContent=`▦ 점수 지도 ${state.visible?'ON':'OFF'}`;render();};
$('model').onchange=()=>runSearch();$('profile').onchange=()=>{state.profile=$('profile').value;renderCustomWeights();runSearch();};
$('radiusControl').querySelectorAll('button').forEach(btn=>btn.onclick=()=>{state.radius=Number(btn.dataset.radius);$('radiusControl').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===btn));runSearch();});
canvas.addEventListener('mousemove',hover);canvas.addEventListener('mouseleave',()=>{$('tooltip').hidden=true;});canvas.addEventListener('click',clickMap);
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.pick){state.pick=false;$('focusHint').hidden=true;setStatus('준비됨');}});
window.addEventListener('resize',render);
// Expose minimal read-only diagnostic state to automated smoke tests; never stores user data.
window.__SMOKESPOT_DEMO_TEST__={state,runSearch,refineSelected,rawLocation};
deriveCalibration();renderCustomWeights();runSearch();
