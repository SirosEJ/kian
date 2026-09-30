import { describe,expect,it,vi } from 'vitest';
import { IonosMailConnector } from './ionos-mail.js';

const connection={host:'smtp.ionos.co.uk',user:'siros@sepenta.io',password:'test-only'};
const command={action:'email.send' as const,to:['solmaz@example.com'],subject:'Agenda',body:'Approved agenda'};
describe('IONOS email semantics',()=>{
  it('checks mailbox access and sends the approved content with a stable message id',async()=>{
    const sendMail=vi.fn(async(_message:unknown)=>({accepted:['solmaz@example.com'],rejected:[],messageId:'id'}));
    const adapter=new IonosMailConnector(()=>({verify:async()=>true,sendMail,close:()=>{}}));
    expect(await adapter.test(connection)).toBe(true);
    expect((await adapter.execute(connection,command,'task-1:2')).status).toBe('succeeded');
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({from:'siros@sepenta.io',to:['solmaz@example.com'],subject:'Agenda',text:'Approved agenda'});
    expect(()=>adapter.validate({...command,to:['Solmaz']})).toThrow('recipient');
    expect(()=>adapter.validate({...command,subject:'Agenda\r\nBcc: bad@example.com'})).toThrow('subject');
  });
  it('distinguishes credential failures from uncertain acceptance without retry',async()=>{
    const auth=new IonosMailConnector(()=>({verify:async()=>{throw Object.assign(new Error('bad credential'),{code:'EAUTH'});},sendMail:async()=>{throw Object.assign(new Error('auth'),{code:'EAUTH',command:'AUTH LOGIN'});},close:()=>{}}));
    expect(await auth.test(connection)).toBe(false);
    expect((await auth.execute(connection,command,'task-a')).status).toBe('failed');
    const sendMail=vi.fn(async()=>{throw Object.assign(new Error('timeout after acceptance'),{code:'ETIMEDOUT',command:'DATA'});});
    const uncertain=new IonosMailConnector(()=>({verify:async()=>true,sendMail,close:()=>{}}));
    expect((await uncertain.execute(connection,command,'task-b')).status).toBe('uncertain');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
