// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { Uri, workspace } from 'vscode';
import { PYTHON_LANGUAGE } from '../../../client/common/constants';
import { getKernelConnectionLanguage } from '../../../client/datascience/jupyter/kernels/helpers';
import { ILocalKernelFinder } from '../../../client/datascience/kernel-launcher/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { IExtensionTestApi } from '../../common';
import { initialize } from '../../initialize';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Kernels Finder', () => {
    let api: IExtensionTestApi;
    let kernelFinder: ILocalKernelFinder;
    let interpreterService: IInterpreterService;
    let resourceToUse: Uri;
    suiteSetup(async () => {
        api = await initialize();
        kernelFinder = api.serviceContainer.get<ILocalKernelFinder>(ILocalKernelFinder);
        interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
        resourceToUse = workspace.workspaceFolders![0].uri;
    });
    test('Can list all kernels', async () => {
        const kernelSpecs = await kernelFinder.listKernels(resourceToUse);
        assert.isArray(kernelSpecs);
        assert.isAtLeast(kernelSpecs.length, 1);
    });
    test('No kernel returned if no matching kernel found for language', async () => {
        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            language_info: { name: 'foobar' },
            orig_nbformat: 4
        });
        assert.isUndefined(kernelSpec);
    });
    test('Python kernel returned if no matching kernel found', async () => {
        const interpreter = await interpreterService.getActiveInterpreter(resourceToUse);
        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            kernelspec: { display_name: 'foobar', name: 'foobar' },
            orig_nbformat: 4
        });
        assert.ok(kernelSpec);
        assert.equal(kernelSpec?.interpreter?.path, interpreter?.path, 'No interpreter found');
    });
    test('Interpreter kernel returned if kernelspec metadata not provided', async () => {
        const interpreter = await interpreterService.getActiveInterpreter(resourceToUse);
        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            kernelspec: undefined,
            orig_nbformat: 4
        });
        assert.ok(kernelSpec);
        assert.equal(kernelSpec?.interpreter?.path, interpreter?.path, 'No interpreter found');
    });
    test('Can find a Python kernel based on language', async () => {
        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            language_info: { name: PYTHON_LANGUAGE },
            orig_nbformat: 4
        });
        assert.ok(kernelSpec);
        const language = getKernelConnectionLanguage(kernelSpec);
        assert.equal(language, PYTHON_LANGUAGE);
    });
    test('Can find a Python kernel based on language (non-python-kernel)', async function () {
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST) {
            return this.skip();
        }

        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            language_info: { name: 'julia' },
            orig_nbformat: 4
        });
        assert.ok(kernelSpec);
        const language = getKernelConnectionLanguage(kernelSpec);
        assert.equal(language, 'julia');
    });
    test('Can find a Julia kernel based on kernelspec (non-python-kernel)', async function () {
        if (!process.env.VSC_JUPYTER_CI_RUN_NON_PYTHON_NB_TEST) {
            return this.skip();
        }
        const kernelSpecs = await kernelFinder.listKernels(resourceToUse);
        const juliaKernelSpec = kernelSpecs.find((item) => item.kernelSpec?.language === 'julia');
        assert.ok(juliaKernelSpec);

        const kernelSpec = await kernelFinder.findKernel(resourceToUse, {
            kernelspec: juliaKernelSpec?.kernelSpec as any,
            orig_nbformat: 4
        });
        assert.ok(kernelSpec);
        assert.deepEqual(kernelSpec, juliaKernelSpec);
    });
});
