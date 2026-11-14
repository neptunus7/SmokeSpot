import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreLocation,referenceFromRows,pickCandidates} from '../js/score-core.js';
const base={status:'scored',wallM:30,footM:15,footObserved:true,resRaw:90,livingRaw:300,protectionDistance:5};
const calibration={Rlo:0,Rhi:100,Llo:0,Lhi:1000};
const reference=referenceFromRows(Array.from({length:12},(_,i)=>({wallM:4+i*4,footM:2+i*2,footObserved:true})));
const opts={calibration,reference,method:'absolute'};
test('nearby synthetic-protection deduction is one maximum, not repeated',()=>{
 const yes=scoreLocation(base,{...opts,penaltyEnabled:true});
 const no=scoreLocation(base,{...opts,penaltyEnabled:false});
 assert.equal(yes.nearbyPenalty,5);
 assert.equal(no.nearbyPenalty,0);
 assert.equal(Number((no.score-yes.score).toFixed(8)),5);
 assert.equal(yes.prePenaltyScore,no.score);
 assert.equal(scoreLocation({...base,protectionDistance:10},{...opts}).nearbyPenalty,0);
 assert.equal(scoreLocation({...base,protectionDistance:0},{...opts}).nearbyPenalty,10);
});
test('custom weights accept 100 total and exclude invalid setting',()=>{
 const a=scoreLocation(base,{...opts,profile:'custom',customWeights:[10,20,30,40]});
 const b=scoreLocation(base,{...opts,profile:'custom',customWeights:[20,20,20,20]});
 assert.deepEqual(a.weights,[10,20,30,40]);
 assert.deepEqual(b.weights,[35,25,25,15]);
});
test('excluded points remain unscored irrespective of nearby toggle',()=>{
 for(const enabled of [true,false])assert.equal(scoreLocation({...base,status:'blocked'},{...opts,penaltyEnabled:enabled}),null);
});
test('zero candidates means zero candidates',()=>{
 const rows=[0,1,2].map(i=>({...base,x:i*20,y:0,p:{score:70-i}}));
 assert.equal(pickCandidates(rows,0).length,0);
 assert.equal(pickCandidates(rows,1).length,1);
 assert.equal(pickCandidates(rows,2).length,2);
});
