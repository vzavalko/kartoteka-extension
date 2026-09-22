/* Мост между страницей Картотеки и расширением.
   Живёт только на своём домене — потому переезд на Pages и понадобился:
   к странице артефакта на служебном домене так не подключиться. */
const MARK = 'kartoteka';

window.addEventListener('message', async e => {
  if(e.source !== window || !e.data || e.data[MARK] !== 'resolve') return;
  const { id, urls } = e.data;
  if(!Array.isArray(urls)) return;
  let items = [];
  try{ items = await chrome.runtime.sendMessage({ type:'resolve', urls: urls.slice(0, 40) }); }
  catch(err){ items = []; }
  window.postMessage({ [MARK]:'resolved', id, items: items || [] }, location.origin);
});

/* Вкладки, сданные через попап, приезжают сюда и уходят прямо в страницу. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'push' || !Array.isArray(msg.items)) return;
  window.postMessage({ [MARK]:'push', items: msg.items }, location.origin);
  reply({ ok: true });
  return false;
});

/* Здороваемся, чтобы страница знала: название можно спросить у расширения. */
window.postMessage({ [MARK]:'hello', version: chrome.runtime.getManifest().version }, location.origin);
