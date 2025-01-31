/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* jshint node: true */
/* jshint esversion: 6 */

'use strict';

const gulp = require('gulp');
const glob = require('glob');
const spawn = require('cross-spawn');
const path = require('path');
const del = require('del');
const fs = require('fs-extra');
const _ = require('lodash');
const nativeDependencyChecker = require('node-has-native-dependencies');
const flat = require('flat');
const os = require('os');
const { spawnSync } = require('child_process');
const isCI = process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';
const webpackEnv = { NODE_OPTIONS: '--max_old_space_size=9096' };
const { dumpTestSummary } = require('./build/webTestReporter');
const { Validator } = require('jsonschema');
const { stripVTControlCharacters } = require('util');
const common = require('./build/webpack/common');
const jsonc = require('jsonc-parser');

gulp.task('createNycFolder', async (done) => {
    try {
        const fs = require('fs');
        fs.mkdirSync(path.join(__dirname, '.nyc_output'));
    } catch (e) {
        //
    }
    done();
});

gulp.task('validateTranslationFiles', (done) => {
    const validator = new Validator();
    const schema = {
        type: 'object',
        patternProperties: {
            '^[a-z0-9.]*': {
                anyOf: [
                    {
                        type: ['string'],
                        additionalProperties: false
                    },
                    {
                        type: ['object'],
                        properties: {
                            message: { type: 'string' },
                            comment: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            }
                        },
                        required: ['message'],
                        additionalProperties: false
                    }
                ]
            }
        },
        additionalProperties: false
    };

    glob.sync('package.nls.*.json', { sync: true }).forEach((file) => {
        // Verify we can open and parse as JSON.
        try {
            const js = JSON.parse(fs.readFileSync(file));
            const result = validator.validate(js, schema);
            if (Array.isArray(result.errors) && result.errors.length) {
                console.error(result.errors);
                throw new Error(result.errors.map((err) => `${err.property} ${err.message}`).join('\n'));
            }
        } catch (ex) {
            throw new Error(`Error parsing Translation File ${file}, ${ex.message}`);
        }
    });
    done();
});

gulp.task('printTestResults', async (done) => {
    await dumpTestSummary();
    done();
});

gulp.task('output:clean', () => del(['coverage']));

gulp.task('clean:cleanExceptTests', () => del(['clean:vsix', 'out', 'dist', '!out/test']));
gulp.task('clean:vsix', () => del(['*.vsix']));
gulp.task('clean:out', () => del(['out/**', 'dist/**', '!out', '!out/client_renderer/**', '!**/*nls.*.json']));

gulp.task('clean', gulp.parallel('output:clean', 'clean:vsix', 'clean:out'));

gulp.task('checkNativeDependencies', (done) => {
    if (hasNativeDependencies()) {
        done(new Error('Native dependencies detected'));
    }
    done();
});
gulp.task('checkNpmDependencies', (done) => {
    /**
     * Sometimes we have to update the package-lock.json file to upload dependencies.
     * Thisscript will ensure that even if the package-lock.json is re-generated the (minimum) version numbers are still as expected.
     */
    const packageLock = require('./package-lock.json');
    const errors = [];

    const expectedVersions = [
        { name: 'trim', version: '0.0.3' },
        { name: 'node_modules/trim', version: '0.0.3' }
    ];
    function checkPackageVersions(packages, parent) {
        if (!packages) {
            return;
        }
        expectedVersions.forEach((expectedVersion) => {
            if (!packages[expectedVersion.name]) {
                return;
            }
            const version = packages[expectedVersion.name].version || packages[expectedVersion.name];
            if (!version) {
                return;
            }
            if (!version.includes(expectedVersion.version)) {
                errors.push(
                    `${expectedVersion.name} version needs to be at least ${
                        expectedVersion.version
                    }, current ${version}, ${parent ? `(parent package ${parent})` : ''}`
                );
            }
        });
    }
    function checkPackageDependencies(packages) {
        if (!packages) {
            return;
        }
        Object.keys(packages).forEach((packageName) => {
            const dependencies = packages[packageName]['dependencies'];
            if (dependencies) {
                checkPackageVersions(dependencies, packageName);
            }
        });
    }

    checkPackageVersions(packageLock['packages']);
    checkPackageVersions(packageLock['dependencies']);
    checkPackageDependencies(packageLock['packages']);

    if (errors.length > 0) {
        errors.forEach((ex) => console.error(ex));
        throw new Error(errors.join(', '));
    }
    done();
});

async function buildWebPackForDevOrProduction(configFile, configNameForProductionBuilds) {
    if (configNameForProductionBuilds) {
        await buildWebPack(configNameForProductionBuilds, ['--config', configFile], webpackEnv);
    } else {
        await spawnAsync('npm', ['run', 'webpack', '--', '--config', configFile, '--mode', 'development'], webpackEnv);
    }
}

function modifyJson(jsonFile, cb) {
    const json = fs.readFileSync(jsonFile).toString('utf-8');
    const [key, value] = cb(json);
    const edits = jsonc.modify(json, [key], value, {});
    const updatedJson = jsonc.applyEdits(json, edits);
    fs.writeFileSync(jsonFile, updatedJson);
}

gulp.task('updatePackageJsonForBundle', async () => {
    // When building a web only VSIX, we need to remove the desktop entry point
    // & vice versa (this is only required for platform specific builds)
    const packageJsonFile = path.join(__dirname, 'package.json');
    const packageJsonContents = fs.readFileSync(packageJsonFile).toString('utf-8');
    const json = JSON.parse(packageJsonContents);
    switch (common.getBundleConfiguration()) {
        case common.bundleConfiguration.desktop: {
            if (json.browser) {
                modifyJson(packageJsonFile, () => ['browser', undefined]);
            }
            if (!json.main) {
                modifyJson(packageJsonFile, () => ['main', './dist/extension.node.js']);
            }
            break;
        }
        case common.bundleConfiguration.webAndDesktop: {
            if (!json.browser) {
                modifyJson(packageJsonFile, () => ['browser', './dist/extension.web.bundle.js']);
            }
            if (!json.main) {
                modifyJson(packageJsonFile, () => ['main', './dist/extension.node.js']);
            }
            break;
        }
        case common.bundleConfiguration.web: {
            if (!json.browser) {
                modifyJson(packageJsonFile, () => ['browser', './dist/extension.web.bundle.js']);
            }
            if (json.main) {
                modifyJson(packageJsonFile, () => ['main', undefined]);
            }
            break;
        }
    }
});
async function buildWebPack(webpackConfigName, args, env) {
    // Remember to perform a case insensitive search.
    const allowedWarnings = getAllowedWarningsForWebPack(webpackConfigName).map((item) => item.toLowerCase());
    const stdOut = await spawnAsync(
        'npm',
        ['run', 'webpack', '--', ...args, ...['--mode', 'production', '--devtool', 'source-map']],
        env
    );
    const stdOutLines = stdOut
        .split('\n')
        .map((item) => stripVTControlCharacters(item).trim())
        .filter((item) => item.length > 0);
    // Remember to perform a case insensitive search.
    const warnings = stdOutLines
        .filter((item) => item.startsWith('WARNING in '))
        .filter(
            (item) =>
                allowedWarnings.findIndex((allowedWarning) =>
                    item.toLowerCase().startsWith(allowedWarning.toLowerCase())
                ) == -1
        );
    const errors = stdOutLines.some((item) => item.startsWith('ERROR in'));
    if (errors) {
        throw new Error(`Errors in ${webpackConfigName}, \n${warnings.join(', ')}\n\n${stdOut}`);
    }
    if (warnings.length > 0) {
        throw new Error(
            `Warnings in ${webpackConfigName}, Check gulpfile.js to see if the warning should be allowed., \n\n${stdOut}`
        );
    }
}
function getAllowedWarningsForWebPack(buildConfig) {
    switch (buildConfig) {
        case 'production':
            return [
                'WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).',
                'WARNING in entrypoint size limit: The following entrypoint(s) combined asset size exceeds the recommended limit (244 KiB). This can impact web performance.',
                'WARNING in webpack performance recommendations:',
                'WARNING in ./node_modules/encoding/lib/iconv-loader.js',
                'WARNING in ./node_modules/keyv/src/index.js',
                'ERROR in ./node_modules/got/index.js',
                'WARNING in ./node_modules/ws/lib/BufferUtil.js',
                'WARNING in ./node_modules/ws/lib/buffer-util.js',
                'WARNING in ./node_modules/ws/lib/Validation.js',
                'WARNING in ./node_modules/ws/lib/validation.js',
                'WARNING in ./node_modules/@jupyterlab/services/node_modules/ws/lib/buffer-util.js',
                'WARNING in ./node_modules/@jupyterlab/services/node_modules/ws/lib/validation.js',
                'WARNING in ./node_modules/any-promise/register.js',
                'WARNING in ./node_modules/log4js/lib/appenders/index.js',
                'WARNING in ./node_modules/log4js/lib/clustering.js',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/dist/AutoCollection/NativePerformance.js'
            ];
        case 'extension':
            return [
                'WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).',
                'WARNING in entrypoint size limit: The following entrypoint(s) combined asset size exceeds the recommended limit (244 KiB). This can impact web performance.',
                'WARNING in webpack performance recommendations:',
                'WARNING in ./node_modules/cacheable-request/node_modules/keyv/src/index.js',
                'WARNING in ./node_modules/encoding/lib/iconv-loader.js',
                'WARNING in ./node_modules/keyv/src/index.js',
                'WARNING in ./node_modules/ws/lib/BufferUtil.js',
                'WARNING in ./node_modules/ws/lib/buffer-util.js',
                'WARNING in ./node_modules/ws/lib/Validation.js',
                'WARNING in ./node_modules/ws/lib/validation.js',
                'WARNING in ./node_modules/any-promise/register.js',
                'remove-files-plugin@1.4.0:',
                'WARNING in ./node_modules/@jupyterlab/services/node_modules/ws/lib/buffer-util.js',
                'WARNING in ./node_modules/@jupyterlab/services/node_modules/ws/lib/validation.js',
                'WARNING in ./node_modules/@jupyterlab/services/node_modules/ws/lib/Validation.js',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/dist/AutoCollection/NativePerformance.js'
            ];
        case 'debugAdapter':
            return [
                'WARNING in ./node_modules/vscode-uri/lib/index.js',
                'WARNING in ./node_modules/diagnostic-channel-publishers/dist/src/azure-coretracing.pub.js',
                'WARNING in ./node_modules/applicationinsights/dist/AutoCollection/NativePerformance.js'
            ];
        default:
            throw new Error('Unknown WebPack Configuration');
    }
}

gulp.task('prePublishBundle', async () => {
    await spawnAsync('npm', ['run', 'prePublishBundle'], webpackEnv);
});

gulp.task('checkDependencies', gulp.series('checkNativeDependencies', 'checkNpmDependencies'));

gulp.task('prePublishNonBundle', async () => {
    await spawnAsync('npm', ['run', 'prePublishNonBundle'], webpackEnv);
});

function spawnAsync(command, args, env, rejectOnStdErr = false) {
    env = env || {};
    env = { ...process.env, ...env };
    return new Promise((resolve, reject) => {
        let stdOut = '';
        console.info(`> ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, { cwd: __dirname, env });
        proc.stdout.on('data', (data) => {
            // Log output on CI (else travis times out when there's not output).
            stdOut += data.toString();
            if (isCI) {
                console.log(data.toString());
            }
        });
        proc.stderr.on('data', (data) => {
            console.error(data.toString());
            if (rejectOnStdErr) {
                reject(data.toString());
            }
        });
        proc.on('close', () => resolve(stdOut));
        proc.on('error', (error) => reject(error));
    });
}

function hasNativeDependencies() {
    let nativeDependencies = nativeDependencyChecker.check(path.join(__dirname, 'node_modules'));
    if (!Array.isArray(nativeDependencies) || nativeDependencies.length === 0) {
        return false;
    }
    const dependencies = JSON.parse(spawn.sync('npm', ['ls', '--json', '--prod']).stdout.toString());
    const jsonProperties = Object.keys(flat.flatten(dependencies));
    nativeDependencies = _.flatMap(nativeDependencies, (item) =>
        path.dirname(item.substring(item.indexOf('node_modules') + 'node_modules'.length)).split(path.sep)
    )
        .filter((item) => item.length > 0)
        .filter((item) => !item.includes('zeromq') && !item.includes('canvas') && !item.includes('keytar')) // Known native modules
        .filter(
            (item) =>
                jsonProperties.findIndex((flattenedDependency) =>
                    flattenedDependency.endsWith(`dependencies.${item}.version`)
                ) >= 0
        );
    if (nativeDependencies.length > 0) {
        console.error('Native dependencies detected', nativeDependencies);
        return true;
    }
    return false;
}

async function generateTelemetry() {
    const generator = require('./out/telemetryGenerator.node');
    await generator.default();
}
gulp.task('generateTelemetry', async () => {
    return generateTelemetry();
});

gulp.task('validateTelemetry', async () => {
    const gdprTS = fs.readFileSync(path.join(__dirname, 'src', 'gdpr.ts'), 'utf-8');
    await generateTelemetry();
    const gdprTS2 = fs.readFileSync(path.join(__dirname, 'src', 'gdpr.ts'), 'utf-8');
    if (gdprTS2.trim() !== gdprTS.trim()) {
        console.error('src/gdpr.ts is not valid, please re-run `npm run generateTelemetry`');
        throw new Error('src/gdpr.ts is not valid, please re-run `npm run generateTelemetry`');
    }
});

gulp.task('validatePackageLockJson', async () => {
    const fileName = path.join(__dirname, 'package-lock.json');
    const oldContents = fs.readFileSync(fileName).toString();
    spawnSync('npm', ['install', '--prefer-offline']);
    const newContents = fs.readFileSync(fileName).toString();
    if (oldContents.trim() !== newContents.trim()) {
        throw new Error('package-lock.json has changed after running `npm install`');
    }
});

gulp.task('verifyUnhandledErrors', async () => {
    const fileName = path.join(__dirname, 'unhandledErrors.txt');
    const contents = fs.pathExistsSync(fileName) ? fs.readFileSync(fileName, 'utf8') : '';
    if (contents.trim().length) {
        console.error(contents);
        throw new Error('Unhandled errors detected. Please fix them before merging this PR.', contents);
    }
});
