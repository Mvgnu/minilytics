import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cachedReport} from '../apps/dashboard/lib/report-cache';
import {resolveEnhancedRange} from '../apps/dashboard/lib/enhanced-explore';

test('identical concurrent report requests share work; different filters stay separate',async()=>{
 let calls=0;
 const load=async()=>{calls++; await new Promise(resolve=>setTimeout(resolve,10));return calls;};
 const [a,b]=await Promise.all([cachedReport('one',load),cachedReport('one',load)]);
 assert.equal(a,b);assert.equal(calls,1);
 await cachedReport('different-filter',load);assert.equal(calls,2);
});
test('failed reports retry instead of poisoning the cache',async()=>{
 await assert.rejects(cachedReport('failed',async()=>{throw new Error('temporary');}));
 assert.equal(await cachedReport('failed',async()=>42),42);
});
test('custom range caps scans at 366 days and one-day views use hourly buckets',()=>{
 const long=resolveEnhancedRange({range:'custom',from:'2020-01-01',to:'2025-01-01'});
 assert.equal(long.selectedDays,366);
 const day=resolveEnhancedRange({range:'custom',from:'2025-01-01',to:'2025-01-01'});
 assert.equal(day.bucket,'hour');assert.equal(day.selectedDays,1);
 assert.equal(day.comparisonFrom.toISOString(),'2024-12-31T00:00:00.000Z');
});
