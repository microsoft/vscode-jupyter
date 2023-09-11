// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');
const path = require('path');

fs.readdirSync(path.join(__dirname, '../src')).forEach((file) => {
    if (file.startsWith('api.proposed.') && file.endsWith('.d.ts')) {
        fs.copyFileSync(path.join(__dirname, '../src', file), path.join(__dirname, `.${file}`));
    }
});
