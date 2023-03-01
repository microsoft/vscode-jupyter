// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as path from '../../vscode-path/path';
import * as TypeMoq from 'typemoq';

import { ProcessLogger } from './logger.node';
import { IOutputChannel } from '../types';
import { Logging } from '../utils/localize';
import { homedir } from 'os';

/* eslint-disable  */
suite('ProcessLogger suite', () => {
    let outputChannel: TypeMoq.IMock<IOutputChannel>;
    let outputResult: string;

    suiteSetup(() => {
        outputChannel = TypeMoq.Mock.ofType<IOutputChannel>();
    });

    setup(() => {
        outputResult = '';
        outputChannel
            .setup((o) => o.appendLine(TypeMoq.It.isAnyString()))
            .returns((s: string) => (outputResult += `${s}\n`));
    });

    teardown(() => {
        outputChannel.reset();
    });

    test('Logger displays the process command, arguments and current working directory in the output channel', async () => {
        const options = { cwd: path.join('debug', 'path') };
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess('test', ['--foo', '--bar'], options);

        const expectedResult = `> test --foo --bar\n${Logging.currentWorkingDirectory} ${options.cwd}\n`;
        expect(outputResult).to.equal(expectedResult, 'Output string is incorrect - String built incorrectly');

        outputChannel.verify((o) => o.appendLine(TypeMoq.It.isAnyString()), TypeMoq.Times.exactly(2));
    });

    test('Logger adds quotes around arguments if they contain spaces', async () => {
        const options = { cwd: path.join('debug', 'path') };
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess('test', ['--foo', '--bar', 'import test'], options);

        const expectedResult = `> test --foo --bar "import test"\n${Logging.currentWorkingDirectory} ${path.join(
            'debug',
            'path'
        )}\n`;
        expect(outputResult).to.equal(expectedResult, 'Output string is incorrect: Home directory is not tildified');
    });

    test('Logger preserves quotes around arguments if they contain spaces', async () => {
        const options = { cwd: path.join('debug', 'path') };
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess('test', ['--foo', '--bar', "'import test'"], options);

        const expectedResult = `> test --foo --bar \'import test\'\n${Logging.currentWorkingDirectory} ${path.join(
            'debug',
            'path'
        )}\n`;
        expect(outputResult).to.equal(expectedResult, 'Output string is incorrect: Home directory is not tildified');
    });

    test('Logger replaces the path/to/home with ~ in the current working directory', async () => {
        const options = { cwd: path.join(homedir(), 'debug', 'path') };
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess('test', ['--foo', '--bar'], options);

        const expectedResult = `> test --foo --bar\n${Logging.currentWorkingDirectory} ${path.join(
            '~',
            'debug',
            'path'
        )}\n`;
        expect(outputResult).to.equal(expectedResult, 'Output string is incorrect: Home directory is not tildified');
    });

    test('Logger replaces the path/to/home with ~ in the command path', async () => {
        const options = { cwd: path.join('debug', 'path') };
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess(path.join(homedir(), 'test'), ['--foo', '--bar'], options);

        const expectedResult = `> ${path.join('~', 'test')} --foo --bar\n${Logging.currentWorkingDirectory} ${
            options.cwd
        }\n`;
        expect(outputResult).to.equal(expectedResult, 'Output string is incorrect: Home directory is not tildified');
    });

    test("Logger doesn't display the working directory line if there is no options parameter", async () => {
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess(path.join(homedir(), 'test'), ['--foo', '--bar']);

        const expectedResult = `> ${path.join('~', 'test')} --foo --bar\n`;
        expect(outputResult).to.equal(
            expectedResult,
            'Output string is incorrect: Working directory line should not be displayed'
        );
    });

    test("Logger doesn't display the working directory line if there is no cwd key in the options parameter", async () => {
        const options = {};
        const logger = new ProcessLogger(outputChannel.object);
        logger.logProcess(path.join(homedir(), 'test'), ['--foo', '--bar'], options);

        const expectedResult = `> ${path.join('~', 'test')} --foo --bar\n`;
        expect(outputResult).to.equal(
            expectedResult,
            'Output string is incorrect: Working directory line should not be displayed'
        );
    });
});
