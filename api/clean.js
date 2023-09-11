// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');
const path = require('path');

fs.readdirSync(__dirname).forEach((file) => {
    if (file.endsWith('.d.ts')) {
        fs.unlinkSync(path.join(__dirname, file));
    }
});
