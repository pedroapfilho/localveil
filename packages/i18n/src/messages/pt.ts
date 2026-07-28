import type { Messages } from "./en";

const pt: Messages = {
  "app.language": "Idioma",
  "app.name": "localveil",
  "app.skipToContent": "Ir para o conteúdo",
  "app.tagline": "Oculte dados pessoais dos seus arquivos. Nada sai do seu dispositivo.",
  "download.button": "Baixar ZIP ({count})",
  "download.excluded": "{count} arquivos ficaram de fora porque falharam.",
  "download.waiting": "Oculte um arquivo para liberar o download.",
  "dropzone.formats": "Arquivos de texto, Markdown, CSV, JSON, log, PDF e imagem",
  "dropzone.hint": "ou arraste e solte aqui",
  "dropzone.label": "Escolher arquivos",
  "error.unknown": "Algo deu errado.",
  "files.heading": "Arquivos",
  "files.noRedactions": "Nada encontrado para ocultar",
  "files.redactions": "{count} ocultados",
  "files.remove": "Remover {name}",
  "footer.github": "Código no GitHub",
  "footer.heading": "Sobre o localveil",
  "footer.model": "Modelo de detecção",
  "footer.offline": "Funciona sem internet depois que o modelo é baixado.",
  "footer.summary":
    "O localveil encontra nomes, e-mails, telefones, endereços, datas e números de conta nos seus arquivos e cobre tudo isso. A detecção roda nesta aba, na sua própria máquina, então nada do que você solta aqui é enviado.",
  "model.downloading": "Baixando o modelo de detecção",
  "model.ready": "Modelo de detecção pronto",
  "model.slowDevice": "Rodando sem aceleração de GPU, isso vai demorar.",
  "stage.assembling": "Remontando o arquivo",
  "stage.detecting": "Procurando dados pessoais",
  "stage.extracting": "Lendo o documento",
  "stage.finished": "Concluído",
  "stage.loadingModel": "Carregando o modelo de detecção",
  "stage.reading": "Lendo o arquivo",
  "stage.recognising": "Lendo o texto da imagem",
  "stage.redacting": "Ocultando",
  "stage.rendering": "Renderizando as páginas",
  "status.done": "Pronto",
  "status.error": "Falhou",
  "status.queued": "Na fila",
  "status.running": "Processando",
  "toast.downloaded": "Seu ZIP está sendo baixado.",
  "toast.failed": "Não foi possível ocultar os dados de {name}.",
  "toast.unsupported": "{name} não é um tipo de arquivo suportado.",
  "warning.droppedCharacters":
    "Alguns caracteres não puderam ser gravados de volta no PDF, então partes dele não são mais pesquisáveis.",
  "warning.lowConfidence":
    "Parte do texto estava difícil de ler, então algum dado pessoal pode ter passado.",
  "warning.noText": "Nenhum texto legível foi encontrado neste arquivo.",
  "warning.scannedPages":
    "Este arquivo foi digitalizado em vez de digitado, então foi lido com OCR.",
};

export { pt };
