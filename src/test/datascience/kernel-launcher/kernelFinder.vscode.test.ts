// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

import * as path from '../../../platform/vscode-path/path';
import { assert } from 'chai';
import { Uri, workspace } from 'vscode';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { getKernelConnectionLanguage } from '../../../kernels/helpers';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { IExtensionTestApi } from '../../common.node';
import { initialize } from '../../initialize.node';
import { traceInfo } from '../../../platform/logging';
import { areInterpreterPathsSame } from '../../../platform/pythonEnvironments/info/interpreter';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { IKernelFinder, KernelConnectionMetadata, LocalKernelConnectionMetadata } from '../../../kernels/types';
import { IKernelRankingHelper } from '../../../notebooks/controllers/types';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Kernels Finder', () => {
    let api: IExtensionTestApi;
    let kernelFinder: IKernelFinder;
    let interpreterService: IInterpreterService;
    let resourceToUse: Uri;
    let rankHelper: IKernelRankingHelper;
    suiteSetup(async () => {
        api = await initialize();
        kernelFinder = api.serviceContainer.get<IKernelFinder>(IKernelFinder);
        interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        rankHelper = api.serviceContainer.get<IKernelRankingHelper>(IKernelRankingHelper);
        resourceToUse = Uri.file(path.join(workspace.workspaceFolders![0].uri.fsPath, 'test.ipynb'));
    });
    setup(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
    });
    teardown(async function () {
        traceInfo(`Start Test ${this.currentTest?.title}`);
    });

    test('Can list all kernels', async () => {
        const kernelSpecs = await kernelFinder.listKernels(resourceToUse);
        assert.isArray(kernelSpecs);
        assert.isAtLeast(kernelSpecs.length, 1);
    });
    test('No kernel returned or non exact match if no matching kernel found for language', async () => {
        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(resourceToUse, {
                language_info: { name: 'foobar' },
                orig_nbformat: 4
            })
        );
        const isMatch =
            kernelSpec &&
            rankHelper.isExactMatch(resourceToUse, kernelSpec, {
                language_info: { name: 'foobar' },
                orig_nbformat: 4
            });
        assert.isNotTrue(isMatch);
    });
    test('Python kernel returned if no matching kernel found', async () => {
        const interpreter = await interpreterService.getActiveInterpreter(resourceToUse);
        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(
                resourceToUse,
                {
                    kernelspec: { display_name: 'foobar', name: 'foobar' },
                    orig_nbformat: 4,
                    language_info: {
                        name: PYTHON_LANGUAGE
                    }
                },
                interpreter
            )
        );
        if (!kernelSpec?.interpreter) {
            throw new Error('Kernelspec & interpreter info should not be empty');
        }

        assert.isTrue(
            areInterpreterPathsSame(kernelSpec.interpreter.uri, interpreter?.uri),
            `No interpreter found, kernelspec interpreter is ${getDisplayPath(
                kernelSpec.interpreter.uri
            )} but expected ${getDisplayPath(interpreter?.uri)}`
        );
    });
    test('Interpreter kernel returned if kernelspec metadata not provided', async () => {
        const interpreter = await interpreterService.getActiveInterpreter(resourceToUse);
        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(
                resourceToUse,
                {
                    kernelspec: undefined,
                    orig_nbformat: 4,
                    language_info: {
                        name: PYTHON_LANGUAGE
                    }
                },
                interpreter
            )
        );
        if (!kernelSpec?.interpreter) {
            throw new Error('Kernelspec & interpreter info should not be empty');
        }
        assert.isTrue(
            areInterpreterPathsSame(kernelSpec.interpreter.uri, interpreter?.uri),
            `No interpreter found, kernelspec interpreter is ${getDisplayPath(
                kernelSpec.interpreter.uri
            )} but expected ${getDisplayPath(interpreter?.uri)}`
        );
    });
    test('Can find a Python kernel based on language', async () => {
        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(resourceToUse, {
                language_info: { name: PYTHON_LANGUAGE },
                orig_nbformat: 4
            })
        );
        assert.ok(kernelSpec);
        const language = getKernelConnectionLanguage(kernelSpec);
        assert.equal(language, PYTHON_LANGUAGE);
    });
    test('Can find a Python kernel based on language (non-python-kernel)', async function () {
        // eslint-disable-next-line local-rules/dont-use-process
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST) {
            return this.skip();
        }

        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(resourceToUse, {
                language_info: { name: 'julia' },
                orig_nbformat: 4
            })
        );
        assert.ok(kernelSpec);
        const language = getKernelConnectionLanguage(kernelSpec);
        assert.equal(language, 'julia');
    });
    test('Can find a Julia kernel based on kernelspec (non-python-kernel)', async function () {
        // eslint-disable-next-line local-rules/dont-use-process
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST) {
            return this.skip();
        }
        const kernelSpecs = await kernelFinder.listKernels(resourceToUse);
        const juliaKernelSpec = kernelSpecs.find(
            (item) => item.kind !== 'connectToLiveRemoteKernel' && item?.kernelSpec?.language === 'julia'
        ) as LocalKernelConnectionMetadata;
        assert.ok(juliaKernelSpec);

        const kernelSpec = takeTopRankKernel(
            await rankHelper.rankKernels(resourceToUse, {
                kernelspec: juliaKernelSpec?.kernelSpec as any,
                orig_nbformat: 4
            })
        ) as LocalKernelConnectionMetadata;
        assert.ok(kernelSpec.kernelSpec);
        assert.deepEqual(kernelSpec.kernelSpec.name, juliaKernelSpec.kernelSpec.name);
    });
});

function takeTopRankKernel(
    rankedKernels: KernelConnectionMetadata[] | undefined
): KernelConnectionMetadata | undefined {
    if (rankedKernels && rankedKernels.length) {
        return rankedKernels[rankedKernels.length - 1];
    }
}
