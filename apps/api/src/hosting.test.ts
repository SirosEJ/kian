import { describe,it,expect } from 'vitest';
import { mkdtemp,writeFile,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './server.js';

describe('standalone web hosting',()=>{
  it('serves the web app at its OAuth callback URL without swallowing API routes',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'kian-web-'));
    await writeFile(join(dir,'index.html'),'<html>Kian sign in</html>');
    await mkdir(join(dir,'assets'));
    await writeFile(join(dir,'assets','app.js'),'console.log("Kian")');
    const app=buildServer({webDistPath:dir});
    expect((await app.inject('/?code=demo&state=google_demo')).body).toContain('Kian sign in');
    expect((await app.inject('/assets/app.js')).body).toContain('console.log');
    expect((await app.inject('/health')).json()).toEqual({status:'ok'});
    expect((await app.inject('/not-an-api')).statusCode).toBe(404);
    await app.close();await rm(dir,{recursive:true});
  });

  it('serves the app for client-side pages on a browser load, but keeps the JSON API for the same path',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'kian-web-'));
    await writeFile(join(dir,'index.html'),'<html>Kian shell</html>');
    await mkdir(join(dir,'assets'));
    const app=buildServer({webDistPath:dir,verifyToken:async()=>({uid:'alice'})});
    app.get('/activity',async()=>[{id:'api-json'}]);
    const page={accept:'text/html,application/xhtml+xml,*/*;q=0.8'};
    for(const path of ['/settings','/account','/activity','/settings/','/settings?code=x&state=y']) {
      const response=await app.inject({url:path,headers:page});
      expect(response.statusCode,path).toBe(200);
      expect(response.body,path).toContain('Kian shell');
    }
    expect((await app.inject({url:'/activity',headers:{accept:'*/*'}})).json()).toEqual([{id:'api-json'}]);
    expect((await app.inject({url:'/settings',headers:{accept:'application/json'}})).statusCode).toBe(404);
    expect((await app.inject({url:'/no-such-page',headers:page})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/settings',headers:page})).statusCode).toBe(404);
    await app.close();await rm(dir,{recursive:true});
  });
});

