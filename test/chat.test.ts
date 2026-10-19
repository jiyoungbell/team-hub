import { afterEach, expect, it, vi } from 'vitest';
import { chatFrame, chatReply } from '../src/chat';
import worker from '../src/index';
import { testEnv } from './helpers';
afterEach(()=>vi.unstubAllGlobals());
const conversation='12345678-1234-1234-1234-123456789abc';
it('rejects anonymous chat API and frame',async()=>{
 const env=await testEnv();
 for(const path of ['/api/chat','/chat/embed']) expect((await worker.fetch(new Request(env.HUB_ORIGIN+path) as Parameters<typeof worker.fetch>[0],env)).status).toBe(401);
});
it('binds identity to the session and forwards only allowed fields',async()=>{
 const env=await testEnv();const mock=vi.fn(async()=>Response.json({answer:'hi'}));vi.stubGlobal('fetch',mock);
 const req=(body:unknown,origin=env.HUB_ORIGIN)=>new Request(env.HUB_ORIGIN+'/api/chat',{method:'POST',headers:{origin},body:JSON.stringify(body)});
 expect((await chatReply(req({conversation,message:'hi'},'https://evil.example'),env,'123456')).status).toBe(403);
 expect((await chatReply(req({conversation,message:'x'.repeat(4001)}),env,'123456')).status).toBe(400);
 expect((await chatReply(req({conversation,message:'x'.repeat(41000)}),env,'123456')).status).toBe(413);
 expect(mock).not.toHaveBeenCalled();
 const res=await chatReply(req({conversation,message:'hi',userId:'654321',model:'main'}),env,'123456');
 expect(res.status).toBe(200);
 expect(JSON.parse((mock.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)).toEqual({conversation,message:'hi',userId:'123456'});
});
it('restricts embedding and serves no cached conversation',async()=>{
 const env=await testEnv();const r=await chatFrame(env,'123456');
 expect(r.headers.get('cache-control')).toBe('no-store');
 expect(r.headers.get('content-security-policy')).toContain('frame-ancestors \'self\' https://cert.rescene-remine.com');
 expect(await r.text()).toContain('data-user="123456"');
});
it('forwards bounded screen references, strips extras, and rejects foreign URLs/invalid IDs',async()=>{
 const env=await testEnv();const mock=vi.fn(async()=>Response.json({answer:'ok'}));vi.stubGlobal('fetch',mock);
 const ctx={kind:'issue',id:84,title:'PULSE 앨범 공구·구매 문의',url:'https://monitor.rescene-remine.com/#issue-84'};
 const post=(context:unknown)=>chatReply(new Request(env.HUB_ORIGIN+'/api/chat',{method:'POST',headers:{origin:env.HUB_ORIGIN},body:JSON.stringify({conversation,message:'이게 뭐야?',context})}),env,'123456');
 expect((await post({...ctx,body:'do not forward',model:'main'})).status).toBe(200);
 expect(JSON.parse((mock.mock.calls[0] as unknown as [string,RequestInit])[1].body as string).context).toEqual(ctx);
 for (const c of [{...ctx,url:'https://evil.example/'},{...ctx,id:-1},{...ctx,title:'x'.repeat(201)},{...ctx,url:'https://monitor.rescene-remine.com/?token=secret'},{...ctx,url:'https://cert.rescene-remine.com/'}]) expect((await post(c)).status).toBe(400);
 expect(mock).toHaveBeenCalledTimes(1);
});
it('includes loaded comments only for their matching item and bounds their size',async()=>{
 const env=await testEnv();const mock=vi.fn(async()=>Response.json({answer:'ok'}));vi.stubGlobal('fetch',mock);
 const comments={itemId:123,count:1,total:3,at:Date.now(),text:'테스트: 공동구매 안내를 기다려요.',truncated:false};
 const context={kind:'item',id:123,title:'공동구매',url:'https://monitor.rescene-remine.com/#123',comments};
 const post=(ctx:unknown)=>chatReply(new Request(env.HUB_ORIGIN+'/api/chat',{method:'POST',headers:{origin:env.HUB_ORIGIN},body:JSON.stringify({conversation,message:'댓글 반응은?',context:ctx})}),env,'123456');
 expect((await post(context)).status).toBe(200);
 expect(JSON.parse((mock.mock.calls[0] as unknown as [string,RequestInit])[1].body as string).context.comments).toEqual(comments);
 for(const ctx of [{...context,kind:'issue'},{...context,id:999},{...context,comments:{...comments,text:'x'.repeat(6001)}},{...context,comments:{...comments,count:4}}]) expect((await post(ctx)).status).toBe(400);
});
