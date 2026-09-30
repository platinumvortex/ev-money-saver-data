// Builds prices-v2.json: every supported Swiss ad-hoc tariff from all sources, keyed by federal EVSE ID.
// Each source fails independently. A failed source keeps its previous tariffs while they are under
// six days old, with their original verification time, so the extension's 7-day expiry still applies.
//
//   node scripts/build-v2.mjs --stations sfoe.json[.gz] [--chargeprice upstream.json] [--previous URL|file]
//                             [--no-ecarup] [--no-operators] --out docs/prices-v2.json
import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {chargepriceTariffs} from './build-feed.mjs';
import {crawlEcarup,ecarupTariffs} from './sources/ecarup.mjs';
import {OPERATOR_SOURCES,fetchOperatorRates,operatorTariffs} from './sources/operators.mjs';

export const PREVIOUS_URL='https://platinumvortex.github.io/ev-money-saver-data/prices-v2.json';
const CARRY_LIMIT=6*86400000;
export const SOURCES={
  chargeprice:{title:'Swiss eMobility Charging Price Map',author:'Swiss eMobility',url:'https://opendata.swiss/en/dataset/ladepreiskarte-swiss-emobility',license:'O-By-Ask; attribution required'},
  ecarup:{title:'eCarUp public station map',author:'eCarUp',url:'https://www.ecarup.com/'},
  fastned:{title:'Fastned published tariffs',author:'Fastned',url:OPERATOR_SOURCES.fastned.url},
  migrol:{title:'Migrol M-Charge published tariffs',author:'Migrol',url:OPERATOR_SOURCES.migrol.url}
};

// Federal catalogue → Map evseId → {operator, power}. Power is the lowest facility power, as in the extension.
export function federalEvses(input){
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  const payload=JSON.parse((bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes).toString('utf8'));
  const evses=new Map();
  for(const group of payload.EVSEData||[])for(const r of group.EVSEDataRecord||[]){
    if(typeof r.EvseID!=='string'||!r.EvseID)continue;
    const powers=(r.ChargingFacilities||[]).map(f=>Number(f.power??f.Power)).filter(p=>Number.isFinite(p)&&p>0);
    evses.set(r.EvseID,{operator:group.OperatorName||r.SuboperatorName||'',power:powers.length?Math.min(...powers):0});
  }
  if(evses.size<1000)throw new Error(`Federal station catalogue is incomplete (${evses.size} EVSEs).`);
  return evses;
}

function compact(t){
  const out={id:t.id,evseId:t.evseId,source:t.source,payment:t.payment,name:t.name,components:t.components.map(c=>{const x={type:c.type,price:c.price,step:c.step};if(c.from)x.from=c.from;if(c.until!=null)x.until=c.until;return x;}),verifiedAt:t.verifiedAt};
  if(t.updatedAt&&t.updatedAt!==t.verifiedAt)out.updatedAt=t.updatedAt;
  return out;
}

export async function buildV2({evses,chargeprice=null,previous=null,ecarup=true,operators=true,now=new Date().toISOString(),log=console.error}){
  const sources={},all=[];
  const previousBySource=source=>(previous?.tariffs||[]).filter(t=>t.source===source&&Date.parse(now)-Date.parse(t.verifiedAt)<CARRY_LIMIT);
  async function run(key,produce){
    let items,status='fresh',error;
    try{items=(await produce()).filter(t=>evses.has(t.evseId));
      const before=(previous?.tariffs||[]).filter(t=>t.source===key).length;
      // A sudden collapse usually means an upstream format change, not a real price change.
      if(before>200&&items.length<before*0.5)throw new Error(`only ${items.length} tariffs (previously ${before})`);
      if(!items.length)throw new Error('no supported tariffs');
    }catch(reason){items=previousBySource(key);status=items.length?'carried':'failed';error=String(reason?.message||reason).slice(0,200);log(`${key}: ${error} → ${status} (${items.length})`);}
    const verified=items.map(t=>Date.parse(t.verifiedAt)).filter(Number.isFinite);
    sources[key]={...SOURCES[key],status,tariffs:items.length,evses:new Set(items.map(t=>t.evseId)).size,verifiedAt:verified.length?new Date(Math.min(...verified)).toISOString():null,...(error?{error}:{})};
    all.push(...items.map(compact));
    return items;
  }
  const cp=await run('chargeprice',async()=>{if(!chargeprice)throw new Error('not downloaded');return chargepriceTariffs(chargeprice,now).map(t=>({...t,source:'chargeprice'}));});
  if(ecarup)await run('ecarup',async()=>ecarupTariffs(await crawlEcarup({log}),evses,now));else await run('ecarup',async()=>{throw new Error('skipped');});
  const priced=new Set(cp.filter(t=>t.payment==='direct').map(t=>t.evseId));
  for(const id of Object.keys(OPERATOR_SOURCES))await run(id,async()=>{if(!operators)throw new Error('skipped');return operatorTariffs(id,await fetchOperatorRates(id),evses,priced,now);});
  const ids=new Set();
  const tariffs=all.filter(t=>!ids.has(t.id)&&ids.add(t.id)).sort((a,b)=>a.evseId.localeCompare(b.evseId)||a.id.localeCompare(b.id));
  const pricedEvses=new Set(tariffs.map(t=>t.evseId)).size;
  if(tariffs.length<1000)throw new Error(`Refusing to publish only ${tariffs.length} tariffs.`);
  return {schemaVersion:2,generatedAt:now,currency:'CHF',coverage:{federalEvses:evses.size,pricedEvses,share:Math.round(pricedEvses/evses.size*1000)/1000},sources,tariffs};
}

async function loadPrevious(location){
  try{
    if(/^https?:/.test(location)){const r=await fetch(location,{signal:AbortSignal.timeout(60000)});if(!r.ok)return null;return await r.json();}
    return JSON.parse(await fs.readFile(location,'utf8'));
  }catch{return null;}
}

const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
  const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const out=arg('--out'),stations=arg('--stations');
  if(!out||!stations)throw new Error('Usage: node build-v2.mjs --stations sfoe.json --out prices-v2.json [--chargeprice upstream.json] [--previous URL|file]');
  const chargeprice=arg('--chargeprice')?await fs.readFile(arg('--chargeprice'),'utf8').then(JSON.parse).catch(()=>null):null;
  const feed=await buildV2({evses:federalEvses(await fs.readFile(stations)),chargeprice,previous:await loadPrevious(arg('--previous')||PREVIOUS_URL),ecarup:!args.includes('--no-ecarup'),operators:!args.includes('--no-operators')});
  await fs.mkdir(path.dirname(out),{recursive:true});
  await fs.writeFile(out,JSON.stringify(feed));
  console.log(`Published ${feed.tariffs.length} tariffs for ${feed.coverage.pricedEvses} of ${feed.coverage.federalEvses} EVSEs (${(feed.coverage.share*100).toFixed(1)}%).`);
  for(const [key,s] of Object.entries(feed.sources))console.log(`  ${key}: ${s.status}, ${s.tariffs} tariffs, ${s.evses} EVSEs${s.error?` (${s.error})`:''}`);
}
