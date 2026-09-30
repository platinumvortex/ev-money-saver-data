// eCarUp publishes its public map and per-station prices anonymously (the same endpoints its own map uses).
// Each connector's Hubject ID is the EVSE ID used in the federal station catalogue, so matches are exact.
export const ECARUP_MAP='https://www.ecarup.com/api/map/stations';
export const ECARUP_DETAIL='https://www.ecarup.com/api/stations?id=';
const inSwitzerland=s=>s.Latitude>=45.8&&s.Latitude<=47.9&&s.Longitude>=5.9&&s.Longitude<=10.6;
const price=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10;

// Converts one connector to tariff components, or null when the price cannot be represented exactly.
export function ecarupComponents(connector){
  const p=connector?.Price;
  if(!p||connector.AccessType!==0||String(p.Currency).toUpperCase()!=='CHF')return null;
  let energy=p.EnergyPrice,parking=p.ParkingPrice||0,penalty=p.PenaltyPricePerMinute||0;
  const forecast=connector.PriceForecast||[];
  if(forecast.length){
    // Time-of-day energy or parking prices need a richer engine. A varying blocking fee uses its highest rate.
    if(new Set(forecast.map(f=>f.EnergyPricePerKwh)).size!==1||new Set(forecast.map(f=>f.ParkingPricePerHour||0)).size!==1)return null;
    energy=forecast[0].EnergyPricePerKwh;parking=forecast[0].ParkingPricePerHour||0;
    penalty=Math.max(penalty,...forecast.map(f=>f.PenaltyPricePerMinute||0));
  }
  if(!price(energy)||energy<=0||energy>3||!price(parking)||!price(penalty))return null;
  // Two overlapping time charges are not representable without double counting.
  if(parking>0&&penalty>0)return null;
  const components=[{type:'ENERGY',price:energy,step:1,from:0,until:null}];
  // eCarUp's parking price is charged per hour while the car is connected, including while charging.
  if(parking>0)components.push({type:'TIME',price:parking,step:60,from:0,until:null});
  if(penalty>0){
    const grace=p.PenaltyGracePeriodMinutes;
    if(!Number.isFinite(grace)||grace<0)return null;
    // The maximum penalty cap is ignored: estimates can only err on the expensive side.
    components.push({type:'TIME',price:Math.round(penalty*60*100)/100,step:60,from:grace*60,until:null});
  }
  return components;
}

export function ecarupTariffs(details,knownEvses,checkedAt){
  const tariffs=[];
  for(const station of details){
    if(!station||station.IsDisabled||!Array.isArray(station.Connectors))continue;
    for(const connector of station.Connectors){
      const evseId=connector.Hubject?.ID;
      if(typeof evseId!=='string'||!evseId.startsWith('CH*')||(knownEvses&&!knownEvses.has(evseId)))continue;
      const components=ecarupComponents(connector);
      if(!components)continue;
      tariffs.push({id:`ecarup:${evseId}`,evseId,source:'ecarup',payment:'direct',name:'eCarUp QR payment',components,updatedAt:checkedAt,verifiedAt:checkedAt});
    }
  }
  // An EVSE listed twice with different prices is ambiguous and dropped.
  const byEvse=new Map();
  for(const t of tariffs){const previous=byEvse.get(t.evseId);byEvse.set(t.evseId,previous&&JSON.stringify(previous.components)!==JSON.stringify(t.components)?null:t);}
  return [...byEvse.values()].filter(Boolean);
}

async function getJSON(url,timeoutMs=20000){
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{accept:'application/json','user-agent':'EV-Money-Saver-price-feed/2 (+https://platinumvortex.github.io/ev-money-saver-data/)'}});
      if(response.status===429||response.status>=500)throw new Error(`HTTP ${response.status}`);
      if(!response.ok)return null;
      return await response.json();
    }catch(error){if(attempt>=3)throw error;await new Promise(r=>setTimeout(r,2000*2**attempt));}
  }
}

export async function crawlEcarup({concurrency=8,log=console.error}={}){
  const map=await getJSON(ECARUP_MAP,60000);
  if(!Array.isArray(map?.Stations)||map.Stations.length<1000)throw new Error('eCarUp map is missing or incomplete.');
  const ids=map.Stations.filter(inSwitzerland).map(s=>s.Id);
  const details=[];let next=0,failed=0;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<ids.length){
      const id=ids[next++];
      try{const detail=await getJSON(ECARUP_DETAIL+encodeURIComponent(id));if(detail?.ID===id)details.push(detail);}catch{failed++;}
      if(next%500===0)log(`eCarUp: ${next}/${ids.length} stations`);
    }
  }));
  // A mostly failed crawl must not replace the previous good data.
  if(failed>ids.length*0.2)throw new Error(`eCarUp crawl incomplete: ${failed} of ${ids.length} stations failed.`);
  log(`eCarUp: ${details.length} station details, ${failed} failed`);
  return details;
}
