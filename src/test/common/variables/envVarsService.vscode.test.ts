// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as path from '../../../platform/vscode-path/path';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { EnvironmentVariablesService } from '../../../platform/common/variables/environment.node';
import { IEnvironmentVariablesService } from '../../../platform/common/variables/types';
import { initialize } from '../../initialize';
import { IHttpClient } from '../../../platform/common/types';

use(chaiAsPromised);

const envFilesFolderPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'src',
    'test',
    'testMultiRootWkspc',
    'workspace4'
);

// Functional tests that do not run code using the VS Code API are found
// in envVarsService.test.ts.

suite('Environment Variables Service', () => {
    let variablesService: IEnvironmentVariablesService;
    setup(async () => {
        const api = await initialize();
        const fs = new FileSystem(api.serviceManager.get<IHttpClient>(IHttpClient));
        variablesService = new EnvironmentVariablesService(fs);
    });

    suite('parseFile()', () => {
        test('Custom variables should be undefined with no argument', async () => {
            const vars = await variablesService.parseFile(undefined);
            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be undefined with non-existent files', async () => {
            const vars = await variablesService.parseFile(path.join(envFilesFolderPath, 'abcd'));
            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be undefined when folder name is passed instead of a file name', async () => {
            const vars = await variablesService.parseFile(envFilesFolderPath);
            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be not undefined with a valid environment file', async () => {
            const vars = await variablesService.parseFile(path.join(envFilesFolderPath, '.env'));
            expect(vars).to.not.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be parsed from env file', async () => {
            const vars = await variablesService.parseFile(path.join(envFilesFolderPath, '.env'));

            expect(vars).to.not.equal(undefined, 'Variables is is undefiend');
            expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('X1234PYEXTUNITTESTVAR', '1234', 'X1234PYEXTUNITTESTVAR value is invalid');
            expect(vars).to.have.property('PYTHONPATH', '../workspace5', 'PYTHONPATH value is invalid');
        });

        test('PATH and PYTHONPATH from env file should be returned as is', async () => {
            const vars = await variablesService.parseFile(path.join(envFilesFolderPath, '.env5'));
            const expectedPythonPath = '/usr/one/three:/usr/one/four';
            const expectedPath = '/usr/x:/usr/y';
            expect(vars).to.not.equal(undefined, 'Variables is is undefiend');
            expect(Object.keys(vars!)).lengthOf(5, 'Incorrect number of variables');
            expect(vars).to.have.property('X', '1', 'X value is invalid');
            expect(vars).to.have.property('Y', '2', 'Y value is invalid');
            expect(vars).to.have.property('PYTHONPATH', expectedPythonPath, 'PYTHONPATH value is invalid');
            expect(vars).to.have.property('PATH', expectedPath, 'PATH value is invalid');
        });

        test('Simple variable substitution is supported', async () => {
            const vars = await variablesService.parseFile(path.join(envFilesFolderPath, '.env6'), {
                BINDIR: '/usr/bin'
            });

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(3, 'Incorrect number of variables');
            expect(vars).to.have.property('REPO', '/home/user/git/foobar', 'value is invalid');
            expect(vars).to.have.property(
                'PYTHONPATH',
                '/home/user/git/foobar/foo:/home/user/git/foobar/bar',
                'value is invalid'
            );
            expect(vars).to.have.property('PYTHON', '/usr/bin/python3', 'value is invalid');
        });
    });
});
