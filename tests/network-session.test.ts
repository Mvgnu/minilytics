import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkKeys} from '../apps/dashboard/lib/network-session';
test('lookup hashes rotate without storing addresses and match the previous window',()=>{
 const start=1800000000000;
 const a=networkKeys('secret','one','192.0.2.1','Browser',start);
 const b=networkKeys('secret','one','192.0.2.1','Browser',start+1800000);
 assert.equal(a.current,b.previous);assert.notEqual(a.current,b.current);
 assert.equal(a.lock,b.lock);assert.match(a.current,/^[a-f0-9]{64}$/);
 assert.notEqual(a.current,networkKeys('secret','two','192.0.2.1','Browser',start).current);
 assert.notEqual(a.current,networkKeys('secret','one','192.0.2.2','Browser',start).current);
 assert.notEqual(a.current,networkKeys('secret','one','192.0.2.1','Other',start).current);
});
