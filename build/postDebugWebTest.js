// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const fs = require('fs-extra');
const path = require('path');

try {
    const file = path.join(__dirname, '..', 'temp', 'jupyter.pid');
    if (fs.existsSync(file)) {
        const pid = parseInt(fs.readFileSync(file).toString().trim());
        fs.unlinkSync(file);
        if (pid > 0) {
            process.kill(pid);
        }
    }
} catch (ex) {
    console.warn(`Failed to kill Jupyter Server`, ex);
}
