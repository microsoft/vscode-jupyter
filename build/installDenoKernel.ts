// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');

enum OSType {
    Unknown = 'Unknown',
    Windows = 'Windows',
    OSX = 'OSX',
    Linux = 'Linux'
}

// Return the OS type for the given platform string.
function getOSType(platform: string = process.platform): OSType {
    if (/^win/.test(platform)) {
        return OSType.Windows;
    } else if (/^darwin/.test(platform)) {
        return OSType.OSX;
    } else if (/^linux/.test(platform)) {
        return OSType.Linux;
    } else {
        return OSType.Unknown;
    }
}

// Home path depends upon OS
const homePath = os.homedir();

function getEnvironmentVariable(key: string): string | undefined {
    return process.env[key];
}

function getUserHomeDir(): string {
    if (getOSType() === OSType.Windows) {
        return getEnvironmentVariable('USERPROFILE') || homePath;
    }
    const homeVar = getEnvironmentVariable('HOME') || getEnvironmentVariable('HOMEPATH') || homePath;

    // Make sure if linux, it uses linux separators
    return homeVar.replace(/\\/g, '/');
}

function getKernelSpecRootPath() {
    switch (getOSType()) {
        case OSType.Windows:
            return path.join(getUserHomeDir(), winJupyterPath);
        case OSType.OSX:
            return path.join(getUserHomeDir(), macJupyterPath);
        default:
            return path.join(getUserHomeDir(), linuxJupyterPath);
    }
}

function getDenoExec() {
    return execSync('which deno').toString().trim();
}

function getDenoKernelSpecPath() {
    return path.join(getKernelSpecRootPath(), 'deno', 'kernel.json');
}

function registerKernel() {
    const denoKernelSpecPath = getDenoKernelSpecPath();
    if (fs.existsSync(denoKernelSpecPath)) {
        console.log(`Deno kernel already registered at ${denoKernelSpecPath}`);
        return;
    }

    fs.mkdirpSync(path.dirname(denoKernelSpecPath));
    fs.writeFileSync(
        denoKernelSpecPath,
        JSON.stringify(
            {
                argv: [getDenoExec(), '--unstable', 'jupyter', '--kernel', '--conn', '{connection_file}'],
                display_name: 'Deno',
                language: 'typescript'
            },
            null,
            4
        )
    );
    console.log(`Deno kernel registered at ${denoKernelSpecPath}`);
}

registerKernel();
