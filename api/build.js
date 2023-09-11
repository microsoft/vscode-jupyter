// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');
const path = require('path');
console.error('copying api.d.ts');
fs.copyFileSync(path.join(__dirname, '../src/api.d.ts'), path.join(__dirname, 'api.d.ts'));

if (process.env.npm_config_tag === 'proposed') {
    fs.readdirSync(path.join(__dirname, '../src')).forEach((file) => {
        if (file.startsWith('api.proposed.') && file.endsWith('.d.ts')) {
            fs.copyFileSync(path.join(__dirname, '../src', file), path.join(__dirname, file));
        }
    });
}
