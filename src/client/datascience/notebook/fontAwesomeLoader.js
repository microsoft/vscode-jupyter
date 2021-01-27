var vscodeApi = acquireApi();
vscodeApi.postMessage({ type: 'GetFontAwesomeUriRequest' });

function acquireApi() {
    if (!vscodeApi && typeof acquireVsCodeApi !== 'undefined') {
        vscodeApi = acquireVsCodeApi();
    } else if (!vscodeApi && typeof window.acquireVsCodeApi !== 'undefined') {
        vscodeApi = window.acquireVsCodeApi();
    }

    window.addEventListener('message', baseHandler);

    return vscodeApi;
}

function baseHandler(e) {
    if (e.data.type === 'GetFontAwesomeUriResponse' && e.data.payload) {
        addCSS(e.data.payload.path);
    }
}

function addCSS(filename) {
    var head = document.head;

    var style = document.createElement('link');
    style.href = filename;
    style.type = 'text/css';
    style.rel = 'stylesheet';

    head.append(style);
}
