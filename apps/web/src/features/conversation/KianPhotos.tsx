import { useEffect, useState } from 'react';
import { apiBlob } from '../../api.js';

/** Kian's own photos under his answer. They are fetched with the user's token (they are not public files) and shown as a small gallery. */
export function KianPhotos({ ids, load = apiBlob }: { ids: string[]; load?: (path: string) => Promise<Blob> }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    for (const id of ids) {
      load(`/persona/photos/${encodeURIComponent(id)}`).then(blob => {
        const url = URL.createObjectURL(blob);
        made.push(url);
        if (alive) setUrls(current => ({ ...current, [id]: url })); else URL.revokeObjectURL(url);
      }).catch(() => {});
    }
    return () => { alive = false; made.forEach(url => URL.revokeObjectURL(url)); };
  }, [ids.join(',')]);
  return <div className="kian-photos" role="group" aria-label="Photos of Kian">
    {ids.map((id, i) => urls[id]
      ? <a key={id} href={urls[id]} target="_blank" rel="noopener noreferrer" aria-label={`Open photo ${i + 1} of Kian`}><img src={urls[id]} alt={`Photo ${i + 1} of Kian`} loading="lazy" /></a>
      : <span key={id} className="kian-photo-loading" aria-hidden="true" />)}
  </div>;
}
