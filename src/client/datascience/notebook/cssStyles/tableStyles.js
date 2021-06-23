var tableStyleSheet = document.createElement('style');
tableStyleSheet.innerHTML = "#container > div > div:not(.preview) > div {overflow-x: overlay;}";
document.body.appendChild(tableStyleSheet);