// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const { EOL } = require('os');
const colors = require('colors/safe');
const fs = require('fs-extra');
const path = require('path');
const constants = require('../constants');
const common = require('../webpack/common');
const { downloadZMQ } = require('@vscode/zeromq');
/**
 * In order to get raw kernels working, we reuse the default kernel that jupyterlab ships.
 * However it expects to be talking to a websocket which is serializing the messages to strings.
 * Our raw kernel is not a web socket and needs to do its own serialization. To do so, we make a copy
 * of the default kernel with the serialization stripped out. This is simpler than making a copy of the module
 * at runtime.
 */
function createJupyterKernelWithoutSerialization() {
    var relativePath = path.join('node_modules', '@jupyterlab', 'services', 'lib', 'kernel', 'default.js');
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            "Jupyter lab default kernel not found '" + filePath + "' (Jupyter Extension post install script)"
        );
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    var replacedContents = fileContents
        .replace(/^const serialize =.*$/gm, 'const serialize = { serialize: (a) => a, deserialize: (a) => a };')
        .replace(
            'const owned = team.session === this.clientId;',
            'const owned = parentHeader.session === this.clientId;'
        );
    if (replacedContents === fileContents) {
        throw new Error('Jupyter lab default kernel cannot be made non serializing');
    }
    var destPath = path.join(path.dirname(filePath), 'nonSerializingKernel.js');
    fs.writeFileSync(destPath, replacedContents);
    console.log(colors.green(destPath + ' file generated (by Jupyter VSC)'));
}
function fixVariableNameInKernelDefaultJs() {
    var relativePath = path.join('node_modules', '@jupyterlab', 'services', 'lib', 'kernel', 'default.js');
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            "Jupyter lab default kernel not found '" + filePath + "' (Jupyter Extension post install script)"
        );
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    const replacement = 'const owned = parentHeader.session === this.clientId;';
    var replacedContents = fileContents.replace('const owned = team.session === this.clientId;', replacement);
    if (replacedContents === fileContents) {
        if (fileContents.includes(replacement)) {
            return;
        }
        throw new Error("Jupyter lab default kernel cannot be updated to fix variable name 'team'");
    }
    fs.writeFileSync(filePath, replacedContents);
    console.log(colors.green(filePath + ' file updated (by Jupyter VSC)'));
}
function removeUnnecessaryLoggingFromKernelDefault() {
    var relativePath = path.join('node_modules', '@jupyterlab', 'services', 'lib', 'kernel', 'default.js');
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        throw new Error(
            "Jupyter lab default kernel not found '" + filePath + "' (Jupyter Extension post install script)"
        );
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    var replacedContents = fileContents.replace('console.debug(`Starting WebSocket: ${display}`);', '');
    if (replacedContents === fileContents) {
        // We do not care if we cannot remove this.
        return;
    }
    fs.writeFileSync(filePath, replacedContents);
    console.log(colors.green(filePath + ' file updated (by Jupyter VSC)'));
}

/**
 * Fix compilation issues in jsdom files.
 */
function updateJSDomTypeDefinition() {
    var relativePath = path.join('node_modules', '@types', 'jsdom', 'base.d.ts');
    var filePath = path.join(constants.ExtensionRootDir, relativePath);
    if (!fs.existsSync(filePath)) {
        console.warn("JSdom base.d.ts not found '" + filePath + "' (Jupyter Extension post install script)");
        return;
    }
    var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
    var replacedContents = fileContents.replace(
        /\s*globalThis: DOMWindow;\s*readonly \["Infinity"]: number;\s*readonly \["NaN"]: number;/g,
        [
            'globalThis: DOMWindow;',
            '// @ts-ignore',
            'readonly ["Infinity"]: number;',
            '// @ts-ignore',
            'readonly ["NaN"]: number;'
        ].join(`${EOL}        `)
    );
    if (replacedContents === fileContents) {
        console.warn('JSdom base.d.ts not updated');
        return;
    }
    fs.writeFileSync(filePath, replacedContents);
}

/**
 * The Variable Explorer currently uses react-data-grid@6.1.0 and is the only component that does.
 * We retrieve variable names sorted so there will never be a time where variables are unsorted.
 * react-data-grid is on v7+ now and a PR to implement this would cause a lot of cascading changes for us,
 * so we modify the compiled javascript so that the react-data-grid is always sorted by something.
 */
function makeVariableExplorerAlwaysSorted() {
    const fileNames = ['react-data-grid.js', 'react-data-grid.min.js'];
    const alwaysSortedCode = 'case g.NONE:e=r?g.DESC:g.ASC;break;case g.ASC:e=g.DESC;break;case g.DESC:e=g.ASC';
    const originalCode =
        'case g.NONE:e=r?g.DESC:g.ASC;break;case g.ASC:e=r?g.NONE:g.DESC;break;case g.DESC:e=r?g.ASC:g.NONE';
    for (const fileName of fileNames) {
        var relativePath = path.join('node_modules', 'react-data-grid', 'dist', fileName);
        var filePath = path.join(constants.ExtensionRootDir, relativePath);
        if (!fs.existsSync(filePath)) {
            throw new Error("react-data-grid dist file not found '" + filePath + "' (pvsc post install script)");
        }
        var fileContents = fs.readFileSync(filePath, { encoding: 'utf8' });
        if (fileContents.indexOf(alwaysSortedCode) > 0) {
            // tslint:disable-next-line:no-console
            console.log(colors.blue(relativePath + ' file already updated (by Jupyter VSC)'));
            return;
        }
        if (fileContents.indexOf(originalCode) > 0) {
            var replacedText = fileContents.replace(originalCode, alwaysSortedCode);
            if (fileContents === replacedText) {
                throw new Error(`Fix for react-data-grid file ${fileName} failed (pvsc post install script)`);
            }
            fs.writeFileSync(filePath, replacedText);
            // tslint:disable-next-line:no-console
            console.log(colors.green(relativePath + ' file updated (by Jupyter VSC)'));
        } else {
            // tslint:disable-next-line:no-console
            console.log(colors.red(relativePath + ' file does not need updating.'));
        }
    }
}

function fixJupyterLabRenderers() {
    const warnings = [];
    ['node_modules/@jupyterlab/cells/lib/widget.js', 'node_modules/@jupyterlab/rendermime/lib/renderers.js'].forEach(
        (file) => {
            const filePath = path.join(__dirname, '..', '..', file);
            if (!fs.existsSync(filePath)) {
                return;
            }
            const textToReplace = `import marked from 'marked'`;
            const textToReplaceWith = `import { marked } from 'marked'`;
            const fileContents = fs.readFileSync(filePath, 'utf8').toString();
            if (fileContents.indexOf(textToReplace) === -1 && fileContents.indexOf(textToReplaceWith) === -1) {
                warnings.push('Unable to find Jupyter marked usage to replace!');
            }
            fs.writeFileSync(filePath, fileContents.replace(textToReplace, `import { marked } from 'marked'`));
        }
    );
    if (warnings.length === 2) {
        throw new Error(warnings[0] + '\n' + warnings[1]);
    }
}

/**
 * Ensures extension loads in safari (https://github.com/microsoft/vscode-jupyter/issues/10621)
 * Some of the regexes are not supported in safari and not required either.
 */
function fixStripComments() {
    const file = 'node_modules/strip-comments/lib/languages.js';
    const filePath = path.join(__dirname, '..', '..', file);
    if (!fs.existsSync(filePath)) {
        return;
    }
    const contents = `
'use strict';

exports.javascript = {
    BLOCK_OPEN_REGEX: /^\\/\\*\\*?(!?)/,
    BLOCK_CLOSE_REGEX: /^\\*\\/(\\n?)/,
    LINE_REGEX: /^\\/\\/(!?).*/
};`;
    fs.writeFileSync(filePath, contents);
}

/**
 * Ensures that moment is not used by any other npm package other than @jupyterlab/coreutils.
 * See comments here build/webpack/moment.js
 */
function verifyMomentIsOnlyUsedByJupyterLabCoreUtils() {
    const packageLock = require(path.join(__dirname, '..', '..', 'package-lock.json'));
    const packagesAllowedToUseMoment = ['node_modules/@jupyterlab/coreutils', '@jupyterlab/coreutils'];
    const otherPackagesUsingMoment = [];
    ['packages', 'dependencies'].forEach((key) => {
        if (!(key in packageLock)) {
            throw new Error(`Invalid package-lock.json, as it does not contain the key '${key}'`);
        }
        const packages = packageLock[key];
        Object.keys(packages).forEach((packageName) => {
            if (
                packagesAllowedToUseMoment.includes(packageName) ||
                packagesAllowedToUseMoment.some((p) => packageName.endsWith(p))
            ) {
                return;
            }
            ['dependencies', 'requires'].forEach((dependencyKey) => {
                if (dependencyKey in packages[packageName]) {
                    const dependenciesOfPackage = packages[packageName][dependencyKey];
                    if ('moment' in dependenciesOfPackage) {
                        otherPackagesUsingMoment.push(`${key}.${dependencyKey}.${packageName}`);
                    }
                }
            });
        });
    });
    if (otherPackagesUsingMoment.length > 0) {
        // Verify how the other packages are using moment.
        // If its still the same as jupyter lab coreutils, then we can ignore them
        // Else we might have to either polyfill that to ensure moment usage works or just bring in moment back again.
        throw new Error(`Moment is being used by other packages (${otherPackagesUsingMoment.join(', ')}).`);
    }
}
async function downloadZmqBinaries() {
    if (common.getBundleConfiguration() === common.bundleConfiguration.web) {
        // No need to download zmq binaries for web.
        return;
    }
    await downloadZMQ();
}

function ensureOrigNBFormatIsOptional() {
    const stringToReplace = 'orig_nbformat: number;';
    const filePath = path.join(__dirname, '..', '..', 'node_modules/@jupyterlab/nbformat/lib/index.d.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes(stringToReplace)) {
        fs.writeFileSync(filePath, source.replace(stringToReplace, 'orig_nbformat?: number;'));
    }
}

function commentOutInvalidExport() {
    // Others have run into the same problem https://github.com/uber/baseweb/issues/4129
    const stringToReplace = 'import { bpfrpt_proptype_WindowScroller } from "../WindowScroller.js";';
    const filePath = path.join(
        __dirname,
        '..',
        '..',
        'node_modules/react-virtualized/dist/es/WindowScroller/utils/onScroll.js'
    );
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes(stringToReplace)) {
        fs.writeFileSync(filePath, source.replace(stringToReplace, ''));
    }
}

fixJupyterLabRenderers();
makeVariableExplorerAlwaysSorted();
createJupyterKernelWithoutSerialization();
fixVariableNameInKernelDefaultJs();
removeUnnecessaryLoggingFromKernelDefault();
updateJSDomTypeDefinition();
fixStripComments();
verifyMomentIsOnlyUsedByJupyterLabCoreUtils();
ensureOrigNBFormatIsOptional();
commentOutInvalidExport();
downloadZmqBinaries()
    .then(() => process.exit(0))
    .catch((ex) => {
        console.error('Failed to download ZMQ', ex);
        process.exit(1);
    });
