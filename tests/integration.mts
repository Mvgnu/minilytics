import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import postgres from 'postgres';
import {networkSession,networkKeys} from '../apps/dashboard/lib/network-session';
import {ingestEvent} from '../apps/dashboard/lib/data';
import {getRealtime} from '../apps/dashboard/lib/realtime';
const sql=postgres(process.env.DATABASE_URL,{max:1});const id='qa-session-'+Date.now();const other=id+'-other';
try {
 for(const site of [id,other]) await sql`INSERT INTO sites(id,name,domain,secret_hash) VALUES(${site},'Temporary QA','example.invalid',${createHash('sha256').update(randomBytes(32)).digest('hex')})`;
 const matches=await Promise.all(Array.from({length:8},()=>networkSession(id,'192.0.2.10','QA Browser')));
 assert.equal(new Set(matches).size,1,'concurrent first beacons share a session');
 const first=matches[0];assert.equal(await networkSession(id,'192.0.2.10','QA Browser'),first);
 assert.notEqual(await networkSession(other,'192.0.2.10','QA Browser'),first);
 assert.notEqual(await networkSession(id,'192.0.2.11','QA Browser'),first);
 const keys=networkKeys(process.env.MINILYTICS_EDGE_SECRET!,id,'192.0.2.10','QA Browser',Date.now());
 await sql`UPDATE analytics_network_sessions SET match_key=${keys.previous} WHERE site_id=${id} AND match_key=${keys.current}`;
 assert.equal(await networkSession(id,'192.0.2.10','QA Browser'),first,'cross-window matching');
 await sql`UPDATE analytics_network_sessions SET expires_at=now()-interval '1 second' WHERE site_id=${id}`;
 assert.notEqual(await networkSession(id,'192.0.2.10','QA Browser'),first,'idle session expires');
 for(const [path,ref] of [['/landing','https://www.google.com/'],['/next','https://example.invalid/landing']]) {
  const r=await ingestEvent(new Request('http://localhost/api/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:first,eventType:'pageview',path,occurredAt:new Date().toISOString(),attribution:{landingPath:path,landingReferrer:ref}})}),id);assert.equal(r.status,204);
 }
 const rows=await sql`SELECT source,medium,source_detail,landing_path FROM events WHERE site_id=${id}`;
 assert.equal(rows.length,2);assert(rows.every(r=>r.source==='organic' && r.source_detail==='google' && r.landing_path==='/landing'));
 const live=await getRealtime(id);assert.equal(live?.users,1);assert.equal(live?.rows[0].path,'/next');assert.equal(live?.rows[0].source,'google');
 if(process.env.MINILYTICS_TEST_BASE_URL) {
  const unauthorized=await fetch(process.env.MINILYTICS_TEST_BASE_URL+'/api/edge-collect/srocket',{method:'POST',body:'{}'});assert.equal(unauthorized.status,401);
 }
 console.log('PASS: concurrent requests, reload continuity, site isolation, network isolation, salt rotation, idle expiry, first-touch source, realtime last URL, edge auth.');
} catch(e){console.error(e);process.exitCode=1;} finally {
 await sql`DELETE FROM sites WHERE id IN (${id},${other})`;await sql.end();process.exit(process.exitCode??0);
}
