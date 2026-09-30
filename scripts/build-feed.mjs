import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const allowedTypes=new Set(['ENERGY','FLAT','TIME','PARKING_TIME']);
// Ad-hoc app tariffs that need only a free app account, no subscription or membership fee.
// TCS eCharge mirrors Swisscharge prices for members and is deliberately excluded.
export const APP_TARIFFS=new Map([['Swisscharge','Swisscharge app'],['Electra','Electra app']]);

// Normalizes every supported Swiss tariff. `payment` is 'direct' (card/QR at the charger) or 'app'.
export function chargepriceTariffs(payload,retrievedAt=new Date().toISOString()){
  if(!Array.isArray(payload?.data))throw new Error('The upstream response has no data array.');
  const retrieved=Date.parse(retrievedAt);
  if(!Number.isFinite(retrieved))throw new Error('A valid retrieval time is required.');
  const included=new Map((payload.included||payload.includes||[]).map(item=>[`${item.type}:${item.id}`,item.attributes||{}]));
  const relation=(record,name)=>{const ref=record.relationships?.[name]?.data;return ref?included.get(`${ref.type}:${ref.id}`):null;};
  const tariffs=[];
  for(const record of payload.data){
    const attributes=record.attributes||{},tariff=relation(record,'tariff'),emp=relation(record,'emp');
    const direct=typeof tariff?.is_direct_payment==='boolean'?tariff.is_direct_payment:emp?.is_direct_payment===true;
    const app=!direct&&APP_TARIFFS.has(tariff?.name)?APP_TARIFFS.get(tariff.name):null;
    if((!direct&&!app)||attributes.country_code!=='CH'||attributes.currency!=='CHF'||typeof attributes.evse_id!=='string'||!attributes.evse_id)continue;
    let complete=Array.isArray(attributes.elements)&&attributes.elements.length>0;
    const components=[];
    for(const element of attributes.elements||[]){
      const restrictions=element.restrictions||{};
      if(Object.entries(restrictions).some(([key,value])=>value!==null&&value!==undefined&&!['min_duration','max_duration'].includes(key)))complete=false;
      if(!Array.isArray(element.price_components)||!element.price_components.length)complete=false;
      for(const component of element.price_components||[]){
        if(!allowedTypes.has(component.type)||!Number.isFinite(component.price)||component.price<0||(component.type==='ENERGY'&&component.price<=0))complete=false;
        if(!['TIME','PARKING_TIME'].includes(component.type)&&(restrictions.min_duration!=null||restrictions.max_duration!=null))complete=false;
        const step=component.step_size??(component.type==='ENERGY'?1:60),from=restrictions.min_duration??0,until=restrictions.max_duration??null;
        if(!Number.isFinite(step)||step<=0||!Number.isFinite(from)||from<0||(until!==null&&(!Number.isFinite(until)||until<=from)))complete=false;
        components.push({type:component.type,price:component.price,step,from,until});
      }
    }
    // Results promise a positive per-kWh price, so time-only or flat-only tariffs are left out.
    if(!complete||!components.some(c=>c.type==='ENERGY'&&c.price>0))continue;
    const sourceTime=Date.parse(attributes.updated_at),updatedAt=Number.isFinite(sourceTime)?new Date(sourceTime).toISOString():new Date(retrieved).toISOString();
    tariffs.push({id:String(record.id),evseId:attributes.evse_id,currency:'CHF',components,complete:true,directPayment:!!direct,payment:direct?'direct':'app',name:String(app||tariff?.name||emp?.name||'Direct payment').slice(0,120),updatedAt,verifiedAt:new Date(retrieved).toISOString(),timestampKind:'verified'});
  }
  const unique=new Map();
  for(const item of tariffs)if(!unique.has(item.id))unique.set(item.id,item);
  return [...unique.values()].sort((a,b)=>a.evseId.localeCompare(b.evseId)||a.id.localeCompare(b.id));
}

// Version 1 feed, kept unchanged for installed extensions up to 1.10.x: direct payment only.
export function buildFeed(payload,retrievedAt=new Date().toISOString()){
  const output=chargepriceTariffs(payload,retrievedAt).filter(item=>item.payment==='direct').map(({payment,...item})=>item);
  if(!output.length)throw new Error('No supported direct-payment tariffs were found; refusing to publish an empty feed.');
  return {schemaVersion:1,provider:'swiss-emobility-charging-price-map',retrievedAt:new Date(Date.parse(retrievedAt)).toISOString(),tariffCount:output.length,evseCount:new Set(output.map(item=>item.evseId)).size,license:'O-By-Ask; attribution required; commercial use requires prior permission from Swiss eMobility',source:{author:'Swiss eMobility',title:'Charging Price Map Swiss eMobility',url:'https://opendata.swiss/en/dataset/ladepreiskarte-swiss-emobility'},tariffs:output};
}

const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
  const [, ,input,output]=process.argv;
  if(!input||!output)throw new Error('Usage: node build-feed.mjs upstream.json prices.json');
  const payload=JSON.parse(await fs.readFile(input,'utf8'));
  const feed=buildFeed(payload,process.env.RETRIEVED_AT||new Date().toISOString());
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(feed,null,2)+'\n');
  console.log(`Published ${feed.tariffCount} direct tariffs for ${feed.evseCount} EVSEs.`);
}
