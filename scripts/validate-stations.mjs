import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

export function validateStationPayload(input,minRecords=1000){
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  const decoded=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes;
  const payload=JSON.parse(decoded.toString('utf8'));
  if(!Array.isArray(payload?.EVSEData))throw new Error('The federal station response has no EVSEData array.');
  const records=payload.EVSEData.flatMap(group=>Array.isArray(group?.EVSEDataRecord)?group.EVSEDataRecord:[]);
  const ids=new Set(records.map(record=>record?.EvseID).filter(id=>typeof id==='string'&&id));
  if(records.length<minRecords||ids.size<minRecords)throw new Error(`Station response is incomplete (${records.length} records, ${ids.size} IDs).`);
  return {records:records.length,evseIds:ids.size};
}

const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
  const [, ,input,output]=process.argv;
  if(!input||!output)throw new Error('Usage: node validate-stations.mjs input.json[.gz] output.json');
  const bytes=await fs.readFile(input),result=validateStationPayload(bytes);
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,bytes);
  console.log(`Published ${result.records} station records with ${result.evseIds} EVSE IDs.`);
}
