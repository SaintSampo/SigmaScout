const fs=require('fs'),path=require('path'),rl=require('readline');
const S=[2022,2023,2024,2025,2026],R=process.cwd();
const D={g20:'reports/gaincap-g20-260906',epa:'reports/autopsy-260905'};
async function lines(f,cb){const r=rl.createInterface({input:fs.createReadStream(f,{encoding:'utf8'}),crlfDelay:Infinity});for await(const l of r) if(l) cb(JSON.parse(l));}
(async()=>{
console.log('| season | n components | n matches | g20 RMSE | epa RMSE | EPA edge (pts) | g20 acc | epa acc | acc gap |');
console.log('|---|---|---|---|---|---|---|---|---|');
const out=[];
for(const s of S){const m=new Map(); let ncomp=0;
 for(const [n,d] of Object.entries(D)){await lines(path.join(R,d,`predictions-${s}.jsonl`),r=>{
   if(n==='epa'&&r.algorithmId!=='epa')return; if(n!=='epa'&&r.algorithmId!=='vpr')return;
   if(n==='g20'&&!ncomp&&r.redComponents) ncomp=Object.keys(r.redComponents).length;
   let e=m.get(r.matchKey); if(!e){if(n!=='g20')return; e={aw:r.actualWinner,am:r.actualRedScore-r.actualBlueScore,s:{}}; m.set(r.matchKey,e);}
   e.s[n]={m:r.predictedRedScore-r.predictedBlueScore,p:r.pRedWin};});}
 let n=0,gse=0,ese=0,gc=0,ec=0;
 for(const [,e] of m){ if(e.aw!=='red'&&e.aw!=='blue')continue; if(!e.s.g20||!e.s.epa)continue; n++;
  gse+=(e.am-e.s.g20.m)**2; ese+=(e.am-e.s.epa.m)**2;
  if((e.s.g20.p>=0.5?'red':'blue')===e.aw)gc++; if((e.s.epa.p>=0.5?'red':'blue')===e.aw)ec++;}
 const gr=Math.sqrt(gse/n),er=Math.sqrt(ese/n),ga=gc/n,ea=ec/n;
 const sg=x=>(x>=0?'+':'')+x.toFixed(2);
 console.log(`| ${s} | ${ncomp} | ${n} | ${gr.toFixed(2)} | ${er.toFixed(2)} | ${sg(gr-er)} | ${(ga*100).toFixed(2)}% | ${(ea*100).toFixed(2)}% | ${sg((ea-ga)*100)}pt |`);
 out.push([s,ncomp,gr-er,(ea-ga)*100]);
}
const n=out.length, mx=out.reduce((a,r)=>a+r[1],0)/n, my=out.reduce((a,r)=>a+r[2],0)/n;
const cov=out.reduce((a,r)=>a+(r[1]-mx)*(r[2]-my),0), vx=out.reduce((a,r)=>a+(r[1]-mx)**2,0), vy=out.reduce((a,r)=>a+(r[2]-my)**2,0);
console.log(`\ncorr(component count, EPA RMSE edge) = ${(cov/Math.sqrt(vx*vy)).toFixed(3)}  [n=5 seasons - weak evidence, directional only]`);

})();
