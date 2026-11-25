import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4174);
const defaultBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
const defaultModel = 'gemini-3.1-flash-lite';
let config = { base: defaultBase, key: '', model: defaultModel };
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function loadConfig() {
  let env = {};
  try { env = parseEnv(await readFile(resolve(root, '.env'), 'utf8')); } catch {}
  config = {
    base: (process.env.CLOUD_API_BASE || env.CLOUD_API_BASE || defaultBase).replace(/\/$/, ''),
    key: process.env.CLOUD_API_KEY || env.CLOUD_API_KEY || '',
    model: process.env.CLOUD_MODEL || env.CLOUD_MODEL || defaultModel
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('El envío supera el límite de 8 MB. Reduce el tamaño o el número de imágenes.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function isLocalRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && Number(parsed.port) === port;
  } catch { return false; }
}

async function saveSettings(request, response) {
  if (!isLocalRequest(request)) return sendJson(response, 403, { error: 'Solo se aceptan ajustes desde esta aplicación local.' });
  const body = await readJson(request, 20 * 1024);
  const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel;
  if (key.length > 500 || /[\r\n]/.test(key)) return sendJson(response, 400, { error: 'La clave no tiene un formato válido.' });
  if (model.length > 120 || /[\r\n]/.test(model)) return sendJson(response, 400, { error: 'El nombre del modelo no tiene un formato válido.' });
  config.key = key;
  config.model = model;
  config.base = defaultBase;
  const env = `# Clave local: este archivo está excluido de Git por .gitignore.\nCLOUD_API_BASE=${config.base}\nCLOUD_API_KEY=${key}\nCLOUD_MODEL=${model}\n`;
  await writeFile(resolve(root, '.env'), env, { encoding: 'utf8', mode: 0o600 });
  sendJson(response, 200, { configured: Boolean(config.key), model: config.model });
}

async function generate(request, response) {
  if (!isLocalRequest(request)) return sendJson(response, 403, { error: 'Solo se aceptan solicitudes desde esta aplicación local.' });
  const body = await readJson(request);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const mode = body.mode === 'content' ? 'content' : 'study';
  const images = Array.isArray(body.images) ? body.images : [];
  if (!prompt) return sendJson(response, 400, { error: 'Escribe una instrucción antes de continuar.' });
  if (!body.consent) return sendJson(response, 400, { error: 'Confirma que quieres enviar este material al proveedor de IA.' });
  if (!config.key) return sendJson(response, 503, { error: 'Conecta Gemini API desde Ajustes antes de generar.' });
  if (prompt.length > 40000) return sendJson(response, 413, { error: 'El texto supera el límite de 40.000 caracteres. Reduce las páginas seleccionadas.' });
  if (images.length > 4) return sendJson(response, 400, { error: 'Puedes enviar hasta cuatro fotos a la vez.' });
  for (const image of images) {
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 1_500_000) {
      return sendJson(response, 400, { error: 'Una imagen no es válida o supera el tamaño permitido. Prueba con menos fotos.' });
    }
  }

  const system = mode === 'study'
    ? 'Eres un tutor paciente. Responde en español, explica paso a paso, distingue claramente lo que ves en las fuentes de lo que infieres y señala si una foto es ilegible. No inventes datos ni soluciones; cita la página o imagen cuando sea posible.'
    : 'Eres un asistente de creación de contenido. Responde en español con propuestas concretas, originales y listas para adaptar. Mantén el formato pedido y evita inventar información sobre clips que no se hayan descrito.';
  const userContent = [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))];
  try {
    const upstream = await fetch(`${config.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], temperature: 0.45 }),
      signal: AbortSignal.timeout(90000)
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 400 : upstream.status >= 500 ? 502 : upstream.status;
      const detail = result.error?.message || result.error || `El proveedor respondió ${upstream.status}.`;
      return sendJson(response, status, { error: String(detail).slice(0, 500) });
    }
    const text = result.choices?.[0]?.message?.content;
    if (!text) return sendJson(response, 502, { error: 'El proveedor no devolvió texto.' });
    sendJson(response, 200, { text, model: config.model });
  } catch (error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'La respuesta tardó demasiado. Inténtalo de nuevo con menos material.' : 'No se pudo conectar con el proveedor. Comprueba la conexión a internet.';
    sendJson(response, 502, { error: message });
  }
}

async function serveStatic(pathname, response) {
  let requested;
  try { requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname); }
  catch { return sendJson(response, 400, { error: 'Ruta no válida.' }); }
  if (requested.split('/').some(part => part.startsWith('.')) || requested.includes('\\')) return sendJson(response, 404, { error: 'No encontrado.' });
  const filePath = resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${resolve(root)}${sep}`)) return sendJson(response, 403, { error: 'Ruta no permitida.' });
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(body);
  } catch { sendJson(response, 404, { error: 'No encontrado.' }); }
}

await loadConfig();
const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/api/status') {
    sendJson(response, 200, { configured: Boolean(config.key), model: config.model });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/settings') {
    try { await saveSettings(request, response); }
    catch (error) { sendJson(response, 400, { error: error.message || 'No se pudieron guardar los ajustes.' }); }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/generate') {
    try { await generate(request, response); }
    catch (error) { sendJson(response, 400, { error: error.message || 'No se pudo procesar la solicitud.' }); }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Método no permitido.' });
  await serveStatic(url.pathname, response);
});

server.listen(port, host, () => console.log(`Herramientas locales disponibles en http://${host}:${port}`));
