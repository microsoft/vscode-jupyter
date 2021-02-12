// This file will modify the package.json to have the engine equal to insiders
var fs = require('fs');
var packageJson = JSON.parse(fs.readFileSync('./tmp/extension/package.json'));

if (!packageJson.engines.vscode.includes('insider')) {
    packageJson.engines.vscode = `${packageJson.engines.vscode}-insider`;
    fs.writeFileSync('./tmp/extension/package.json', JSON.stringify(packageJson, null, 4));
}
