const fs=require('fs'),path=require('path'),rl=require('readline');
const S=[2022,2023,2024,2025,2026],R=process.cwd();
const D={base:'reports/rpnoise-baseline-260905',g20:'reports/gaincap-g20-260906',epa:'reports/autopsy-260905'};
async function lines(f,cb){const r=rl.createInterface({input:fs.createReadStream(f,{encoding:'utf8'}),crlfDelay:Infinity});for await(const l of r) if(l) cb(JSON.parse(l));}
(async()=>{
const rows=[];
for(const s of S){const m=new Map();
 for(const [n,d] of Object.entries(D)){await lines(path.join(R,d,`predictions-${s}.jsonl`),r=>{
   if(n==='epa'&&r.algorithmId!=='epa')return; if(n!=='epa'&&r.algorithmId!=='vpr')return;
   let e=m.get(r.matchKey); if(!e){if(n!=='base')return; e={aw:r.actualWinner,am:r.actualRedScore-r.actualBlueScore,s:{}}; m.set(r.matchKey,e);}
   e.s[n]={m:r.predictedRedScore-r.predictedBlueScore,v:r.variance};});}
 for(const [,e] of m){ if(e.aw!=='red'&&e.aw!=='blue')continue; if(!e.s.base||!e.s.g20||!e.s.epa)continue; rows.push(e);} }
const vs=rows.map(r=>r.s.base.v).sort((a,b)=>a-b);
const ed=[1,2,3,4].map(i=>vs[Math.floor(vs.length*i/5)]);
const bo=v=>{let i=0;while(i<ed.length&&v>=ed[i])i++;return i;};
const Q=Array.from({length:5},()=>({n:0,g:{be:0,ae:0,se:0},e:{be:0,ae:0,se:0}}));
for(const r of rows){const i=bo(r.s.base.v);const q=Q[i];q.n++;
 for(const [k,tag] of [['g20','g'],['epa','e']]){const err=r.am-r.s[k].m; q[tag].be+=err; q[tag].ae+=Math.abs(err); q[tag].se+=err*err;}}
console.log('| VPR var quintile | n | g20 bias | epa bias | g20 MAE | epa MAE | g20 RMSE | epa RMSE | RMSE edge |');
console.log('|---|---|---|---|---|---|---|---|---|');
for(let i=0;i<5;i++){const q=Q[i],n=q.n;
 const gb=q.g.be/n, eb=q.e.be/n, gm=q.g.ae/n, em=q.e.ae/n, gr=Math.sqrt(q.g.se/n), er=Math.sqrt(q.e.se/n);
 const sg=x=>(x>=0?'+':'')+x.toFixed(2);
 console.log(`| Q${i+1} | ${n} | ${sg(gb)} | ${sg(eb)} | ${gm.toFixed(2)} | ${em.toFixed(2)} | ${gr.toFixed(2)} | ${er.toFixed(2)} | ${sg(er-gr)} |`);}
})();
