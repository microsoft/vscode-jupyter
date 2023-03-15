// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const { downloadZMQ } = require('@vscode/zeromq');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;

const knownPlatforms = {
    win32: ['win32-ia32', 'win32-x64', 'win32-arm64'],
    linux: ['linux-arm64', 'linux-x64'],
    darwin: ['darwin-arm64', 'darwin-x64']
};

const platforms = [];
Object.keys(knownPlatforms).forEach((platform) => {
    const value = argv[platform];
    if (value === true) {
        platforms.push(...knownPlatforms[platform]);
    } else if (Array.isArray(value)) {
        const archs = argv[platform].map((a) => `${platform}-${a}`);
        platforms.push(...knownPlatforms[platform].filter((p) => archs.indexOf(p) >= 0));
    } else if (typeof value === 'string') {
        platforms.push(...knownPlatforms[platform].filter((p) => p.includes(value)));
    }
});

let options = undefined;
if (platforms.length === 0) {
    console.log('Downloading zeromq for all platforms+archs.');
} else {
    console.log(`Downloading zeromq for ${platforms.join(', ')}.`);
    options = {};

    platforms.forEach((platform) => {
        const os = platform.split('-')[0];
        const arch = platform.split('-')[1];
        options[os] = options[os] || [];
        options[os].push(arch);
    });
}
downloadZMQ(options).catch((ex) => {
    console.error(ex);
    process.exit(1);
});
