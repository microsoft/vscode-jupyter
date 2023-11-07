// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

async function getKernelSpecRootPath() {
    const path = await import('node:path');
    const os = await import('node:os');

    const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
    const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
    const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
    if (os.platform() === 'win32') {
        return path.resolve(path.join(os.homedir(), winJupyterPath));
    } else if (os.platform() === 'darwin') {
        return path.join(os.homedir(), macJupyterPath);
    } else {
        return path.join(os.homedir(), linuxJupyterPath);
    }
}

async function getKernelSpecPath() {
    const path = await import('node:path');
    const os = await import('node:os');

    return path.join(await getKernelSpecRootPath(), 'deno');
}

async function main() {
    const path = await import('node:path');
    const process = await import('node:process');
    const fs = await import('node:fs');

    const kernelSpecJson = {
        argv: [process.argv[0], '--unstable', 'jupyter', '--kernel', '--conn', '{connection_file}'],
        display_name: 'Deno',
        language: 'typescript'
    };

    const kernleSpecFolder = await getKernelSpecPath();
    const kernelSpecFile = path.join(kernleSpecFolder, 'kernels.json');
    if (!fs.existsSync(kernleSpecFolder)) {
        fs.mkdirSync(kernleSpecFolder);
    }
    fs.writeFileSync(kernelSpecFile, JSON.stringify(kernelSpecJson, undefined, 4));
}
main();
