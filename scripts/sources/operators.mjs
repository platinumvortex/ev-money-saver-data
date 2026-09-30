// Operator-published standard ad-hoc prices, applied to that operator's EVSEs in the federal catalogue.
// Parsers were moved here from the extension so they run once per day for everyone.
export const OPERATOR_SOURCES={
  fastned:{operator:'Fastned',name:'Fastned card payment',url:'https://www.fastnedcharging.com/en/charging/tariffs'},
  migrol:{operator:'M-Charge',name:'M-Charge without account',url:'https://www.migrol.ch/de/rund-ums-fahrzeug/e-ladestationen/oeffentliche-ladestationen/'}
};

function text(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}

export function parseOperatorRates(id,html){
  let rates;
  if(id==='fastned'){
    const sections=[...html.matchAll(/data-country-code="CH"([\s\S]*?)(?=data-country-code=|$)/g)].map(m=>text(m[1]));
    const matches=sections.map(s=>s.match(/Standard price\s+CHF\s+(\d+[.,]\d{2})\s+in Switzerland/)).filter(Boolean);
    if(matches.length!==1)throw new Error('Fastned Swiss standard tariff not found');
    rates=[{below:null,price:Number(matches[0][1].replace(',','.'))}];
  }else if(id==='migrol'){
    const s=text(html);
    if(!s.includes('Ohne Konto')||!s.includes('inkl. MwSt.'))throw new Error('Migrol direct payment terms changed');
    const matches=[...s.matchAll(/M-Charge\s*<\s*(\d+)\s*kW\s*CHF\s*(\d+[.,]\d{2})/g)];
    if(matches.length!==4)throw new Error('Migrol tariff table changed');
    rates=matches.map(m=>({below:Number(m[1]),price:Number(m[2].replace(',','.'))})).sort((a,b)=>a.below-b.below);
    if(rates.map(r=>r.below).join(',')!=='22,64,200,400')throw new Error('Migrol power categories changed');
  }else throw new Error('Unknown operator');
  if(rates.some(r=>!Number.isFinite(r.price)||r.price<=0||r.price>3))throw new Error('Invalid energy price');
  return rates;
}

// `evses`: Map evseId → {operator, power}. EVSEs already priced per-EVSE by another source are skipped.
export function operatorTariffs(id,rates,evses,alreadyPriced,checkedAt){
  const source=OPERATOR_SOURCES[id],tariffs=[];
  for(const [evseId,evse] of evses){
    if(evse.operator!==source.operator||alreadyPriced.has(evseId))continue;
    // Migrol's published table uses strict '<'. Exact boundaries are ambiguous and skipped.
    if(id==='migrol'&&rates.some(r=>r.below===evse.power))continue;
    const rate=rates.find(r=>r.below===null||evse.power<r.below);if(!rate)continue;
    tariffs.push({id:`${id}:${evseId}`,evseId,source:id,payment:'direct',name:source.name,components:[{type:'ENERGY',price:rate.price,step:1,from:0,until:null}],updatedAt:checkedAt,verifiedAt:checkedAt});
  }
  return tariffs;
}

export async function fetchOperatorRates(id){
  const response=await fetch(OPERATOR_SOURCES[id].url,{signal:AbortSignal.timeout(45000),headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36','accept-language':'de-CH,de;q=0.9,en;q=0.8'}});
  if(!response.ok)throw new Error(`${id} HTTP ${response.status}`);
  return parseOperatorRates(id,await response.text());
}
