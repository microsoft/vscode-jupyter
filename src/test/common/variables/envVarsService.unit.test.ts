// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as path from '../../../platform/vscode-path/path';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { EnvironmentVariablesService, parseEnvFile } from '../../../platform/common/variables/environment.node';
import { anything, instance, mock, when } from 'ts-mockito';
import { Uri } from 'vscode';

use(chaiAsPromised);

suite('Environment Variables Service', () => {
    const filename = 'x/y/z/.env';
    let fs: IFileSystemNode;
    let variablesService: EnvironmentVariablesService;
    setup(() => {
        fs = mock<IFileSystemNode>();
        variablesService = new EnvironmentVariablesService(instance(fs));
    });
    function setFile(fileName: string, text: string) {
        when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath === Uri.file(fileName).fsPath);
        when(fs.readFile(anything())).thenCall((file: Uri) =>
            Promise.resolve(file.fsPath === Uri.file(fileName).fsPath ? text : '')
        );
    }

    suite('parseFile()', () => {
        test('Custom variables should be undefined with no argument', async () => {
            const vars = await variablesService.parseFile(undefined);

            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be undefined with non-existent files', async () => {
            when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath !== Uri.file(filename).fsPath);

            const vars = await variablesService.parseFile(filename);

            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be undefined when folder name is passed instead of a file name', async () => {
            const dirname = 'x/y/z';
            when(fs.exists(anything())).thenCall((file: Uri) => file.fsPath !== Uri.file(dirname).fsPath);
            const vars = await variablesService.parseFile(dirname);

            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be not undefined with a valid environment file', async () => {
            setFile(filename, '...');

            const vars = await variablesService.parseFile(filename);

            expect(vars).to.not.equal(undefined, 'Variables should be undefined');
        });

        test('Custom variables should be parsed from env file', async () => {
            // src/testMultiRootWkspc/workspace4/.env
            setFile(
                filename,
                `
X1234PYEXTUNITTESTVAR=1234
PYTHONPATH=../workspace5
                `
            );

            const vars = await variablesService.parseFile(filename);

            expect(vars).to.not.equal(undefined, 'Variables is is undefiend');
            expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('X1234PYEXTUNITTESTVAR', '1234', 'X1234PYEXTUNITTESTVAR value is invalid');
            expect(vars).to.have.property('PYTHONPATH', '../workspace5', 'PYTHONPATH value is invalid');
        });

        test('PATH and PYTHONPATH from env file should be returned as is', async () => {
            const expectedPythonPath = '/usr/one/three:/usr/one/four';
            const expectedPath = '/usr/x:/usr/y';
            // src/testMultiRootWkspc/workspace4/.env
            setFile(
                filename,
                `
X=1
Y=2
PYTHONPATH=/usr/one/three:/usr/one/four
# Unix PATH variable
PATH=/usr/x:/usr/y
# Windows Path variable
Path=/usr/x:/usr/y
                `
            );

            const vars = await variablesService.parseFile(filename);

            expect(vars).to.not.equal(undefined, 'Variables is is undefiend');
            expect(Object.keys(vars!)).lengthOf(5, 'Incorrect number of variables');
            expect(vars).to.have.property('X', '1', 'X value is invalid');
            expect(vars).to.have.property('Y', '2', 'Y value is invalid');
            expect(vars).to.have.property('PYTHONPATH', expectedPythonPath, 'PYTHONPATH value is invalid');
            expect(vars).to.have.property('PATH', expectedPath, 'PATH value is invalid');
        });

        test('Simple variable substitution is supported', async () => {
            // src/testMultiRootWkspc/workspace4/.env
            setFile(
                filename,
                /* eslint-disable no-template-curly-in-string */
                '\
REPO=/home/user/git/foobar\n\
PYTHONPATH=${REPO}/foo:${REPO}/bar\n\
PYTHON=${BINDIR}/python3\n\
                '
                /* eslint-enable no-template-curly-in-string */
            );

            const vars = await variablesService.parseFile(filename, { BINDIR: '/usr/bin' });

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

    suite(`mergeVariables()`, () => {
        test('Ensure variables are merged', async () => {
            const vars1 = { ONE: '1', TWO: 'TWO' };
            const vars2 = { ONE: 'ONE', THREE: '3' };

            variablesService.mergeVariables(vars1, vars2);

            expect(Object.keys(vars1)).lengthOf(2, 'Source variables modified');
            expect(Object.keys(vars2)).lengthOf(3, 'Variables not merged');
            expect(vars2).to.have.property('ONE', '1', 'Variable overwritten');
            expect(vars2).to.have.property('TWO', 'TWO', 'Incorrect value');
            expect(vars2).to.have.property('THREE', '3', 'Variable not merged');
        });

        test('Ensure path variables variables are not merged into target', async () => {
            const vars1 = { ONE: '1', TWO: 'TWO', PYTHONPATH: 'PYTHONPATH' };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vars1 as any)['paTh'] = 'PATH';
            const vars2 = { ONE: 'ONE', THREE: '3' };

            variablesService.mergeVariables(vars1, vars2);

            expect(Object.keys(vars1)).lengthOf(4, 'Source variables modified');
            expect(Object.keys(vars2)).lengthOf(3, `Variables not merged in ${JSON.stringify(vars2)}`);
            expect(vars2).to.have.property('ONE', '1', 'Variable overwritten');
            expect(vars2).to.have.property('TWO', 'TWO', 'Incorrect value');
            expect(vars2).to.have.property('THREE', '3', 'Variable not merged');
        });

        test('Ensure path variables variables in target are left untouched', async () => {
            const vars1 = { ONE: '1', TWO: 'TWO' };
            const vars2 = { ONE: 'ONE', THREE: '3', PYTHONPATH: 'PYTHONPATH' };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vars2 as any)['Path'] = 'PATH';
            (vars2 as any)['PaTH'] = 'PATH2';
            (vars2 as any)['PATH'] = 'PATH3';

            variablesService.mergeVariables(vars1, vars2);

            expect(Object.keys(vars1)).lengthOf(2, 'Source variables modified');
            expect(Object.keys(vars2)).lengthOf(7, 'Variables not merged');
            expect(vars2).to.have.property('ONE', '1', 'Variable overwritten');
            expect(vars2).to.have.property('TWO', 'TWO', 'Incorrect value');
            expect(vars2).to.have.property('THREE', '3', 'Variable not merged');
            expect(vars2).to.have.property('PYTHONPATH', 'PYTHONPATH', 'Incorrect value');
            expect(vars2).to.have.property('Path', 'PATH', 'Incorrect value');
            expect(vars2).to.have.property('PaTH', 'PATH2', 'Incorrect value');
            expect(vars2).to.have.property('PATH', 'PATH3', 'Incorrect value');
        });
    });

    suite(`appendPath() `, () => {
        test('Ensure appending PATH has no effect if an undefined value or empty string is provided and PATH does not exist in vars object', async () => {
            const vars = { ONE: '1' };

            variablesService.appendPath(vars);
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');

            variablesService.appendPath(vars, '');
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');

            variablesService.appendPath(vars, ' ', '');
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
        });

        test(`Ensure appending PATH has no effect if an empty string is provided and path does not exist in vars object`, async () => {
            const vars = { ONE: '1' };
            const pathVariable = 'paTh';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vars as any)[pathVariable] = 'PATH';

            variablesService.appendPath(vars);
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property(pathVariable, 'PATH', 'Incorrect value');

            variablesService.appendPath(vars, '');
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property(pathVariable, 'PATH', 'Incorrect value');

            variablesService.appendPath(vars, ' ', '');
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property(pathVariable, 'PATH', 'Incorrect value');
        });

        test(`Ensure PATH is appended irregardless of case`, async () => {
            const vars = { ONE: '1' };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (vars as any)['paTh'] = 'PATH';
            const pathToAppend = `/usr/one${path.delimiter}/usr/three`;

            variablesService.appendPath(vars, pathToAppend);

            expect(Object.keys(vars)).lengthOf(2, `Incorrect number of variables ${Object.keys(vars).join(' ')}`);
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property(`paTh`, `PATH${path.delimiter}${pathToAppend}`, 'Incorrect value');
        });
        test(`Ensure PATH is not appended if already at the end`, async () => {
            const defaultPath = `/usr/one${path.delimiter}/usr/three${path.delimiter}/usr/four${path.delimiter}/usr/five`;
            const vars = {
                ONE: '1',
                paTh: defaultPath
            };
            const pathToAppend = `/usr/four${path.delimiter}/usr/five`;

            variablesService.appendPath(vars, pathToAppend);

            expect(vars).to.have.property(`paTh`, defaultPath, 'Incorrect value');
        });
        test(`Ensure PATH is appended even if path exists elsewhere in the PATH value`, async () => {
            const defaultPath = `/usr/one${path.delimiter}/usr/three${path.delimiter}/usr/four${path.delimiter}/usr/five`;
            const vars = {
                ONE: '1',
                paTh: defaultPath
            };
            const pathToAppend = `/usr/one${path.delimiter}/usr/three`;

            variablesService.appendPath(vars, pathToAppend);

            expect(vars).to.have.property(`paTh`, `${defaultPath}${path.delimiter}${pathToAppend}`, 'Incorrect value');
        });
        test(`Ensure PATH is not prepended if already at the start`, async () => {
            const defaultPath = `/usr/one${path.delimiter}/usr/three${path.delimiter}/usr/four${path.delimiter}/usr/five`;
            const vars = {
                ONE: '1',
                paTh: defaultPath
            };
            const pathToPrepend = `/usr/one${path.delimiter}/usr/three`;

            variablesService.prependPath(vars, pathToPrepend);

            expect(vars).to.have.property(`paTh`, defaultPath, 'Incorrect value');
        });
        test(`Ensure PATH is prepended even if path exists elsewhere in the PATH value`, async () => {
            const defaultPath = `/usr/one${path.delimiter}/usr/three${path.delimiter}/usr/four${path.delimiter}/usr/five`;
            const vars = {
                ONE: '1',
                paTh: defaultPath
            };
            const pathToPrepend = `/usr/four${path.delimiter}/usr/five`;

            variablesService.prependPath(vars, pathToPrepend);

            expect(vars).to.have.property(`paTh`, `${pathToPrepend}${path.delimiter}${defaultPath}`, 'Incorrect value');
        });
    });

    suite('appendPythonPath()', () => {
        test('Ensure appending PYTHONPATH has no effect if an undefined value or empty string is provided and PYTHONPATH does not exist in vars object', async () => {
            const vars = { ONE: '1' };

            variablesService.appendPythonPath(vars);
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');

            variablesService.appendPythonPath(vars, '');
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');

            variablesService.appendPythonPath(vars, ' ', '');
            expect(Object.keys(vars)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
        });

        test('Ensure appending PYTHONPATH has no effect if an empty string is provided and PYTHONPATH does not exist in vars object', async () => {
            const vars = { ONE: '1', PYTHONPATH: 'PYTHONPATH' };

            variablesService.appendPythonPath(vars);
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property('PYTHONPATH', 'PYTHONPATH', 'Incorrect value');

            variablesService.appendPythonPath(vars, '');
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property('PYTHONPATH', 'PYTHONPATH', 'Incorrect value');

            variablesService.appendPythonPath(vars, ' ', '');
            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property('PYTHONPATH', 'PYTHONPATH', 'Incorrect value');
        });

        test('Ensure appending PYTHONPATH has no effect if an empty string is provided and PYTHONPATH does not exist in vars object', async () => {
            const vars = { ONE: '1', PYTHONPATH: 'PYTHONPATH' };
            const pathToAppend = `/usr/one${path.delimiter}/usr/three`;

            variablesService.appendPythonPath(vars, pathToAppend);

            expect(Object.keys(vars)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('ONE', '1', 'Incorrect value');
            expect(vars).to.have.property(
                'PYTHONPATH',
                `PYTHONPATH${path.delimiter}${pathToAppend}`,
                'Incorrect value'
            );
        });
    });
});

suite('Parsing Environment Variables Files', () => {
    suite('parseEnvFile()', () => {
        test('Custom variables should be parsed from env file', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
X1234PYEXTUNITTESTVAR=1234
PYTHONPATH=../workspace5
            `);

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('X1234PYEXTUNITTESTVAR', '1234', 'X1234PYEXTUNITTESTVAR value is invalid');
            expect(vars).to.have.property('PYTHONPATH', '../workspace5', 'PYTHONPATH value is invalid');
        });

        test('PATH and PYTHONPATH from env file should be returned as is', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
X=1
Y=2
PYTHONPATH=/usr/one/three:/usr/one/four
# Unix PATH variable
PATH=/usr/x:/usr/y
# Windows Path variable
Path=/usr/x:/usr/y
            `);

            const expectedPythonPath = '/usr/one/three:/usr/one/four';
            const expectedPath = '/usr/x:/usr/y';
            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(5, 'Incorrect number of variables');
            expect(vars).to.have.property('X', '1', 'X value is invalid');
            expect(vars).to.have.property('Y', '2', 'Y value is invalid');
            expect(vars).to.have.property('PYTHONPATH', expectedPythonPath, 'PYTHONPATH value is invalid');
            expect(vars).to.have.property('PATH', expectedPath, 'PATH value is invalid');
        });

        test('Variable names must be alpha + alnum/underscore', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
SPAM=1234
ham=5678
Eggs=9012
_bogus1=...
1bogus2=...
bogus 3=...
bogus.4=...
bogus-5=...
bogus~6=...
VAR1=3456
VAR_2=7890
            `);

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(5, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
            expect(vars).to.have.property('ham', '5678', 'value is invalid');
            expect(vars).to.have.property('Eggs', '9012', 'value is invalid');
            expect(vars).to.have.property('VAR1', '3456', 'value is invalid');
            expect(vars).to.have.property('VAR_2', '7890', 'value is invalid');
        });

        test('Empty values become empty string', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
SPAM=
            `);

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(1, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '', 'value is invalid');
        });

        test('Outer quotation marks are removed', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
SPAM=1234
HAM='5678'
EGGS="9012"
FOO='"3456"'
BAR="'7890'"
BAZ="\"ABCD"
VAR1="EFGH
VAR2=IJKL"
VAR3='MN'OP'
VAR4="QR"ST"
            `);

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(10, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
            expect(vars).to.have.property('HAM', '5678', 'value is invalid');
            expect(vars).to.have.property('EGGS', '9012', 'value is invalid');
            expect(vars).to.have.property('FOO', '"3456"', 'value is invalid');
            expect(vars).to.have.property('BAR', "'7890'", 'value is invalid');
            expect(vars).to.have.property('BAZ', '"ABCD', 'value is invalid');
            expect(vars).to.have.property('VAR1', '"EFGH', 'value is invalid');
            expect(vars).to.have.property('VAR2', 'IJKL"', 'value is invalid');
            // eslint-disable-next-line
            // TODO: Should the outer marks be left?
            expect(vars).to.have.property('VAR3', "MN'OP", 'value is invalid');
            expect(vars).to.have.property('VAR4', 'QR"ST', 'value is invalid');
        });

        test('Whitespace is ignored', () => {
            /* eslint-disable no-trailing-spaces */
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
SPAM=1234
HAM =5678
EGGS= 9012
FOO = 3456
  BAR=7890
  BAZ = ABCD
VAR1=EFGH  ...
VAR2=IJKL
VAR3='  MNOP  '
            `);
            /* eslint-enable no-trailing-spaces */

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(9, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
            expect(vars).to.have.property('HAM', '5678', 'value is invalid');
            expect(vars).to.have.property('EGGS', '9012', 'value is invalid');
            expect(vars).to.have.property('FOO', '3456', 'value is invalid');
            expect(vars).to.have.property('BAR', '7890', 'value is invalid');
            expect(vars).to.have.property('BAZ', 'ABCD', 'value is invalid');
            expect(vars).to.have.property('VAR1', 'EFGH  ...', 'value is invalid');
            expect(vars).to.have.property('VAR2', 'IJKL', 'value is invalid');
            expect(vars).to.have.property('VAR3', '  MNOP  ', 'value is invalid');
        });

        test('Blank lines are ignored', () => {
            /* eslint-disable no-trailing-spaces */
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`

SPAM=1234

HAM=5678


            `);
            /* eslint-enable no-trailing-spaces */

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
            expect(vars).to.have.property('HAM', '5678', 'value is invalid');
        });

        test('Comments are ignored', () => {
            // eslint-disable-next-line no-multi-str
            const vars = parseEnvFile(`
# step 1
SPAM=1234
  # step 2
HAM=5678
#step 3
EGGS=9012  # ...
#  done
            `);

            expect(vars).to.not.equal(undefined, 'Variables is undefiend');
            expect(Object.keys(vars!)).lengthOf(3, 'Incorrect number of variables');
            expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
            expect(vars).to.have.property('HAM', '5678', 'value is invalid');
            expect(vars).to.have.property('EGGS', '9012  # ...', 'value is invalid');
        });

        suite('variable substitution', () => {
            /* eslint-disable no-template-curly-in-string */

            test('Basic substitution syntax', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile(
                    '\
REPO=/home/user/git/foobar \n\
PYTHONPATH=${REPO}/foo:${REPO}/bar \n\
                '
                );

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
                expect(vars).to.have.property('REPO', '/home/user/git/foobar', 'value is invalid');
                expect(vars).to.have.property(
                    'PYTHONPATH',
                    '/home/user/git/foobar/foo:/home/user/git/foobar/bar',
                    'value is invalid'
                );
            });

            test('Curly braces are required for substitution', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile('\
SPAM=1234 \n\
EGGS=$SPAM \n\
                ');

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
                expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
                expect(vars).to.have.property('EGGS', '$SPAM', 'value is invalid');
            });

            test('Nested substitution is not supported', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile(
                    '\
SPAM=EGGS \n\
EGGS=??? \n\
HAM1="-- ${${SPAM}} --"\n\
abcEGGSxyz=!!! \n\
HAM2="-- ${abc${SPAM}xyz} --"\n\
HAM3="-- ${${SPAM} --"\n\
HAM4="-- ${${SPAM}} ${EGGS} --"\n\
                    '
                );

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(7, 'Incorrect number of variables');
                expect(vars).to.have.property('SPAM', 'EGGS', 'value is invalid');
                expect(vars).to.have.property('EGGS', '???', 'value is invalid');
                expect(vars).to.have.property('HAM1', '-- ${${SPAM}} --', 'value is invalid');
                expect(vars).to.have.property('abcEGGSxyz', '!!!', 'value is invalid');
                expect(vars).to.have.property('HAM2', '-- ${abc${SPAM}xyz} --', 'value is invalid');
                expect(vars).to.have.property('HAM3', '-- ${${SPAM} --', 'value is invalid');
                expect(vars).to.have.property('HAM4', '-- ${${SPAM}} ${EGGS} --', 'value is invalid');
            });

            test('Other bad substitution syntax', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile(
                    '\
SPAM=EGGS \n\
EGGS=??? \n\
HAM1=${} \n\
HAM2=${ \n\
HAM3=${SPAM+EGGS} \n\
HAM4=$SPAM \n\
                '
                );

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(6, 'Incorrect number of variables');
                expect(vars).to.have.property('SPAM', 'EGGS', 'value is invalid');
                expect(vars).to.have.property('EGGS', '???', 'value is invalid');
                expect(vars).to.have.property('HAM1', '${}', 'value is invalid');
                expect(vars).to.have.property('HAM2', '${', 'value is invalid');
                expect(vars).to.have.property('HAM3', '${SPAM+EGGS}', 'value is invalid');
                expect(vars).to.have.property('HAM4', '$SPAM', 'value is invalid');
            });

            test('Recursive substitution is allowed', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile(
                    '\
REPO=/home/user/git/foobar \n\
PYTHONPATH=${REPO}/foo \n\
PYTHONPATH=${PYTHONPATH}:${REPO}/bar \n\
                '
                );

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(2, 'Incorrect number of variables');
                expect(vars).to.have.property('REPO', '/home/user/git/foobar', 'value is invalid');
                expect(vars).to.have.property(
                    'PYTHONPATH',
                    '/home/user/git/foobar/foo:/home/user/git/foobar/bar',
                    'value is invalid'
                );
            });

            test('Substitution may be escaped', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile(
                    '\
SPAM=1234 \n\
EGGS=\\${SPAM}/foo:\\${SPAM}/bar \n\
HAM=$ ... $$ \n\
                '
                );

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(3, 'Incorrect number of variables');
                expect(vars).to.have.property('SPAM', '1234', 'value is invalid');
                expect(vars).to.have.property('EGGS', '${SPAM}/foo:${SPAM}/bar', 'value is invalid');
                expect(vars).to.have.property('HAM', '$ ... $$', 'value is invalid');
            });

            test('base substitution variables', () => {
                // eslint-disable-next-line no-multi-str
                const vars = parseEnvFile('\
PYTHONPATH=${REPO}/foo:${REPO}/bar \n\
                ', {
                    REPO: '/home/user/git/foobar'
                });

                expect(vars).to.not.equal(undefined, 'Variables is undefiend');
                expect(Object.keys(vars!)).lengthOf(1, 'Incorrect number of variables');
                expect(vars).to.have.property(
                    'PYTHONPATH',
                    '/home/user/git/foobar/foo:/home/user/git/foobar/bar',
                    'value is invalid'
                );
            });

            /* eslint-enable no-template-curly-in-string */
        });
    });
});
