const pageMode = document.body.dataset.mode || 'home';
const MAX_IMAGES = 4;
const state = { images: [], pdfs: [], busy: false, toastTimer: null };
const $ = selector => document.querySelector(selector);
const toast = message => {
  const node = $('#toast');
  if (!node) return;
  clearTimeout(state.toastTimer);
  node.textContent = message;
  node.classList.add('show');
  state.toastTimer = setTimeout(() => node.classList.remove('show'), 2800);
};

async function refreshStatus() {
  const status = $('#connection-status');
  if (!status) return;
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    status.textContent = data.configured ? `IA conectada · ${data.model}` : 'IA sin conectar';
    status.className = `status ${data.configured ? 'ready' : ''}`;
  } catch {
    status.textContent = 'Inicia la herramienta';
    status.className = 'status error';
  }
}

function setupSettings() {
  const dialog = $('#settings-dialog');
  $('#settings-open')?.addEventListener('click', () => dialog.showModal());
  $('#settings-close')?.addEventListener('click', () => dialog.close());
  $('#settings-cancel')?.addEventListener('click', () => dialog.close());
  $('#settings-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const key = $('#api-key').value.trim();
    if (!key) return toast('Pega la clave API para guardar la conexión.');
    const button = $('#settings-save');
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key, model: 'gemini-3.1-flash-lite' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar.');
      $('#api-key').value = '';
      dialog.close();
      toast('Conexión guardada en este ordenador.');
      refreshStatus();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.textContent = 'Guardar conexión'; }
  });
}

function addFilePill(name, remove) {
  const list = $('#file-list');
  const row = document.createElement('div');
  row.className = 'file-pill';
  const label = document.createElement('span');
  label.textContent = name;
  const button = document.createElement('button');
  button.type = 'button'; button.setAttribute('aria-label', `Quitar ${name}`); button.textContent = '×';
  button.addEventListener('click', () => { remove(); row.remove(); });
  row.append(label, button); list.append(row);
}

async function imageToDataUrl(file) {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1500 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL('image/jpeg', 0.78);
}

async function extractPdfText(file) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 30); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = content.items.map(item => item.str || '').join(' ').trim();
    if (line) pages.push(`[Página ${pageNumber}] ${line}`);
    if (pages.join('\n').length > 32000) break;
  }
  return { text: pages.join('\n\n').slice(0, 32000), pages: pdf.numPages };
}

async function handleStudyFiles(files) {
  const selected = [...files];
  for (const file of selected) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size > 18 * 1024 * 1024) { toast(`${file.name}: el PDF supera 18 MB.`); continue; }
      toast(`Leyendo ${file.name} en este ordenador…`);
      try {
        const parsed = await extractPdfText(file);
        if (!parsed.text) toast(`${file.name}: no contiene texto legible. Añade fotos de las páginas escaneadas.`);
        const item = { name: file.name, text: parsed.text };
        state.pdfs.push(item);
        addFilePill(`${file.name} · ${parsed.pages} páginas`, () => { state.pdfs = state.pdfs.filter(pdf => pdf !== item); });
      } catch { toast('No se pudo leer el PDF. Comprueba la conexión y vuelve a seleccionarlo.'); }
    } else if (file.type.startsWith('image/')) {
      if (state.images.length >= MAX_IMAGES) { toast('Puedes añadir hasta cuatro fotos por consulta.'); break; }
      try {
        const data = await imageToDataUrl(file);
        const item = { name: file.name, data };
        state.images.push(item);
        addFilePill(`${file.name} · foto preparada`, () => { state.images = state.images.filter(image => image !== item); });
      } catch { toast(`No se pudo leer ${file.name}. Prueba con JPG o PNG.`); }
    } else toast('Elige un PDF o una imagen JPG, PNG o WebP.');
  }
  if (selected.length) toast('Archivos preparados localmente. Se enviarán solo cuando pulses Generar y confirmes.');
}

function setupStudyFiles() {
  const input = $('#study-files');
  if (!input) return;
  $('#pick-files')?.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => { await handleStudyFiles(input.files); input.value = ''; });
  const zone = $('#dropzone');
  zone?.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone?.addEventListener('drop', async event => { event.preventDefault(); zone.classList.remove('drag'); await handleStudyFiles(event.dataTransfer.files); });
}

const taskPrompts = {
  summary: 'Resume el material en español. Organiza el resultado en: idea central, conceptos clave, explicación breve y dudas que conviene revisar.',
  explain: 'Explícame el material paso a paso, como a una persona que lo está aprendiendo por primera vez. Usa ejemplos sencillos y aclara los términos técnicos.',
  quiz: 'Crea un quiz de 8 preguntas basado solo en el material. Mezcla preguntas de elección múltiple y respuesta corta. Incluye las respuestas al final, separadas para que se puedan ocultar al estudiar.',
  flashcards: 'Crea 12 flashcards basadas en el material. Usa el formato Frente: / Reverso: y una sola idea por tarjeta. No inventes datos que no aparezcan en las fuentes.'
};

function setupStudy() {
  if (pageMode !== 'study') return;
  setupStudyFiles();
  document.querySelectorAll('[data-study-task]').forEach(button => button.addEventListener('click', () => generateStudy(button.dataset.studyTask)));
}

async function generateStudy(task) {
  const question = $('#study-question').value.trim();
  if (!state.pdfs.some(pdf => pdf.text) && state.images.length === 0 && !question) return toast('Añade un PDF, una foto o escribe una pregunta.');
  if (!$('#consent').checked) return toast('Confirma el envío del material a Gemini antes de generar.');
  const pdfText = state.pdfs.map(pdf => pdf.text).filter(Boolean).join('\n\n').slice(0, 32000);
  const context = [pdfText ? `MATERIAL EXTRAÍDO DE PDF:\n${pdfText}` : '', question ? `PREGUNTA O CONTEXTO DEL ESTUDIANTE:\n${question}` : ''].filter(Boolean).join('\n\n');
  const prompt = `${taskPrompts[task]}\n\n${context || 'Analiza las fotos adjuntas y responde de forma fundamentada.'}`;
  await requestAI(prompt, state.images.map(image => image.data), 'study');
}

const contentPrompts = {
  ideas: values => `Propón 10 ideas originales para ${values.platform}. Tema o canal: ${values.topic}. Tono: ${values.tone}. Incluye un gancho de una línea para cada idea.`,
  script: values => `Escribe un guion de ${values.duration} para ${values.platform}. Tema: ${values.topic}. Tono: ${values.tone}. Estructura: gancho inicial, desarrollo en bloques breves, cierre y texto sugerido en pantalla.`,
  subtitles: values => `Adapta el siguiente guion o transcripción a subtítulos para ${values.platform}. Usa frases breves, legibles y con ritmo. No inventes contenido.\n\n${values.transcript || values.topic}`,
  plan: values => `Crea un plan de edición para un vídeo de ${values.duration} en formato ${values.platform}. Idea: ${values.topic}. Tono: ${values.tone}. Devuelve una tabla textual con tiempo aproximado, imagen/acción, texto en pantalla y sonido. No afirmes haber visto un clip.\n\n${values.transcript ? `Notas o transcripción: ${values.transcript}` : ''}`
};

function setupContent() {
  if (pageMode !== 'content') return;
  document.querySelectorAll('[data-content-task]').forEach(button => button.addEventListener('click', () => {
    const values = { topic: $('#topic').value.trim(), platform: $('#platform').value, tone: $('#tone').value, duration: $('#duration').value, transcript: $('#transcript').value.trim() };
    if (!values.topic && !values.transcript) return toast('Escribe una idea o una transcripción para empezar.');
    if (!$('#consent').checked) return toast('Confirma el envío de este texto a Gemini antes de generar.');
    requestAI(contentPrompts[button.dataset.contentTask](values), [], 'content');
  }));
}

async function requestAI(prompt, images, mode) {
  if (state.busy) return;
  const output = $('#result');
  const generateButtons = document.querySelectorAll('[data-study-task], [data-content-task]');
  state.busy = true;
  generateButtons.forEach(button => button.disabled = true);
  output.classList.remove('empty'); output.textContent = 'Generando respuesta…';
  try {
    const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, images, mode, consent: true }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    output.textContent = data.text;
    toast('Respuesta lista.');
  } catch (error) { output.classList.add('empty'); output.textContent = error.message; }
  finally { state.busy = false; generateButtons.forEach(button => button.disabled = false); }
}

$('#copy-result')?.addEventListener('click', async () => {
  const text = $('#result')?.innerText || '';
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Resultado copiado.'); }
  catch { toast('No se pudo copiar desde este navegador.'); }
});

setupSettings();
setupStudy();
setupContent();
refreshStatus();
