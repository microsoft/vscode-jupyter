"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const path = require("path");
const platform_1 = require("../../../client/common/utils/platform");
const commonUtils_1 = require("../../../client/pythonEnvironments/common/commonUtils");
const fs_1 = require("../../utils/fs");
const IS_WINDOWS = (0, platform_1.getOSType)() === platform_1.OSType.Windows;
async function ensureFSTree(tree) {
    await (0, fs_1.ensureFSTree)(tree.trimEnd(), __dirname);
}
suite('pyenvs common utils - finding Python executables', () => {
    const datadir = path.join(__dirname, '.data');
    function resolveDataFiles(rootName, relnames) {
        return relnames.map((relname) => path.normalize(`${datadir}/${rootName}/${relname}`));
    }
    async function find(rootName, maxDepth, filterDir) {
        const results = [];
        const root = path.join(datadir, rootName);
        const executables = (0, commonUtils_1.findInterpretersInDir)(root, maxDepth, filterDir);
        for await (const entry of executables) {
            results.push(entry.filename);
        }
        return results;
    }
    suite('mixed', () => {
        const rootName = 'root_mixed';
        suiteSetup(async () => {
            if (IS_WINDOWS) {
                await ensureFSTree(`
                    ./.data/
                       ${rootName}/
                          sub1/
                             spam
                          sub2/
                             sub2.1/
                                sub2.1.1/
                                   <python.exe>
                                spam.txt
                             sub2.2/
                                <spam.exe>
                                python3.exe
                          sub3/
                             python.exe
                          <spam.exe>
                          spam.txt
                          <python.exe>
                          eggs.exe
                          python2.exe
                          <python3.8.exe>
                `);
            }
            else {
                await ensureFSTree(`
                    ./.data/
                       ${rootName}/
                          sub1/
                             spam
                          sub2/
                             sub2.1/
                                sub2.1.1/
                                   <python>
                                spam.txt
                             sub2.2/
                                <spam>
                                python3
                          sub3/
                             python
                          <spam>
                          spam.txt
                          <python>
                          eggs
                          python2
                          <python3.8>
                          python3 -> sub2/sub2.2/python3
                          python3.7 -> sub2/sub2.1/sub2.1.1/python
                          python2.7 -> does-not-exist
                `);
            }
        });
        suite('non-recursive', () => {
            test('no filter', async () => {
                const expected = resolveDataFiles(rootName, IS_WINDOWS
                    ? [
                        'python.exe',
                        'python2.exe',
                        'python3.8.exe',
                    ]
                    : [
                        'python',
                        'python2',
                        'python2.7',
                        'python3',
                        'python3.7',
                        'python3.8',
                    ]);
                const found = await find(rootName);
                chai_1.assert.deepEqual(found, expected);
            });
        });
        suite('recursive', () => {
            test('no filter', async () => {
                const expected = resolveDataFiles(rootName, IS_WINDOWS
                    ? [
                        'python.exe',
                        'python2.exe',
                        'python3.8.exe',
                        'sub2/sub2.1/sub2.1.1/python.exe',
                        'sub2/sub2.2/python3.exe',
                        'sub3/python.exe',
                    ]
                    : [
                        'python',
                        'python2',
                        'python2.7',
                        'python3',
                        'python3.7',
                        'python3.8',
                        'sub2/sub2.1/sub2.1.1/python',
                        'sub2/sub2.2/python3',
                        'sub3/python',
                    ]);
                const found = await find(rootName, 3);
                chai_1.assert.deepEqual(found, expected);
            });
            test('filtered', async () => {
                const expected = resolveDataFiles(rootName, IS_WINDOWS
                    ? [
                        'python.exe',
                        'python2.exe',
                        'python3.8.exe',
                        'sub3/python.exe',
                    ]
                    : [
                        'python',
                        'python2',
                        'python2.7',
                        'python3',
                        'python3.7',
                        'python3.8',
                        'sub3/python',
                    ]);
                function filterDir(dirname) {
                    return dirname.match(/sub\d$/) !== null;
                }
                const found = await find(rootName, 3, filterDir);
                chai_1.assert.deepEqual(found, expected);
            });
        });
    });
    suite('different layouts and patterns', () => {
        suite('names', () => {
            const rootName = 'root_name_patterns';
            suiteSetup(async () => {
                if (IS_WINDOWS) {
                    await ensureFSTree(`
                        ./.data/
                           ${rootName}/
                              <python.exe>
                              <python2.exe>
                              <python2.7.exe>
                              <python27.exe>
                              <python3.exe>
                              <python3.8.exe>
                              <python3.8.1.exe>  # should match but doesn't
                              <python3.8.1rc1.exe>  # should match but doesn't
                              <python3.8.1rc1.10213.exe>  # should match but doesn't
                              <python3.8.1-candidate1.exe>  # should match but doesn't
                              <python.3.8.exe>  # should match but doesn't
                              <python.3.8.1.candidate.1.exe>  # should match but doesn't
                              <python-3.exe>  # should match but doesn't
                              <python-3.8.exe>  # should match but doesn't
                              <python38.exe>
                              <python381.exe>
                              <my-python.exe>  # should match but doesn't
                    `);
                }
                else {
                    await ensureFSTree(`
                        ./.data/
                           ${rootName}/
                              <python>
                              <python2>
                              <python2.7>
                              <python27>
                              <python3>
                              <python3.8>
                              <python3.8.1>  # should match but doesn't
                              <python3.8.1rc1>  # should match but doesn't
                              <python3.8.1rc1.10213>  # should match but doesn't
                              <python3.8.1-candidate1>  # should match but doesn't
                              <python.3.8>  # should match but doesn't
                              <python.3.8.1.candidate.1>  # should match but doesn't
                              <python-3>  # should match but doesn't
                              <python-3.8>  # should match but doesn't
                              <python38>
                              <python381>
                              <my-python>  # should match but doesn't
                    `);
                }
            });
            test('non-recursive', async () => {
                const expected = resolveDataFiles(rootName, IS_WINDOWS
                    ? [
                        'python.exe',
                        'python2.7.exe',
                        'python2.exe',
                        'python27.exe',
                        'python3.8.exe',
                        'python3.exe',
                        'python38.exe',
                        'python381.exe',
                    ]
                    : [
                        'python',
                        'python2',
                        'python2.7',
                        'python27',
                        'python3',
                        'python3.8',
                        'python38',
                        'python381',
                    ]);
                const found = await find(rootName);
                chai_1.assert.deepEqual(found, expected);
            });
        });
        suite('trees', () => {
            const rootName = 'root_layouts';
            suiteSetup(async () => {
                if (IS_WINDOWS) {
                    await ensureFSTree(`
                        ./.data/
                           ${rootName}/
                              py/
                                 2.7/
                                    bin/
                                       <python.exe>
                                       <python2.exe>
                                       <python2.7.exe>
                                 3.8/
                                    bin/
                                       <python.exe>
                                       <python3.exe>
                                       <python3.8.exe>
                              python/
                                 bin/
                                    <python.exe>
                                    <python3.exe>
                                    <python3.8.exe>
                                 3.8/
                                    bin/
                                       <python.exe>
                                       <python3.exe>
                                       <python3.8.exe>
                              python2/
                                 <python.exe>
                              python3/
                                 <python3.exe>
                              python3.8/
                                 bin/
                                    <python3.exe>
                                    <python3.8.exe>
                              python38/
                                 bin/
                                    <python3.exe>
                              python.3.8/
                                 bin/
                                    <python3.exe>
                                    <python3.8.exe>
                              python-3.8/
                                 bin/
                                    <python3.exe>
                                    <python3.8.exe>
                              my-python/
                                 <python3.exe>
                              3.8/
                                 bin/
                                    <python.exe>
                                    <python3.exe>
                                    <python3.8.exe>
                    `);
                }
                else {
                    await ensureFSTree(`
                        ./.data/
                           ${rootName}/
                              py/
                                 2.7/
                                    bin/
                                       <python>
                                       <python2>
                                       <python2.7>
                                 3.8/
                                    bin/
                                       <python>
                                       <python3>
                                       <python3.8>
                              python/
                                 bin/
                                    <python>
                                    <python3>
                                    <python3.8>
                                 3.8/
                                    bin/
                                       <python>
                                       <python3>
                                       <python3.8>
                              python2/
                                 <python>
                              python3/
                                 <python3>
                              python3.8/
                                 bin/
                                    <python3>
                                    <python3.8>
                              python38/
                                 bin/
                                    <python3>
                              python.3.8/
                                 bin/
                                    <python3>
                                    <python3.8>
                              python-3.8/
                                 bin/
                                    <python3>
                                    <python3.8>
                              my-python/
                                 <python3>
                              3.8/
                                 bin/
                                    <python>
                                    <python3>
                                    <python3.8>
                    `);
                }
            });
            test('recursive', async () => {
                const expected = resolveDataFiles(rootName, IS_WINDOWS
                    ? [
                        '3.8/bin/python.exe',
                        '3.8/bin/python3.8.exe',
                        '3.8/bin/python3.exe',
                        'my-python/python3.exe',
                        'py/2.7/bin/python.exe',
                        'py/2.7/bin/python2.7.exe',
                        'py/2.7/bin/python2.exe',
                        'py/3.8/bin/python.exe',
                        'py/3.8/bin/python3.8.exe',
                        'py/3.8/bin/python3.exe',
                        'python/3.8/bin/python.exe',
                        'python/3.8/bin/python3.8.exe',
                        'python/3.8/bin/python3.exe',
                        'python/bin/python.exe',
                        'python/bin/python3.8.exe',
                        'python/bin/python3.exe',
                        'python-3.8/bin/python3.8.exe',
                        'python-3.8/bin/python3.exe',
                        'python.3.8/bin/python3.8.exe',
                        'python.3.8/bin/python3.exe',
                        'python2/python.exe',
                        'python3/python3.exe',
                        'python3.8/bin/python3.8.exe',
                        'python3.8/bin/python3.exe',
                        'python38/bin/python3.exe',
                    ]
                    : [
                        '3.8/bin/python',
                        '3.8/bin/python3',
                        '3.8/bin/python3.8',
                        'my-python/python3',
                        'py/2.7/bin/python',
                        'py/2.7/bin/python2',
                        'py/2.7/bin/python2.7',
                        'py/3.8/bin/python',
                        'py/3.8/bin/python3',
                        'py/3.8/bin/python3.8',
                        'python/3.8/bin/python',
                        'python/3.8/bin/python3',
                        'python/3.8/bin/python3.8',
                        'python/bin/python',
                        'python/bin/python3',
                        'python/bin/python3.8',
                        'python-3.8/bin/python3',
                        'python-3.8/bin/python3.8',
                        'python.3.8/bin/python3',
                        'python.3.8/bin/python3.8',
                        'python2/python',
                        'python3/python3',
                        'python3.8/bin/python3',
                        'python3.8/bin/python3.8',
                        'python38/bin/python3',
                    ]);
                const found = await find(rootName, 3);
                chai_1.assert.deepEqual(found, expected);
            });
        });
    });
    suite('tricky cases', () => {
        const rootName = 'root_tricky';
        suiteSetup(async () => {
            if (IS_WINDOWS) {
                await ensureFSTree(`
                    ./.data/
                       ${rootName}/
                          pythons/
                             <python.exe>
                             <python2.exe>
                             <python2.7.exe>
                             <python3.exe>
                             <python3.7.exe>
                             <python3.8.exe>
                             <python3.9.2.exe>  # should match but doesn't
                             <python3.10a1.exe>  # should match but doesn't
                          python2.7.exe/
                             <spam.exe>
                          python3.8.exe/
                             <python.exe>
                          <py.exe>  # launcher not supported
                          <py3.exe>  # launcher not supported
                          <Python3.exe>  # case-insensitive
                          <PYTHON.EXE>  # case-insensitive
                          <Python3>
                          <PYTHON>
                          <not-python.exe>
                          <python.txt>
                          <python>
                          <python2>
                          <python3>
                          <spam.exe>
                `);
            }
            else {
                await ensureFSTree(`
                    ./.data/
                       ${rootName}/
                          pythons/
                             <python>
                             <python2>
                             <python2.7>
                             <python3>
                             <python3.7>
                             <python3.8>
                             <python3.9.2>  # should match but doesn't
                             <python3.10a1>  # should match but doesn't
                          <py>  # launcher not supported
                          <py3>  # launcher not supported
                          <Python3>
                          <PYTHON>
                          <not-python>
                          <python.txt>
                          <python.exe>
                          <python2.exe>
                          <python3.exe>
                          <spam>
                `);
            }
        });
        test('recursive', async () => {
            const expected = resolveDataFiles(rootName, IS_WINDOWS
                ? [
                    'python3.8.exe/python.exe',
                    'pythons/python.exe',
                    'pythons/python2.7.exe',
                    'pythons/python2.exe',
                    'pythons/python3.7.exe',
                    'pythons/python3.8.exe',
                    'pythons/python3.exe',
                ]
                : [
                    'pythons/python',
                    'pythons/python2',
                    'pythons/python2.7',
                    'pythons/python3',
                    'pythons/python3.7',
                    'pythons/python3.8',
                ]);
            const found = await find(rootName, 3);
            chai_1.assert.deepEqual(found, expected);
        });
    });
});
//# sourceMappingURL=commonUtils.functional.test.js.map