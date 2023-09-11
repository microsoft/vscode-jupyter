// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { EOL } = require('os');
const fs = require('fs');
const path = require('path');

fs.copyFileSync(path.join(__dirname, '../src/api.d.ts'), path.join(__dirname, 'api.d.ts'));

if (process.env.npm_config_tag === 'proposed') {
    fs.readdirSync(path.join(__dirname, '../src')).forEach((file) => {
        if (file.startsWith('api.proposed.') && file.endsWith('.d.ts')) {
            const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').toString();
            fs.writeFileSync(
                path.join(__dirname, file),
                source.replace(`declare module './api' {`, `declare module '@vscode/jupyter-extension' {`)
            );
        }
    });

    // Add module namespace to the main api.d.ts file.
    // Required for module augmentation to work.
    const source = fs.readFileSync(path.join(__dirname, 'api.d.ts'), 'utf8').toString();
    let foundFirstExport = false;
    const tab = '    '; // 4 spaces used as tab size in source formatting.
    const newSource = source
        .split(/\r?\n/g)
        .map((line) => {
            if (line.startsWith('export ') && !foundFirstExport) {
                foundFirstExport = true;
                return [`declare module '@vscode/jupyter-extension' {`, `${tab}${line}`].join(EOL);
            }
            if (foundFirstExport) {
                `${tab}${line}`;
            }
            return line;
        })
        .join(EOL);
    fs.writeFileSync(path.join(__dirname, 'api.d.ts'), newSource.trim() + EOL + '}' + EOL);
}
