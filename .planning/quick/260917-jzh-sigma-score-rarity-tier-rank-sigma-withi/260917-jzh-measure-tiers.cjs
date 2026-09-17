const a=JSON.parse(require('fs').readFileSync('teams2026.json','utf8'));
const ti=a.metricKeys.indexOf('total'), si=a.metricKeys.indexOf('sigma');
const rows=a.teams.filter(t=>t.metrics[ti]&&t.metrics[si]).map(t=>({k:t.teamKey,total:t.metrics[ti][0],sigma:t.metrics[si][0],tier:t.metrics[si][2]??'common'}));
rows.sort((x,y)=>x.total-y.total);
const n=rows.length;
const med=v=>{const s=[...v].sort((x,y)=>x-y);const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const tierOf=p=>p>=95?'legendary':p>=75?'epic':p>=50?'rare':'common';
function pct(vals){const idx=vals.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]);const out=[];let i=0;while(i<n){let j=i;while(j+1<n&&idx[j+1][0]===idx[i][0])j++;const p=(i+0.5*(j-i+1))/n*100;for(let k=i;k<=j;k++)out[idx[k][1]]=p;i=j+1;}return out;}
function windowStats(w){const h=w>>1;return rows.map((r,i)=>{let s=i-h,e=s+w;if(s<0){e-=s;s=0}if(e>n){s-=e-n;e=n}s=Math.max(0,s);const v=rows.slice(s,e).map(x=>x.sigma);const m=med(v);const mad=med(v.map(x=>Math.abs(x-m)));return{m,mad};});}
const w=Math.min(n,Math.max(25,Math.round(n/20)));
const st=windowStats(w);
const schemes={
 published:rows.map(r=>r.tier),
 raw:pct(rows.map(r=>r.sigma)).map(p=>tierOf(100-p)),
 residual:pct(rows.map((r,i)=>r.sigma-st[i].m)).map(p=>tierOf(100-p)),
 scaled:pct(rows.map((r,i)=>(r.sigma-st[i].m)/Math.max(st[i].mad,1e-9))).map(p=>tierOf(100-p)),
};
// local rank: percentile of the team's sigma WITHIN its own window
{const h=w>>1;schemes.localRank=rows.map((r,i)=>{let s=i-h,e=s+w;if(s<0){e-=s;s=0}if(e>n){s-=e-n;e=n}s=Math.max(0,s);const v=rows.slice(s,e).map(x=>x.sigma);const below=v.filter(x=>x<r.sigma).length,eq=v.filter(x=>x===r.sigma).length;return tierOf(100-(below+0.5*eq)/v.length*100);});}
for(const [name,t] of Object.entries(schemes)){
 console.log('\n'+name, name!=='published'?'agree w/ published: '+(100*t.filter((x,i)=>x===rows[i].tier).length/n).toFixed(1)+'%':'');
 for(let b=0;b<10;b++){const lo=Math.floor(b*n/10),hi=Math.floor((b+1)*n/10);const c={common:0,rare:0,epic:0,legendary:0};for(let i=lo;i<hi;i++)c[t[i]]++;
  console.log(String(b+1).padStart(3),['common','rare','epic','legendary'].map(k=>(100*c[k]/(hi-lo)).toFixed(1).padStart(6)).join(' '));}
 const top=rows.length-92;const c={common:0,rare:0,epic:0,legendary:0};for(let i=top;i<n;i++)c[t[i]]++;console.log('top92',JSON.stringify(c));
}
