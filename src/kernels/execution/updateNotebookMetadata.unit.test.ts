// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { Uri } from 'vscode';
import { updateNotebookMetadata } from './helpers';
import { IJupyterKernelSpec, PythonKernelConnectionMetadata } from '../types';
import { IFeaturesManager, KernelPickerType } from '../../platform/common/types';
import { EnvironmentType, PythonEnvironment } from '../../platform/pythonEnvironments/info';

// Function return type
// type updateNotebookMetadataReturn = { changed: boolean; kernelId: string | undefined };
(['Insiders', 'Stable'] as KernelPickerType[]).forEach((kernelPickerType) => {
    suite(`UpdateNotebookMetadata for ${kernelPickerType}`, () => {
        const python36Global: PythonEnvironment = {
            uri: Uri.file('/usr/bin/python36'),
            id: Uri.file('/usr/bin/python36').fsPath,
            sysPrefix: '/usr',
            displayName: 'Python 3.6',
            envType: EnvironmentType.Unknown,
            sysVersion: '3.6.0',
            version: { major: 3, minor: 6, patch: 0, raw: '3.6.0' }
        };
        const pythonDefaultKernelSpec: IJupyterKernelSpec = {
            argv: ['python', '-f', '{connection_file}'],
            display_name: 'Python Default',
            name: 'python3',
            executable: 'python'
        };
        const python37Global: PythonEnvironment = {
            uri: Uri.file('/usr/bin/python36'),
            id: Uri.file('/usr/bin/python36').fsPath,
            sysPrefix: '/usr',
            displayName: 'Python 3.7',
            envType: EnvironmentType.Unknown,
            sysVersion: '3.7.0',
            version: { major: 3, minor: 7, patch: 0, raw: '3.7.0' }
        };
        const featureManager: IFeaturesManager = {
            features: { kernelPickerType }
        } as any;
        test('UpdateNotebookMetadata Empty call does not change anything', async () => {
            const value = await updateNotebookMetadata(featureManager);
            assert.strictEqual(value.changed, false);
        });
        test('UpdateNotebookMetadata Ensure Language', async () => {
            const notebookMetadata = { orig_nbformat: 4 };
            const value = await updateNotebookMetadata(featureManager, notebookMetadata);

            // Verify lang info added
            verifyMetadata(notebookMetadata, { orig_nbformat: 4, language_info: { name: '' } });
            assert.strictEqual(value.changed, false);
        });
        test('UpdateNotebookMetadata Update Language', async () => {
            const notebookMetadata = { orig_nbformat: 4, language_info: { name: 'JUNK' } };
            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: pythonDefaultKernelSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify lang info added
            verifyMetadata(notebookMetadata, {
                orig_nbformat: 4,
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            });
            assert.strictEqual(value.changed, true);
        });

        test('UpdateNotebookMetadata Update Python Version', async () => {
            const notebookMetadata = { orig_nbformat: 4, language_info: { name: 'python', version: '3.6.0' } };
            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python37Global,
                kernelSpec: pythonDefaultKernelSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify version updated 3.6 => 3.7
            verifyMetadata(notebookMetadata, {
                orig_nbformat: 4,
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.7.0' }
            });
            assert.strictEqual(value.changed, true);
        });

        test('UpdateNotebookMetadata New KernelSpec Name / Display Name', async () => {
            const notebookMetadata = {
                orig_nbformat: 4,
                kernelspec: { display_name: 'JUNK DISPLAYNAME', language: 'python', name: 'JUNK' },
                language_info: { name: 'python', version: '3.6.0' }
            };
            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: pythonDefaultKernelSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify kernel_spec name updated JUNK => python3
            verifyMetadata(notebookMetadata, {
                orig_nbformat: 4,
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            });
            assert.strictEqual(value.changed, true);
        });

        test('UpdateNotebookMetadata Interpreter Hash', async function () {
            if (kernelPickerType === 'Insiders') {
                return this.skip();
            }
            // Make sure that name is the same so that interpreter hash is actually checked
            const notebookMetadata = {
                orig_nbformat: 4,
                vscode: { interpreter: { hash: 'junk' } },
                kernelspec: { display_name: 'New Display Name', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            };

            // Make sure we tag as registered by us so that we update the interpreter hash
            const vscSpec = { ...pythonDefaultKernelSpec };
            vscSpec.isRegisteredByVSC = 'registeredByNewVersionOfExt';

            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: vscSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify display_name updated due to interpreter hash change
            verifyMetadata(notebookMetadata, {
                orig_nbformat: 4,
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' },
                vscode: {
                    interpreter: {
                        hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                    }
                }
            });

            assert.strictEqual(value.changed, true);
        });

        test('UpdateNotebookMetadata old Interpreter Hash', async function () {
            if (kernelPickerType === 'Insiders') {
                return this.skip();
            }
            // Make sure that name is the same so that interpreter hash is actually checked
            const notebookMetadata = {
                orig_nbformat: 4,
                interpreter: { hash: 'junk' },
                kernelspec: { display_name: 'New Display Name', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            };

            // Make sure we tag as registered by us so that we update the interpreter hash
            const vscSpec = { ...pythonDefaultKernelSpec };
            vscSpec.isRegisteredByVSC = 'registeredByNewVersionOfExt';

            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: vscSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify display_name updated due to interpreter hash change
            verifyMetadata(notebookMetadata, {
                orig_nbformat: 4,
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' },
                vscode: {
                    interpreter: {
                        hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                    }
                }
            });

            assert.strictEqual(value.changed, true);
        });
        test('UpdateNotebookMetadata No Change', async () => {
            let notebookMetadata: nbformat.INotebookMetadata = {
                orig_nbformat: 4,
                vscode: {
                    interpreter: {
                        hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                    }
                },
                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            };
            if (kernelPickerType === 'Insiders') {
                notebookMetadata = {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' }
                };
            }
            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: pythonDefaultKernelSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify display_name updated due to interpreter hash change
            if (kernelPickerType === 'Stable') {
                verifyMetadata(notebookMetadata, {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' },
                    vscode: {
                        interpreter: {
                            hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                        }
                    }
                });
            } else {
                verifyMetadata(notebookMetadata, {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' }
                });
            }
            // Should be no change here
            assert.strictEqual(value.changed, false);
        });
        test('UpdateNotebookMetadata No Change (old format)', async () => {
            let notebookMetadata: nbformat.INotebookMetadata = {
                orig_nbformat: 4,
                interpreter: {
                    hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                },

                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            };
            let newNotebookMetadata: nbformat.INotebookMetadata = {
                orig_nbformat: 4,
                vscode: {
                    interpreter: {
                        hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                    }
                },

                kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.6.0' }
            };
            if (kernelPickerType === 'Insiders') {
                notebookMetadata = {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' }
                };

                newNotebookMetadata = {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' }
                };
            }
            const kernelConnection = PythonKernelConnectionMetadata.create({
                id: 'python36',
                interpreter: python36Global,
                kernelSpec: pythonDefaultKernelSpec
            });
            const value = await updateNotebookMetadata(featureManager, notebookMetadata, kernelConnection);

            // Verify display_name updated due to interpreter hash change
            if (kernelPickerType === 'Stable') {
                verifyMetadata(newNotebookMetadata, {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' },
                    vscode: {
                        interpreter: {
                            hash: '61422c3ae25c0ee9ecef2ee9be55c6d65757e33588c0a04d2ee7dbadc81a89b7'
                        }
                    }
                });
            } else {
                verifyMetadata(newNotebookMetadata, {
                    orig_nbformat: 4,
                    kernelspec: { display_name: 'Python Default', language: 'python', name: 'python3' },
                    language_info: { name: 'python', version: '3.6.0' }
                });
            }

            // Should be no change here
            assert.strictEqual(value.changed, false);
        });
    });
});

function verifyMetadata(actualMetadata: nbformat.INotebookMetadata, targetMetadata: nbformat.INotebookMetadata) {
    assert.deepEqual(actualMetadata, targetMetadata);
}
