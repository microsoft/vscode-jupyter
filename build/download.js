// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// @ts-check
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const util = require('util');
const url = require('url');
const URL = url.URL;
const child_process = require('child_process');
const proxy_from_env = require('proxy-from-env');

const packageVersion = require('../package.json').version;
const fsUnlink = util.promisify(fs.unlink);
const fsExists = util.promisify(fs.exists);
const fsMkdir = util.promisify(fs.mkdir);

const isWindows = os.platform() === 'win32';
const tmpDir = path.join(os.tmpdir(), `vscode-zeromq-${packageVersion}`);
const REPO = 'microsoft/zeromq-prebuilt';

function isGithubUrl(_url) {
    return url.parse(_url).hostname === 'api.github.com';
}

function downloadWin(url, dest, opts) {
    return new Promise((resolve, reject) => {
        let userAgent;
        if (opts.headers['user-agent']) {
            userAgent = opts.headers['user-agent'];
            delete opts.headers['user-agent'];
        }
        const headerValues = Object.keys(opts.headers)
            .map((key) => `\\"${key}\\"=\\"${opts.headers[key]}\\"`)
            .join('; ');
        const headers = `@{${headerValues}}`;
        console.log('Downloading with Invoke-WebRequest');
        dest = sanitizePathForPowershell(dest);
        let iwrCmd = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -URI ${url} -UseBasicParsing -OutFile ${dest} -Headers ${headers}`;
        if (userAgent) {
            iwrCmd += ' -UserAgent ' + userAgent;
        }
        if (opts.proxy) {
            iwrCmd += ' -Proxy ' + opts.proxy;

            try {
                const { username, password } = new URL(opts.proxy);
                if (username && password) {
                    const decodedPassword = decodeURIComponent(password);
                    iwrCmd += ` -ProxyCredential (New-Object PSCredential ('${username}', (ConvertTo-SecureString '${decodedPassword}' -AsPlainText -Force)))`;
                }
            } catch (err) {
                reject(err);
            }
        }

        iwrCmd = `powershell "${iwrCmd}"`;

        child_process.exec(iwrCmd, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

async function download(_url, dest, opts) {
    const proxy = proxy_from_env.getProxyForUrl(url.parse(_url));
    if (proxy !== '') {
        var HttpsProxyAgent = require('https-proxy-agent');
        opts = {
            ...opts,
            agent: new HttpsProxyAgent(proxy),
            proxy
        };
    }
    const dir = path.dirname(dest);
    if (!(await fsExists(dir))) {
        await fsMkdir(dir, { recursive: true });
    }

    if (isWindows) {
        // This alternative strategy shouldn't be necessary but sometimes on Windows the file does not get closed,
        // so unzipping it fails, and I don't know why.
        return downloadWin(_url, dest, opts);
    }

    if (opts.headers && opts.headers.authorization && !isGithubUrl(_url)) {
        delete opts.headers.authorization;
    }

    return new Promise((resolve, reject) => {
        console.log(`Download options: ${JSON.stringify(opts)}`);
        const outFile = fs.createWriteStream(dest);
        const mergedOpts = {
            ...url.parse(_url),
            ...opts
        };
        https
            .get(mergedOpts, (response) => {
                if (response.statusCode === 302) {
                    console.log('Following redirect to: ' + response.headers.location);
                    return download(response.headers.location, dest, opts).then(resolve, reject);
                } else if (response.statusCode !== 200) {
                    reject(new Error(`Download ${_url} failed with ${response.statusCode}`));
                    return;
                }

                response.pipe(outFile);
                outFile.on('finish', () => {
                    resolve();
                });
            })
            .on('error', async (err) => {
                await fsUnlink(dest);
                reject(err);
            });
    });
}

function get(_url, opts) {
    console.log(`GET ${_url}`);

    const proxy = proxy_from_env.getProxyForUrl(url.parse(_url));
    if (proxy !== '') {
        var HttpsProxyAgent = require('https-proxy-agent');
        opts = {
            ...opts,
            agent: new HttpsProxyAgent(proxy)
        };
    }

    return new Promise((resolve, reject) => {
        let result = '';
        opts = {
            ...url.parse(_url),
            ...opts
        };
        https.get(opts, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error('Request failed: ' + response.statusCode));
            }

            response.on('data', (d) => {
                result += d.toString();
            });

            response.on('end', () => {
                resolve(result);
            });

            response.on('error', (e) => {
                reject(e);
            });
        });
    });
}

function getApiUrl(repo, tag) {
    return `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
}

/**
 * @param {{ force: boolean; token: string; version: string; }} opts
 * @returns {Promise<{url: string; name: string; }[]>}
 */
async function getAssetsFromGithubApi(opts) {
    const downloadOpts = {
        headers: {
            'user-agent': 'vscode-zeromq'
        }
    };

    if (opts.token) {
        downloadOpts.headers.authorization = `token ${opts.token}`;
    }

    console.log(`Finding release for ${opts.version}`);
    const release = await get(getApiUrl(REPO, opts.version), downloadOpts);
    let jsonRelease;
    try {
        jsonRelease = JSON.parse(release);
    } catch (e) {
        throw new Error('Malformed API response: ' + e.stack);
    }

    if (!jsonRelease.assets) {
        throw new Error('Bad API response: ' + JSON.stringify(release));
    }
    const assets = jsonRelease.assets.filter(
        (a) =>
            (a.name.includes('win32-') && a.name.endsWith('.zip')) ||
            ((a.name.includes('linux-') || a.name.includes('darwin-')) && a.name.endsWith('.tar.gz'))
    );
    if (!assets.length) {
        throw new Error('No assets found to download');
    }
    console.log(
        `Found ${assets.length} assets (${assets.map((a) => a.name).join(', ')}) to be downloaded for vscode-zeromq`
    );
    return assets.map((a) => ({ url: a.url, name: a.name }));
}

/**
 * @param {{ force: boolean; token: string; version: string; destination: string; }} opts
 * @param {{url: string; name: string; }} asset
 * @return {Promise<void>} Downloaded file name
 */
async function getAssetFromGithubApi(opts, asset) {
    let platform = '';
    let libc = 'glibc';
    if (asset.name.includes('win32')) {
        platform = 'win32';
    } else if (asset.name.includes('linux')) {
        platform = 'linux';
    } else if (asset.name.includes('darwin')) {
        platform = 'darwin';
    }
    if (asset.name.includes('glibc')) {
        libc = 'glibc';
    } else if (asset.name.includes('musl')) {
        libc = 'musl';
    }

    const archs = [];
    ['x64', 'arm64', 'arm', 'ia32'].forEach((item) => {
        if (!asset.name.includes(item)) {
            return;
        } else if (item === 'arm' && !asset.name.includes('arm64')) {
            archs.push(item);
        } else if (item !== 'arm') {
            archs.push(item);
        }
    });
    const arch = archs.join('+');
    const folder = `${platform}-${arch}`;

    if (!platform) {
        throw new Error('Platform not found in asset name: ' + asset.name);
    }
    if (!arch) {
        throw new Error('Arch not found in asset name: ' + asset.name);
    }
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir);
    }
    const assetDownloadFile = path.join(tmpDir, folder, asset.name);
    const assetDestinationPath = path.join(opts.destination, folder);
    if (!fs.existsSync(assetDestinationPath)) {
        fs.mkdirSync(assetDestinationPath, { recursive: true });
    }
    // We can just use the cached binary
    if (!opts.force && (await fsExists(assetDownloadFile))) {
        console.log('Using cached download: ' + assetDownloadFile);
    } else {
        const downloadOpts = {
            headers: {
                'user-agent': 'vscode-zeromq'
            }
        };

        if (opts.token) {
            downloadOpts.headers.authorization = `token ${opts.token}`;
        }

        console.log(`Downloading asset ${asset.name} from ${asset.url} into ${assetDownloadFile}`);

        downloadOpts.headers.accept = 'application/octet-stream';
        try {
            await download(asset.url, assetDownloadFile, downloadOpts);
        } catch (ex) {
            console.log('Deleting invalid download cache');
            await fsUnlink(assetDownloadFile).catch(() => {});

            throw ex;
        }
    }

    console.log(`Unzipping to ${assetDestinationPath}`);
    try {
        await unzipFiles(assetDownloadFile, assetDestinationPath);
    } catch (e) {
        console.log('Deleting invalid download');

        try {
            await fsUnlink(assetDownloadFile);
        } catch (e) {}

        throw e;
    }
}

/**
 * @param {{url: string; name: string; }} asset
 * @return {{url: string; name: string; platform: string; archs: string[]}} Asset information
 */
function parseAsset(asset) {
    let platform = '';
    let libc = 'glibc';
    if (asset.name.includes('win32')) {
        platform = 'win32';
    } else if (asset.name.includes('linux')) {
        platform = 'linux';
    } else if (asset.name.includes('darwin')) {
        platform = 'darwin';
    } else if (asset.name.endsWith('.dll')) {
        platform = 'win32';
    }
    if (asset.name.includes('glibc')) {
        libc = 'glibc';
    } else if (asset.name.includes('musl')) {
        libc = 'musl';
    }

    const archs = new Set();
    ['x64', 'arm64', 'arm', 'ia32'].forEach((item) => {
        if (asset.name.includes('musl')) {
            archs.add('alpine');
        } else if (!asset.name.includes(item)) {
            return;
        } else if (item === 'arm' && !asset.name.includes('arm64')) {
            archs.add(item);
        } else if (item !== 'arm') {
            archs.add(item);
        }
    });

    if (!platform) {
        throw new Error('Platform not found in asset name: ' + asset.name);
    }
    if (archs.size === 0) {
        throw new Error('Arch not found in asset name: ' + asset.name);
    }

    return {
        url: asset.url,
        name: asset.name,
        platform,
        archs: Array.from(archs)
    };
}

// Handle whitespace in filepath as powershell split's path with whitespaces
function sanitizePathForPowershell(path) {
    path = path.replace(/ /g, '` '); // replace whitespace with "` " as solution provided here https://stackoverflow.com/a/18537344/7374562
    return path;
}

function unzipWindows(zipPath, destinationDir) {
    return new Promise((resolve, reject) => {
        zipPath = sanitizePathForPowershell(zipPath);
        destinationDir = sanitizePathForPowershell(destinationDir);
        const expandCmd =
            'powershell -ExecutionPolicy Bypass -Command Expand-Archive ' +
            ['-Path', zipPath, '-DestinationPath', destinationDir, '-Force'].join(' ');
        child_process.exec(expandCmd, (err, _stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }

            if (stderr) {
                console.log(stderr);
                reject(new Error(stderr));
                return;
            }

            console.log('Expand-Archive completed');
            resolve();
        });
    });
}

function unzipLinux(zipPath, destinationDir) {
    return new Promise((resolve, reject) => {
        const proc = child_process.spawn('unzip', [zipPath, '-d', destinationDir]);

        let stderr = '';
        proc.stderr.on('data', (data) => (stderr = stderr + data.toString()));

        proc.once('exit', (code) => {
            if (code === 0) {
                console.log('Expand-Archive completed');
                resolve();
            } else {
                const error = new Error(
                    `Failed to unzip ${zipPath}, exited with error code: ${code} and error message: ${stderr}`
                );
                console.error(error);
                reject(error);
            }
        });
    });
}
// Handle whitespace in filepath as powershell split's path with whitespaces
function sanitizePathForPowershell(path) {
    path = path.replace(/ /g, '` '); // replace whitespace with "` " as solution provided here https://stackoverflow.com/a/18537344/7374562
    return path;
}

function untar(zipPath, destinationDir) {
    return new Promise((resolve, reject) => {
        const unzipProc = child_process.spawn('tar', ['xvf', zipPath, '-C', destinationDir], { stdio: 'inherit' });
        unzipProc.on('error', (err) => {
            reject(err);
        });
        unzipProc.on('close', (code) => {
            console.log(`tar xvf exited with ${code}`);
            if (code !== 0) {
                reject(new Error(`tar xvf exited with ${code}`));
                return;
            }

            resolve();
        });
    });
}

async function unzipFiles(zipPath, destinationDir) {
    if (isWindows) {
        await unzipWindows(zipPath, destinationDir);
    } else if (zipPath.toLowerCase().endsWith('.zip')) {
        await unzipLinux(zipPath, destinationDir);
    } else {
        await untar(zipPath, destinationDir);
    }
}

/**
 * @param {{ name: string; url: string; }[]} assets
 * @param {{ 'win32'?: ('x64' | 'ia32' | 'arm64')[]; 'linux'?: ('arm' | 'x64' | 'arm64' | 'armhf' | 'alpine')[]; 'darwin'?: ('x64' | 'arm64')[]; }} platformOptions If not provided, then downloads all binaries for all platforms and archs.
 * @return {{ name: string; url: string; }[]} Assets to download
 */
function getAssetsToDownload(assets, platformOptions) {
    if (!assets || !Array.isArray(assets) || assets.length === 0) {
        throw new Error('Missing asets');
    }
    if (!platformOptions || Object.keys(platformOptions).length === 0) {
        return assets;
    }

    if (Object.keys(platformOptions).length === 0) {
        throw new Error('Missing platformOptions[platform]');
    }
    console.log(`getAssetsToDownload() => platformOptions: ${JSON.stringify(platformOptions)}`);

    assets = assets.filter((asset) => {
        const info = parseAsset(asset);
        if (info.platform in platformOptions) {
            const archs = info.platform in platformOptions ? platformOptions[info.platform] : [];
            if (!Array.isArray(archs)) {
                throw new Error(`Invalid archs for ${info.platform}: ${archs}`);
            }
            return archs.length === 0 || info.archs.length === 0
                ? true
                : archs.some((arch) => info.archs.includes(arch));
        } else {
            return false;
        }
    });

    console.log(
        `Filtered ${assets.length} assets (${assets.map((a) => a.name).join(', ')}) to be downloaded for vscode-zeromq`
    );
    return assets;
}

module.exports.getAssetsToDownload = getAssetsToDownload;
module.exports.parseAsset = parseAsset;

/**
 * @param {{ force: boolean; token: string; version: string; destination: string; }} opts
 * @param {{ 'win32'?: ('x64' | 'ia32' | 'arm64')[]; 'linux'?: ('arm' | 'x64' | 'arm64' | 'armhf' | 'alpine')[]; 'darwin'?: ('x64' | 'arm64')[] }} platformOptions If not provided, then downloads all binaries for all platforms and archs.
 * @return {Promise<void>} File path to the downloaded asset
 */
module.exports.download = async (opts, platformOptions) => {
    if (!opts.version) {
        return Promise.reject(new Error('Missing version'));
    }
    if (!opts.destination) {
        return Promise.reject(new Error('Missing destination'));
    }
    if (platformOptions && Object.keys(platformOptions).length === 0) {
        return Promise.reject(new Error('Missing platformOptions[platform]'));
    }

    try {
        let assets = await getAssetsFromGithubApi(opts);
        assets = getAssetsToDownload(assets, platformOptions);

        await Promise.all(assets.map((asset) => getAssetFromGithubApi(opts, asset)));
    } catch (e) {
        throw e;
    }
};
