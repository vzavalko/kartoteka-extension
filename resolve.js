/* Узнаём настоящее название страницы по адресу.
   Расширению это можно: правила CSP страницы на него не распространяются,
   а CORS обходится выданным разрешением на домены. */

/* Сервисы с oEmbed отдают название сразу и без разбора HTML. */
const OEMBED = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, u => 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u)],
  [/(^|\.)vimeo\.com$/i,       u => 'https://vimeo.com/api/oembed.json?url=' + encodeURIComponent(u)],
  [/(^|\.)soundcloud\.com$/i,  u => 'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(u)],
  [/(^|\.)flickr\.com$/i,      u => 'https://www.flickr.com/services/oembed?format=json&url=' + encodeURIComponent(u)],
  [/(^|\.)ted\.com$/i,         u => 'https://www.ted.com/services/v1/oembed.json?url=' + encodeURIComponent(u)]
];
function oembedFor(url){
  let host; try{ host = new URL(url).hostname; }catch(e){ return null; }
  for(const [re, make] of OEMBED) if(re.test(host)) return make(url);
  return null;
}

/* Без DOM: этот файл подключается и в служебном воркере, где document нет. */
const ENT = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', laquo:'«', raquo:'»',
              mdash:'—', ndash:'–', hellip:'…', rsquo:'’', lsquo:'‘', ldquo:'“', rdquo:'”' };
function unescapeHtml(s){
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, g) => {
    if(g[0] === '#'){
      const n = /^#x/i.test(g) ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    const v = ENT[g.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* Читаем только начало страницы: <title> всегда в <head>, качать целиком незачем. */
async function headOf(url, limit){
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if(!r.ok && r.status !== 0) throw new Error('HTTP ' + r.status);
  const ct = r.headers.get('content-type') || '';
  if(ct && !/text\/html|application\/xhtml/i.test(ct)) throw new Error('не HTML');

  let bytes = new Uint8Array(0);
  const reader = r.body.getReader();
  while(bytes.length < limit){
    const { done, value } = await reader.read();
    if(done) break;
    const next = new Uint8Array(bytes.length + value.length);
    next.set(bytes); next.set(value, bytes.length);
    bytes = next;
    if(new TextDecoder('utf-8', { fatal: false }).decode(bytes).includes('</title>')) break;
  }
  try{ await reader.cancel(); }catch(e){}

  /* кодировка: из заголовка, иначе из <meta charset> — иначе русские сайты
     на windows-1251 приедут кракозябрами */
  let enc = (ct.match(/charset=([\w-]+)/i) || [])[1];
  const peek = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2048));
  if(!enc) enc = (peek.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  try{ return new TextDecoder(enc || 'utf-8', { fatal: false }).decode(bytes); }
  catch(e){ return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
}

async function resolveTitle(url){
  const o = oembedFor(url);
  if(o){
    try{
      const r = await fetch(o, { credentials: 'omit' });
      if(r.ok){
        const j = await r.json();
        if(j && j.title) return String(j.title).replace(/\s+/g,' ').trim();
      }
    }catch(e){}
  }
  try{
    const html = await headOf(url, 96 * 1024);
    const og = html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]*content=["']([^"']{2,300})/i)
            || html.match(/<meta[^>]*content=["']([^"']{2,300})["'][^>]*(?:property|name)=["']og:title["']/i);
    const t = html.match(/<title[^>]*>([\s\S]{1,400}?)<\/title>/i);
    const pick = (t && t[1]) || (og && og[1]) || '';
    return unescapeHtml(pick).replace(/\s+/g,' ').trim();
  }catch(e){ return ''; }
}
