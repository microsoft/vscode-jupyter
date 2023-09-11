// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs');
const path = require('path');

fs.copyFileSync(path.join(__dirname, '../src/api.d.ts'), path.join(__dirname, '.api.d.ts'));
