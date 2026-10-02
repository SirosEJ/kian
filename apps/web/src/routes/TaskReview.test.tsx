import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskReview } from './TaskReview.js';

describe('task review', () => {
  it('shows action details and independent approve/reject choices', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'a',action:'email.send',state:'proposed',destination:'solmaz@example.com',connectionId:'mail-1',parameters:{subject:'Agenda',body:'Hello'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('Agenda');
    expect(html).toContain('solmaz@example.com');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('Always do this without asking: send email to solmaz@example.com');
    expect(html).toContain('You can stop it any time in Settings');
  });

  it('offers no trust option for changes to existing items, only the reason', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'u',action:'calendar.update',state:'proposed',destination:'primary',connectionId:'cal',parameters:{eventId:'e1'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('Changes to existing items always need your approval.');
    expect(html).not.toContain('Always do this without asking');
    expect(html).not.toContain('type="checkbox"');
  });

  it('says which account the task will use, or that none is chosen yet', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'n',action:'email.send',state:'proposed',destination:'sam@example.com',connectionId:null,parameters:{subject:'Hi',body:'Hello'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('No account selected yet');
  });

  it('shows a delete card with the event title and time, no Edit, and no "always do this" box', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id:'d',action:'calendar.delete',state:'proposed',version:1,destination:'me@example.com',connectionId:'cal',parameters:{eventId:'abc123',summary:'key on test',when:'Sat 3 Oct 10:00–10:30',start:'2026-10-03T10:00:00+01:00',end:'2026-10-03T10:30:00+01:00',scope:'Only this occurrence is deleted, not the whole series.'},uncertainties:[] }} onChange={()=>{}} />);
    expect(html).toContain('Delete calendar event');
    expect(html).toContain('key on test');
    expect(html).toContain('Sat 3 Oct 10:00–10:30');
    expect(html).toContain('Only this occurrence');
    expect(html).not.toContain('abc123');
    expect(html).not.toContain('>Edit<');
    expect(html).toContain('Approve');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toMatch(/always need your approval/);
  });
});
