export function buildPdfJsHtml(base64Pdf: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background-color: #374151;
      color: #F3F4F6;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      width: 100%;
      min-height: 100%;
      overflow-x: auto;
      overflow-y: auto;
    }
    #viewer-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: max-content;
      min-width: 100%;
      padding: 8px;
      gap: 16px;
    }
    .page-container {
      background-color: #FFFFFF;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    canvas {
      display: block;
      max-width: none;
      height: auto;
    }
    #status-msg {
      padding: 30px 16px;
      text-align: center;
      font-size: 14px;
      color: #D1D5DB;
    }
  </style>
  <script src="file:///android_asset/pdfjs/pdf.min.js"></script>
</head>
<body>
  <div id="viewer-body">
    <div id="status-msg">Cargando reporte en PDF…</div>
    <div class="page-container" id="page-box" style="display:none;">
      <canvas id="pdf-canvas"></canvas>
    </div>
  </div>

  <script>
    var pdfData = atob("${base64Pdf}");
    var pdfDoc = null;
    var pageNum = 1;
    var pageRendering = false;
    var pageNumPending = null;
    var scale = 1.0;
    var canvas = document.getElementById('pdf-canvas');
    var ctx = canvas ? canvas.getContext('2d') : null;

    function sendBridge(type, payload) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, ...payload }));
        }
      } catch(e) {}
    }

    function renderPage(num) {
      if (!pdfDoc) return;
      pageRendering = true;
      pdfDoc.getPage(num).then(function(page) {
        var original = page.getViewport({ scale: 1 });
        var fitScale = Math.max(160, window.innerWidth - 16) / original.width;
        var viewport = page.getViewport({ scale: fitScale * scale });
        var outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4000000 / (viewport.width * viewport.height)));
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height = Math.floor(viewport.height) + "px";

        var transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
        var renderContext = {
          canvasContext: ctx,
          transform: transform,
          viewport: viewport
        };
        var renderTask = page.render(renderContext);
        renderTask.promise.then(function() {
          pageRendering = false;
          var statusEl = document.getElementById('status-msg');
          if (statusEl) statusEl.style.display = 'none';
          var boxEl = document.getElementById('page-box');
          if (boxEl) boxEl.style.display = 'flex';
          sendBridge('PAGE_UPDATE', { current: num, total: pdfDoc.numPages, zoom: scale });
          if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
          }
        }).catch(function() {
          pageRendering = false;
          sendBridge('ERROR', {});
        });
      }).catch(function(err) {
        pageRendering = false;
        var statusEl = document.getElementById('status-msg');
        if (statusEl) statusEl.innerText = 'No se pudo mostrar esta página. Vuelve a abrir el documento.';
      });
    }

    function queueRenderPage(num) {
      if (pageRendering) {
        pageNumPending = num;
      } else {
        renderPage(num);
      }
    }

    window.prevPage = function() {
      if (pageNum <= 1) return;
      pageNum--;
      queueRenderPage(pageNum);
    };

    window.nextPage = function() {
      if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
      pageNum++;
      queueRenderPage(pageNum);
    };

    window.zoomIn = function() {
      if (scale >= 3.0) return;
      scale += 0.25;
      queueRenderPage(pageNum);
    };

    window.zoomOut = function() {
      if (scale <= 0.5) return;
      scale -= 0.25;
      queueRenderPage(pageNum);
    };

    window.resetZoom = function() {
      scale = 1.0;
      queueRenderPage(pageNum);
    };
    window.addEventListener('resize', function() { queueRenderPage(pageNum); });

    try {
      if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'file:///android_asset/pdfjs/pdf.worker.min.js';
        var loadingTask = pdfjsLib.getDocument({ data: pdfData, isEvalSupported: false, enableXfa: false });
        loadingTask.promise.then(function(pdf) {
          pdfDoc = pdf;
          sendBridge('PAGE_UPDATE', { current: 1, total: pdf.numPages, zoom: 1.0 });
          renderPage(1);
        }).catch(function(err) {
          var statusEl = document.getElementById('status-msg');
          if (statusEl) statusEl.innerText = 'No se pudo abrir este PDF. Vuelve a intentarlo.';
          sendBridge('ERROR', { error: err.message });
        });
      } else {
        var statusEl = document.getElementById('status-msg');
        if (statusEl) statusEl.innerText = 'Cargando visor PDF…';
      }
    } catch(e) {
      var statusEl = document.getElementById('status-msg');
      if (statusEl) statusEl.innerText = 'No se pudo abrir el visor. Vuelve a intentarlo.';
    }
  </script>
</body>
</html>`;
}
