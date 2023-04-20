// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
'use strict';

const glob = require('glob');
const path = require('path');
const webpack_bundle_analyzer = require('webpack-bundle-analyzer');
const constants = require('../constants');
exports.nodeModulesToExternalize = [
    'pdfkit/js/pdfkit.standalone',
    'crypto-js',
    'fontkit',
    'png-js',
    'zeromq',
    'zeromqold'
];
exports.nodeModulesToReplacePaths = [...exports.nodeModulesToExternalize];
function getDefaultPlugins(name) {
    const plugins = [];
    // Only run the analyzer on a local machine or if required
    if (process.env.VSC_JUPYTER_FORCE_ANALYZER) {
        plugins.push(
            new webpack_bundle_analyzer.BundleAnalyzerPlugin({
                analyzerMode: 'static',
                reportFilename: `${name}.analyzer.html`,
                generateStatsFile: true,
                statsFilename: `${name}.stats.json`,
                openAnalyzer: false // Open file manually if you want to see it :)
            })
        );
    }
    return plugins;
}
exports.getDefaultPlugins = getDefaultPlugins;
function getListOfExistingModulesInOutDir() {
    const outDir = path.join(constants.ExtensionRootDir, 'out');
    const files = glob.sync('**/*.js', { sync: true, cwd: outDir });
    return files.map((filePath) => `./${filePath.slice(0, -3)}`);
}
exports.getListOfExistingModulesInOutDir = getListOfExistingModulesInOutDir;

const bundleConfiguration = {
    // We are bundling for both Web and Desktop.
    webAndDesktop: 'webAndDesktop',
    // We are bundling for both Web only.
    web: 'web',
    // We are bundling for both Desktop only.
    desktop: 'desktop'
};
/**
 * Gets the bundle configuration based on the environment variable.
 * @return {'webAndDesktop' | 'web' | 'desktop'}
 */
function getBundleConfiguration() {
    if (process.env.VSC_VSCE_TARGET === 'web') {
        return bundleConfiguration.web;
    } else if (process.env.VSC_VSCE_TARGET === undefined) {
        // Building locally or on Github actions, when we're not creating platform specific bundles.
        return bundleConfiguration.webAndDesktop;
    } else {
        return bundleConfiguration.desktop;
    }
}

function getZeroMQPreBuildsFoldersToKeep() {
    // Possible values of 'VSC_VSCE_TARGET' include platforms supported by `vsce package --target`
    // See here https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions
    const vsceTarget = process.env.VSC_VSCE_TARGET;
    if (!vsceTarget) {
        // Keep all of them, as we're not building platform specific bundles.
        return [];
    } else if (vsceTarget === 'web') {
        throw new Error('Not supported when targeting the Web');
    } else if (vsceTarget.includes('win32')) {
        if (vsceTarget.includes('ia32')) {
            return ['win32-ia32'];
        } else if (vsceTarget.includes('x64')) {
            return ['win32-x64'];
        } else {
            return ['win32-ia32', 'win32-x64'];
        }
    } else if (vsceTarget.includes('linux')) {
        if (vsceTarget.includes('arm64')) {
            return ['linux-arm64'];
        } else if (vsceTarget.includes('x64')) {
            return ['linux-x64'];
        } else if (vsceTarget.includes('arm')) {
            return ['linux-arm'];
        } else {
            return ['linux-arm64', 'linux-x64', 'linux-arm'];
        }
    } else if (vsceTarget.includes('alpine')) {
        if (vsceTarget.includes('arm64')) {
            return ['linux-arm64'];
        } else if (vsceTarget.includes('x64')) {
            return ['linux-x64'];
        } else {
            return ['linux-arm64', 'linux-x64', 'linux-arm'];
        }
    } else if (vsceTarget.includes('darwin')) {
        if (vsceTarget.includes('arm64')) {
            return ['darwin-arm64'];
        } else if (vsceTarget.includes('x64')) {
            return ['darwin-x64'];
        } else {
            return ['darwin-x64', 'darwin-arm64'];
        }
    } else {
        throw new Error(`Unknown platform '${vsceTarget}'}`);
    }
}

exports.bundleConfiguration = bundleConfiguration;
exports.getZeroMQPreBuildsFoldersToKeep = getZeroMQPreBuildsFoldersToKeep;
exports.getBundleConfiguration = getBundleConfiguration;
