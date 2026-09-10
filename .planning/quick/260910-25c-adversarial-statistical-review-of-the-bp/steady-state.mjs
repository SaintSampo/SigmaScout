// Steady-state analysis of the PROMOTED BPR filter (frozen-params.json).
// Pure recursion algebra: no corpus, no holdout, no tuning.
const P={obsSd:1,qSlow:0.00002,rhoFast:0.9,qFast:0.015,priorVar:0.1,fastPriorVar:0.25,seasonVar:0.03,w2:0.7,w3:0.5};
const base=[1,P.w2,P.w3], raw=base.reduce((a,b)=>a+b,0), norm=3/raw;
const W=base.map(b=>b*norm);
console.log(`renormalized weights (rank1,2,3) = ${W.map(w=>w.toFixed(4)).join(', ')}`);
console.log(`sum w = ${W.reduce((a,b)=>a+b,0).toFixed(4)}   sum w^2 = ${W.reduce((a,b)=>a+b*b,0).toFixed(4)}  (additive model: 3.0000 / 3.0000)`);

// Homogeneous league: 3 identical teams per alliance, rotating rank slots so
// each team sees each weight equally often.
function run(nMatches, init){
  let t=[0,1,2].map(()=>({pL:init.pL,pS:init.pS}));
  const rows=[];
  for(let m=0;m<nMatches;m++){
    const w=[0,1,2].map(i=>W[(i+m)%3]);
    const pv=t.reduce((a,s,i)=>a+w[i]*w[i]*(s.pL+s.pS),0);
    const sTot=pv+P.obsSd**2;
    t=t.map((s,i)=>{
      const kL=w[i]*s.pL/sTot, kS=w[i]*s.pS/sTot;
      let pL=s.pL-kL*w[i]*s.pL, pS=s.pS-kS*w[i]*s.pS;
      pL=Math.max(1e-6,pL)+P.qSlow;
      pS=P.rhoFast**2*Math.max(1e-6,pS)+P.qFast;
      return{pL,pS,kL,kS};
    });
    rows.push({m:m+1,...t[0]});
  }
  return rows;
}
const rows=run(400,{pL:P.priorVar,pS:P.fastPriorVar});
console.log('\n match |      pL |      pS | pS/(pL+pS) = share of each update that DECAYS');
for(const m of [1,2,3,5,10,20,40,80,160,400]){
  const r=rows[m-1];
  console.log(` ${String(r.m).padStart(5)} | ${r.pL.toFixed(5)} | ${r.pS.toFixed(5)} |  ${(100*r.pS/(r.pL+r.pS)).toFixed(1)}%`);
}
const ss=rows[399];
console.log(`\nSTEADY STATE (match 400): pL=${ss.pL.toFixed(5)}  pS=${ss.pS.toFixed(5)}   pS/pL = ${(ss.pS/ss.pL).toFixed(1)}x`);
console.log(`  -> ${(100*ss.pS/(ss.pL+ss.pS)).toFixed(1)}% of every rating update lands in the fast component,`);
console.log(`     which decays by rhoFast=${P.rhoFast} per match (half-life ${(Math.log(0.5)/Math.log(P.rhoFast)).toFixed(1)} matches).`);
console.log(`  -> only ${(100*ss.pL/(ss.pL+ss.pS)).toFixed(1)}% is permanent, and muS is ZEROED at every season boundary.`);

// What a season boundary does: pL += seasonVar, pS reset to fastPriorVar.
console.log('\n--- season boundary: pL += seasonVar(0.03), pS := fastPriorVar(0.25), muS := 0 ---');
const y2=run(60,{pL:ss.pL+P.seasonVar,pS:P.fastPriorVar});
for(const m of [1,5,10,20,40,60]){
  const r=y2[m-1];
  console.log(` season match ${String(r.m).padStart(3)} | pL=${r.pL.toFixed(5)} | slow gain kL=${r.kL.toFixed(5)} | fast gain kS=${r.kS.toFixed(5)}`);
}
const sumKL=y2.reduce((a,r)=>a+r.kL,0), sumKS=y2.reduce((a,r)=>a+r.kS,0);
console.log(`\nOver a 60-match season, summed slow gain = ${sumKL.toFixed(3)}, summed fast gain = ${sumKS.toFixed(3)}`);
console.log(`Fraction of a season's total evidence that reaches the CARRIED (slow) mean: ${(100*sumKL/(sumKL+sumKS)).toFixed(1)}%`);
