// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
const getPublicPath = () => {
    return new URL(scriptUrl.replace(/[^/]+$/, '')).toString();
};
const uri = getPublicPath() + 'node_modules/font-awesome/css/font-awesome.min.css';
addCSS(uri);

function addCSS(filename) {
    const head = document.head;

    const style = document.createElement('link');
    style.href = filename;
    style.type = 'text/css';
    style.rel = 'stylesheet';

    head.append(style);
}
