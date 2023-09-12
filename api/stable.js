// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { EOL } = require('os');
const fs = require('fs');
const path = require('path');

// For stable we only ship the api.d.ts file.
fs.copyFileSync(path.join(__dirname, '../src/api.d.ts'), path.join(__dirname, 'api.d.ts'));
