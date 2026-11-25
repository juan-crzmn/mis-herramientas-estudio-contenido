# Mis herramientas

Dos herramientas separadas para estudiar y preparar contenido. El proyecto no instala modelos locales y no necesita paquetes npm. La interfaz y el servidor local usan Node.js 20 o posterior.

## Herramientas

- **Estudio:** acepta fotos JPG, PNG o WebP y PDF. El texto de los PDF con texto seleccionable se extrae en el navegador. Genera resúmenes, explicaciones paso a paso, quizzes y flashcards.
- **Contenido:** crea ideas, guiones, subtítulos a partir de una transcripción o notas, y planes de edición para Shorts, TikTok, YouTube y gameplay. No edita ni transcribe vídeos directamente; Kadro puede usarse para montar el vídeo.

## Inicio

1. Instala Node.js 20 o posterior si todavía no está instalado.
2. Ejecuta `start.bat`.
3. Abre `http://127.0.0.1:4174`.
4. Pulsa **Ajustes de IA** y pega una clave creada en [Google AI Studio](https://aistudio.google.com/app/apikey).
5. Añade material, marca la casilla de consentimiento y pulsa una acción.

El modelo configurado es `gemini-3.1-flash-lite`. Tiene cuota gratuita sujeta a límites que Google puede modificar. El nivel gratuito permite que Google use solicitudes y respuestas para mejorar sus productos. Por eso la app avisa y exige confirmación antes de enviar material. No uses documentos confidenciales con este modo.

## Archivos y privacidad

- El servidor solo escucha en `127.0.0.1` y no publica el puerto en la red local.
- La clave se guarda en `.env` en este ordenador. `.gitignore` excluye ese archivo; **nunca subas claves a GitHub**.
- Los archivos no se guardan en el servidor. Las fotos se reducen en memoria en el navegador. Los PDF con texto se leen en el navegador y se manda el texto al proveedor solo al generar.
- Los PDF escaneados sin capa de texto no se extraen; usa fotos de sus páginas.
- La lectura de PDF carga PDF.js 6.5.438 desde jsDelivr. Requiere internet para obtener esa biblioteca.
- Las preguntas y el material que confirmes enviar se procesan en Google Gemini API. Revisa sus límites y condiciones antes de usarlo.

## GitHub

Este repositorio puede alojar el código. GitHub Pages puede mostrar las páginas, pero no ejecutar el servidor local ni proteger una clave de API. Para esta versión, descarga/clona el código y ejecútalo en tu propio ordenador. Si más adelante quieres una web pública conectada a IA, necesitarás un backend HTTPS desplegado y una gestión segura de secretos.

No se guardan conversaciones ni resultados entre reinicios. La clave sí permanece en `.env` local.
