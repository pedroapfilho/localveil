import type { Messages } from "./en";

const es: Messages = {
  "app.language": "Idioma",
  "app.name": "localveil",
  "app.skipToContent": "Ir al contenido",
  "app.tagline": "Oculta los datos personales de tus archivos. Nada sale de tu dispositivo.",
  "download.button": "Descargar ZIP ({count})",
  "download.excluded": "{count} archivos quedaron fuera porque fallaron.",
  "download.waiting": "Oculta un archivo para habilitar la descarga.",
  "dropzone.formats": "Archivos de texto, Markdown, CSV, JSON, log, PDF e imagen",
  "dropzone.hint": "o arrástralos aquí",
  "dropzone.label": "Elegir archivos",
  "error.unknown": "Algo salió mal.",
  "files.heading": "Archivos",
  "files.noRedactions": "No se encontró nada que ocultar",
  "files.redactions": "{count} ocultados",
  "files.remove": "Quitar {name}",
  "footer.github": "Código en GitHub",
  "footer.heading": "Acerca de localveil",
  "footer.model": "Modelo de detección",
  "footer.offline": "Funciona sin conexión una vez descargado el modelo.",
  "footer.summary":
    "localveil encuentra nombres, correos, teléfonos, direcciones, fechas y números de cuenta en tus archivos y los tapa. La detección se ejecuta en esta pestaña, en tu propia máquina, así que nada de lo que sueltas aquí se envía.",
  "model.downloading": "Descargando el modelo de detección",
  "model.ready": "Modelo de detección listo",
  "model.slowDevice": "Funcionando sin aceleración de GPU, esto será lento.",
  "stage.assembling": "Rearmando el archivo",
  "stage.detecting": "Buscando datos personales",
  "stage.extracting": "Leyendo el documento",
  "stage.finished": "Finalizado",
  "stage.loadingModel": "Cargando el modelo de detección",
  "stage.reading": "Leyendo el archivo",
  "stage.recognising": "Leyendo el texto de la imagen",
  "stage.redacting": "Ocultando",
  "stage.rendering": "Renderizando las páginas",
  "status.done": "Listo",
  "status.error": "Falló",
  "status.queued": "En cola",
  "status.running": "Procesando",
  "toast.downloaded": "Tu ZIP se está descargando.",
  "toast.failed": "No se pudieron ocultar los datos de {name}.",
  "toast.unsupported": "{name} no es un tipo de archivo admitido.",
  "warning.droppedCharacters":
    "Algunos caracteres no se pudieron escribir de vuelta en el PDF, así que partes ya no se pueden buscar.",
  "warning.lowConfidence":
    "Parte del texto era difícil de leer, así que puede haberse escapado algún dato personal.",
  "warning.noText": "No se encontró texto legible en este archivo.",
  "warning.scannedPages":
    "Este archivo fue escaneado en lugar de escrito, así que se leyó con OCR.",
};

export { es };
