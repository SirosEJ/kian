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
});
