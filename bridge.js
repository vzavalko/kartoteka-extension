/* Мост между страницей ZAKLADKA и расширением.
   Живёт только на своём домене — потому переезд на Pages и понадобился:
   к странице артефакта на служебном домене так не подключиться. */
/* Ключ сообщения переименован вместе с сервисом. Страница может оказаться
   старой (из кеша или по старому адресу) — понимаем оба имени, а свои письма
   подписываем сразу двумя. Когда всё обновится, вторую подпись можно убрать. */
const MARK = 'zakladka', MARK_OLD = 'kartoteka';
const signed = (kind, rest) => Object.assign({ [MARK]:kind, [MARK_OLD]:kind }, rest);
const post = (kind, rest) => window.postMessage(signed(kind, rest), location.origin);

/* Страница спрашивает — мы пересылаем в фоновый скрипт и возвращаем ответ
   с тем же id. Односложная таблица: что пришло → что спросить → чем ответить. */
const ASKS = {
  resolve: [m => ({ type:'resolve', urls:(m.urls || []).slice(0, 40) }), (r, id) => ['resolved', { id, items:r || [] }]],
  tabs:    [()  => ({ type:'tabs' }),                                   (r, id) => ['tabs-list', { id, items:r || [] }]],
  close:   [m => ({ type:'close', ids:m.ids || [] }),                   (r, id) => ['closed', { id, closed:(r && r.closed) || 0 }]],
  alive:   [m => ({ type:'alive', urls:m.urls || [] }),                 (r, id) => ['alive-done', { id, denied:!!(r && r.denied), items:(r && r.items) || [] }]],
  backup:  [m => ({ type:'backup', json:m.json, links:m.links, force:m.force }),
                                                                        (r, id) => ['backup-done', { id, saved:!!(r && r.saved), at:r && r.at }]]
};

window.addEventListener('message', async e => {
  if(e.source !== window || !e.data) return;
  const kind = e.data[MARK] || e.data[MARK_OLD];
  const spec = ASKS[kind];
  if(!spec) return;
  const [ask, answer] = spec;
  let out = null;
  try{ out = await chrome.runtime.sendMessage(ask(e.data)); }catch(err){ out = null; }
  post(...answer(out, e.data.id));
});

/* Вкладки, сданные через попап, приезжают сюда и уходят прямо в страницу.
   Оттуда же приходит обновлённый список открытых вкладок. */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if(!msg) return;
  if(msg.type === 'push' && Array.isArray(msg.items)){
    post('push', { items: msg.items });
    reply({ ok: true });
    return false;
  }
  if(msg.type === 'tablist' && Array.isArray(msg.items)){
    post('tabs-list', { id: 0, items: msg.items });
    reply({ ok: true });
    return false;
  }
});

/* Здороваемся, чтобы страница знала: название можно спросить у расширения. */
post('hello', { version: chrome.runtime.getManifest().version });
