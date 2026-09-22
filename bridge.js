/* Мост между страницей ZAKLADKA и расширением.
   Живёт только на своём домене — потому переезд на Pages и понадобился:
   к странице артефакта на служебном домене так не подключиться. */
/* Ключ сообщения переименован вместе с сервисом. Страница может оказаться
   старой (из кеша или по старому адресу) — понимаем оба имени, а свои письма
   подписываем сразу двумя. Когда всё обновится, вторую подпись можно убрать. */
const MARK = 'zakladka', MARK_OLD = 'kartoteka';
const signed = (kind, rest) => Object.assign({ [MARK]:kind, [MARK_OLD]:kind }, rest);

window.addEventListener('message', async e => {
  if(e.source !== window || !e.data) return;
  if(e.data[MARK] !== 'resolve' && e.data[MARK_OLD] !== 'resolve') return;
  const { id, urls } = e.data;
  if(!Array.isArray(urls)) return;
  let items = [];
  try{ items = await chrome.runtime.sendMessage({ type:'resolve', urls: urls.slice(0, 40) }); }
  catch(err){ items = []; }
  window.postMessage(signed('resolved', { id, items: items || [] }), location.origin);
});

/* Вкладки, сданные через попап, приезжают сюда и уходят прямо в страницу. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg || msg.type !== 'push' || !Array.isArray(msg.items)) return;
  window.postMessage(signed('push', { items: msg.items }), location.origin);
  reply({ ok: true });
  return false;
});

/* Здороваемся, чтобы страница знала: название можно спросить у расширения. */
window.postMessage(signed('hello', { version: chrome.runtime.getManifest().version }), location.origin);
