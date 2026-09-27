/**
 * Сервис-посредник для оценки КБЖУ по фотографии еды.
 *
 * Зачем он нужен: приложение лежит в публичном репозитории, и ключ Claude API
 * в нём держать нельзя — его увидит кто угодно и будет тратить ваши деньги.
 * Ключ живёт здесь, на стороне сервиса, и наружу не отдаётся.
 *
 * Развёртывание — Cloudflare Workers, см. worker/README.md.
 *
 * Здесь используется обычный fetch, а не Anthropic SDK: воркер задуман так,
 * чтобы его можно было вставить в панель Cloudflare без сборки и npm.
 *
 * Переменные окружения (задаются в панели Cloudflare):
 *   ANTHROPIC_API_KEY — ключ из console.anthropic.com  (обязательно, Secret)
 *   ALLOWED_ORIGIN    — адрес приложения, например https://zhivagoignat-boop.github.io
 *   ACCESS_TOKEN      — свой пароль (необязательно): приложение шлёт его в Authorization
 */

const MODEL = 'claude-opus-5';   // дешевле: claude-sonnet-5 или claude-haiku-4-5
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const SYSTEM = `Ты оцениваешь еду на фотографии для дневника питания человека,
который худеет на дефиците калорий.

Правила:
- Перечисли отдельно каждое блюдо или продукт, которые видишь.
- Оцени размер порции по фотографии: посуда, приборы, руки рядом дают масштаб.
- Учитывай невидимое: масло, на котором жарили, заправку салата, сахар в соусе.
  Для ресторанной еды закладывай больше жира, чем кажется.
- Значения указывай на всю порцию, а не на 100 г.
- Лучше честная средняя оценка, чем заниженная. Если сомневаешься между
  двумя значениями, бери большее.
- Названия — по-русски.
- В comment напиши одну короткую фразу о том, что осталось неясным
  (например, «непонятно, сколько масла в заправке»).`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'string', description: 'Название блюда по-русски' },
          portion: { type: 'string', description: 'Оценка порции, например «250 г» или «1 тарелка»' },
          k: { type: 'number', description: 'Калории на всю порцию' },
          p: { type: 'number', description: 'Белок, г' },
          f: { type: 'number', description: 'Жир, г' },
          c: { type: 'number', description: 'Углеводы, г' },
          fb: { type: 'number', description: 'Клетчатка, г' }
        },
        required: ['n', 'portion', 'k', 'p', 'f', 'c', 'fb'],
        additionalProperties: false
      }
    },
    comment: { type: 'string', description: 'Одна фраза о неопределённости оценки' }
  },
  required: ['items', 'comment'],
  additionalProperties: false
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Только POST' }, 405, cors);

    if (env.ACCESS_TOKEN) {
      const auth = request.headers.get('Authorization') || '';
      if (auth !== 'Bearer ' + env.ACCESS_TOKEN) return json({ error: 'Неверный пароль' }, 401, cors);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'На сервисе не задан ANTHROPIC_API_KEY' }, 500, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Ожидается JSON' }, 400, cors); }

    const image = body && body.image;
    if (!image || typeof image !== 'string') return json({ error: 'Нет поля image (base64)' }, 400, cors);
    if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ error: 'Фото слишком большое' }, 413, cors);

    const mediaType = /^image\/(jpeg|png|webp|gif)$/.test(body.media_type || '') ? body.media_type : 'image/jpeg';

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          system: SYSTEM,
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: SCHEMA }
          },
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
              { type: 'text', text: 'Что здесь и сколько в этом КБЖУ и клетчатки?' }
            ]
          }]
        })
      });
    } catch (e) {
      return json({ error: 'Не достучались до Claude API: ' + e.message }, 502, cors);
    }

    if (!res.ok) {
      const text = await res.text();
      return json({ error: 'Claude API вернул ' + res.status, detail: text.slice(0, 500) }, 502, cors);
    }

    const data = await res.json();

    // отказ модели — отдельный случай, content при нём читать нельзя
    if (data.stop_reason === 'refusal') {
      return json({ error: 'Модель отказалась обрабатывать это изображение' }, 422, cors);
    }

    const parsed = data.parsed_output || parseJsonFromContent(data.content);
    if (!parsed || !Array.isArray(parsed.items)) {
      return json({ error: 'Не удалось разобрать ответ модели' }, 502, cors);
    }

    return json({
      items: parsed.items,
      comment: parsed.comment || '',
      usage: data.usage ? { in: data.usage.input_tokens, out: data.usage.output_tokens } : undefined
    }, 200, cors);
  }
};

/* Запасной разбор: если parsed_output не пришёл, JSON лежит в текстовом блоке */
function parseJsonFromContent(content) {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (block.type !== 'text' || !block.text) continue;
    try { return JSON.parse(block.text); } catch { /* пробуем следующий блок */ }
  }
  return null;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors }
  });
}
