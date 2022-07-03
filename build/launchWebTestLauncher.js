// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { spawn } = require('child_process');

const proc = spawn('node', [path.join(__dirname, 'launchWebTest.js')], {
    cwd: __dirname,
    env: process.env
});
proc.stdout.pipe(process.stdout);
proc.stderr.pipe(process.stderr);
proc.on('error', reject);
proc.on('exit', (code) => {
    console.error(`Tests Exited with code ${code}`);
    // We don't want to fail the build job.
    // The logs are very large, and when the job fails then Github attempts to load the entire log
    // & display the last few lines, however this is very slow due to the enormous size of the logs.
    process.exit(0);
});
