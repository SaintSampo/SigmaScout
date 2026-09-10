const w2=0.7,w3=0.5, base=[1,w2,w3], norm=3/(1+w2+w3);
const W=base.map(b=>b*norm);
const wsum=(mus)=>{const o=mus.map((_,i)=>i).sort((a,b)=>mus[b]-mus[a]||a-b);let s=0;o.forEach((idx,rank)=>{s+=W[rank]*mus[idx];});return s;};
console.log("CLAIM: the renormalized rank weights make the model SUPER-additive, never sub-additive.\n");
console.log(" alliance (mu1,mu2,mu3)        plain sum   BPR weighted   ratio");
for(const m of [[1,1,1],[1.2,1.0,0.8],[2.0,1.0,0.5],[3.0,0.6,0.4],[1.5,1.45,1.4],[0.6,0.5,0.4]]){
  const p=m.reduce((a,b)=>a+b,0), q=wsum(m);
  console.log(` (${m.map(x=>x.toFixed(2)).join(', ')})           ${p.toFixed(3)}       ${q.toFixed(3)}      ${(q/p).toFixed(4)}`);
}
console.log("\nCLAIM: exactly-tied ratings are broken by ARRAY INDEX (driver-station order).");
const mus=[0.55,0.55,0.55];
const o=mus.map((_,i)=>i).sort((a,b)=>mus[b]-mus[a]||a-b);
const wt=new Array(3); o.forEach((idx,rank)=>{wt[idx]=W[rank];});
console.log(` three identical rookies (0.55,0.55,0.55) -> weights ${wt.map(x=>x.toFixed(4)).join(', ')}`);
console.log(` slot 1 absorbs ${(100*(wt[0]/wt[2]-1)).toFixed(0)}% more Kalman credit than slot 3, on identical evidence.`);
console.log("\nCLAIM: unequal weights inflate the alliance predictive variance (pv = sum w_i^2 p_i).");
console.log(` sum w^2 = ${W.reduce((a,b)=>a+b*b,0).toFixed(4)} vs 3.0000 additive -> pv inflated ${(100*(W.reduce((a,b)=>a+b*b,0)/3-1)).toFixed(1)}% for equal-strength teams.`);
