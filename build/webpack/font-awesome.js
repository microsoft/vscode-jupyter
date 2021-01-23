addCSS('https://use.fontawesome.com/releases/v5.8.1/css/all.css');

function addCSS(filename) {
    var head = document.head;

    var style = document.createElement('link');
    style.href = filename;
    style.type = 'text/css';
    style.rel = 'stylesheet';

    head.append(style);
}
