import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../pages/api/content-downloads';
import { selectContentDownloads } from '../lib/contentDownloads';
function response(){return {code:0,body:null as any,headers:{} as Record<string,string>,setHeader(k:string,v:string){this.headers[k]=v},status(n:number){this.code=n;return this},json(v:any){this.body=v;return this}}}
test('content downloads reject unsigned requests without calling Google',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('should not call')};
 try{const res=response();await handler({method:'GET',headers:{}} as any,res as any);assert.equal(res.code,401);assert.equal(calls,0);assert.equal(res.headers['Cache-Control'],'private, no-store')}finally{globalThis.fetch=original}
});
test('content download API rejects writes',async()=>{const res=response();await handler({method:'POST',headers:{}} as any,res as any);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET')});
test('content archives use signed campus scope and exclude invalid Drive IDs',()=>{
 const common={filename:'Content.zip',files:'12',bytes:'100',sha256:'hash'};
 const rows=[{...common,campus:'Parramatta',drive_id:'file123',created_at:'2026-10-01'},{...common,campus:'other',drive_id:'file456',created_at:'2026-10-03'},{...common,campus:'parramatta',drive_id:'javascript:alert(1)',created_at:'2026-10-04'},{...common,campus:'PARRAMATTA',drive_id:'file789',created_at:'2026-10-02'}];
 const downloads=selectContentDownloads(rows,'Parramatta');assert.equal(downloads.length,2);assert.match(downloads[0].url,/file789\/view$/);assert.equal(downloads[0].files,12);assert.deepEqual(selectContentDownloads(rows,''),[]);
});
