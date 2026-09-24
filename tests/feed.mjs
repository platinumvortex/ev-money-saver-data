import assert from 'assert';
import fs from 'fs';
import {buildFeed} from '../scripts/build-feed.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixture.json',import.meta.url)));
const feed=buildFeed(fixture,'2026-09-24T12:00:00Z');
assert.equal(feed.tariffCount,1);
assert.equal(feed.evseCount,1);
assert.equal(feed.tariffs[0].id,'direct');
assert.equal(feed.tariffs[0].directPayment,true);
assert.equal(feed.tariffs[0].components[0].price,0.45);
assert.ok(feed.tariffs.every(tariff=>tariff.components.every(component=>component.type!=='ENERGY'||component.price>0)));
console.log('✓ Feed publishes supported Swiss direct-payment tariffs only');
