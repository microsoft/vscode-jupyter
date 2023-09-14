// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { EOL } = require('os');
const fs = require('fs');
const path = require('path');

// For stable we only ship the api.d.ts file.
fs.copyFileSync(path.join(__dirname, '../src/api.d.ts'), path.join(__dirname, 'api.d.ts'));

// For proposed API, we need to merge all proposed API files into a single file.
// Anyone installing the proposed tag will get all of the proposed API
// Today we have at lest 3 extensions that manually pull down *.d.ts files via some automated scripts, shipping proposed API
// in the npm makes it easier for other consumers as well (DW, AzML, Synapse, etc).

// Ensure all imports are on top
// Ensure we have a module declaration that matches the npm package name.
// Duplicate imports is not a problem.

let proposedApi = '';
let proposedApiImports = [];
const tab = '    '; // 4 spaces used as tab size in source formatting.
const newModuleDeclaration = `declare module '@vscode/jupyter-extension' {`;
fs.readdirSync(path.join(__dirname, '../src')).forEach((file) => {
    if (file.startsWith('api.proposed.') && file.endsWith('.d.ts')) {
        console.error(file);
        let source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8').toString();
        let foundFirstExport = false;
        const newSource = source
            .replace(`declare module './api' {`, newModuleDeclaration)
            .split(/\r?\n/g)
            .filter((line) => {
                if (foundFirstExport) {
                    return true;
                }
                if (line.startsWith('import ') && line.trim().endsWith(';')) {
                    if (!proposedApiImports.includes(line)) {
                        proposedApiImports.push('// @ts-ignore Ignore Duplicate types');
                        proposedApiImports.push(line);
                    }
                    return false;
                }
                if (line.startsWith(newModuleDeclaration)) {
                    foundFirstExport = true;
                }
                return false;
            })
            .join(EOL);

        // Remove the trailing `}`
        // Do not trim leading spaces, as we need to preserve the indentation.
        proposedApi += ('1' + newSource).trim().slice(0, -1).substring(1) + EOL;
    }
});
// Add module namespace to the main api.d.ts file.
// Required for module augmentation to work.
const source = fs.readFileSync(path.join(__dirname, 'api.d.ts'), 'utf8').toString();
let foundFirstExport = false;
const newSource = source
    .split(/\r?\n/g)
    .map((line) => {
        if (proposedApiImports.length && line.startsWith('import ') && line.trim().endsWith(';')) {
            const newLine = ['// @ts-ignore Ignore Duplicate types', line, ...proposedApiImports].join(EOL);
            proposedApiImports = [];
            return newLine;
        }
        if (line.startsWith('export ') && !foundFirstExport) {
            foundFirstExport = true;
            let imports = '';
            if (proposedApiImports.length) {
                imports = proposedApiImports.join(EOL) + EOL + EOL;
            }
            return imports + [`declare module '@vscode/jupyter-extension' {`, `${tab}${line}`].join(EOL);
        }
        if (foundFirstExport) {
            return `${tab}${line}`;
        }
        return line;
    })
    .join(EOL);

// Do not trim leading spaces, as we need to preserve the indentation.
fs.writeFileSync(
    path.join(__dirname, 'api.d.ts'),
    newSource.trim() + EOL + `1${proposedApi}`.trim().substring(1) + EOL + '}' + EOL
);
