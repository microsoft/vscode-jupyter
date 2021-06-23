// This file is a preload just for current release bits, it updates vscode core styles + dataframe styles to allow
// for horizontal scrolling in native notebook table elements
var tableStyleSheet = document.createElement('style');
tableStyleSheet.innerHTML = `#container > div > div:not(.preview) > div {overflow-x: overlay;};`;
document.body.appendChild(tableStyleSheet);
var dataframes = document.getElementsByClassName('dataframe');
for(i=0;i<dataframes.length;i++) {
    dataframes[0].parentElement.style.width = '100%';
    dataframes[0].parentElement.style.overflowX = 'auto';
}