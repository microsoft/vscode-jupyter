// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { bundle } = require('./bundleDependencies');
bundle()
    .then(() => console.log('Completed'))
    .catch((ex) => console.error('failed', ex));
