// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, NotebookDocument } from 'vscode';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable } from '../../platform/common/types';
import { sleep } from '../../platform/common/utils/async';
import { Common } from '../../platform/common/utils/localize';
import { VSCodeNotebookController } from '../../notebooks/controllers/vscodeNotebookController';
import { IJupyterKernelSpec, LocalKernelSpecConnectionMetadata } from '../../kernels/types';
import { ExtensionRecommendationService } from './extensionRecommendation.node';
import { JupyterNotebookView } from '../../platform/common/constants';
import { IControllerRegistration } from '../../notebooks/controllers/types';
import { mockedVSCodeNamespaces, resetVSCodeMocks } from '../../test/vscode-mock';

/* eslint-disable @typescript-eslint/no-explicit-any */
suite('Extension Recommendation', () => {
    ['kernelspec', 'language_info'].forEach((whereIsLanguageDefined) => {
        ['csharp', 'fsharp', 'powershell'].forEach((languageToBeTested) => {
            suite(`Notebook language '${languageToBeTested}' defined in ${whereIsLanguageDefined}`, () => {
                let disposables: IDisposable[] = [];
                let recommendation: ExtensionRecommendationService;
                let memento: Memento;
                let controllerRegistration: IControllerRegistration;
                let onDidOpenNotebookDocument: EventEmitter<NotebookDocument>;
                let onNotebookControllerSelected: EventEmitter<{
                    notebook: NotebookDocument;
                    controller: VSCodeNotebookController;
                }>;
                setup(() => {
                    startNewSession();
                });
                function startNewSession() {
                    resetVSCodeMocks();
                    onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
                    onNotebookControllerSelected = new EventEmitter<{
                        notebook: NotebookDocument;
                        controller: VSCodeNotebookController;
                    }>();
                    when(mockedVSCodeNamespaces.workspace.onDidOpenNotebookDocument).thenReturn(
                        onDidOpenNotebookDocument.event
                    );
                    controllerRegistration = mock<IControllerRegistration>();
                    when(controllerRegistration.onControllerSelected).thenReturn(onNotebookControllerSelected.event);
                    memento = mock<Memento>();
                    recommendation = new ExtensionRecommendationService(
                        instance(controllerRegistration),
                        disposables,
                        instance(memento)
                    );

                    when(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).thenReturn();
                    when(mockedVSCodeNamespaces.extensions.getExtension(anything())).thenReturn();
                    when(memento.get(anything(), anything())).thenReturn([]);
                    recommendation.activate();
                }
                teardown(() => {
                    disposables = dispose(disposables);
                    resetVSCodeMocks();
                });
                function createNotebook(language: string) {
                    const notebook = mock<NotebookDocument>();
                    const kernelSpecLanguage = whereIsLanguageDefined === 'kernelspec' ? language : undefined;
                    const languageInfoLanguage = whereIsLanguageDefined === 'kernelspec' ? '' : language;
                    const notebookContent: Partial<nbformat.INotebookContent> = {
                        metadata: {
                            orig_nbformat: 1,
                            kernelspec: {
                                display_name: 'Hello',
                                name: 'hello',
                                language: kernelSpecLanguage
                            },
                            language_info: {
                                name: languageInfoLanguage
                            }
                        }
                    };
                    when(notebook.notebookType).thenReturn(JupyterNotebookView);
                    when(notebook.metadata).thenReturn({ custom: notebookContent } as any);
                    return instance(notebook);
                }
                function createController(language: string) {
                    const controller = mock<VSCodeNotebookController>();
                    const kernelSpec: IJupyterKernelSpec = {
                        language
                    } as any;
                    when(controller.connection).thenReturn(
                        LocalKernelSpecConnectionMetadata.create({ kernelSpec, id: '' })
                    );
                    return instance(controller);
                }
                test('No recommendations for python Notebooks', async () => {
                    const nb = createNotebook('python');
                    onDidOpenNotebookDocument.fire(nb);
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).never();
                });
                test('No recommendations for python kernels', async () => {
                    const notebook = createNotebook('');
                    const controller = createController('python');
                    onNotebookControllerSelected.fire({ notebook, controller });
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).never();
                });
                test('No recommendations for julia Notebooks', async () => {
                    const nb = createNotebook('julia');
                    onDidOpenNotebookDocument.fire(nb);
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).never();
                });
                test('No recommendations for julia kernels', async () => {
                    const notebook = createNotebook('');
                    const controller = createController('julia');
                    onNotebookControllerSelected.fire({ notebook, controller });
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).never();
                });
                test(`Got recommendations once per session when opening a notebook`, async () => {
                    const nb = createNotebook(languageToBeTested);
                    const nb2 = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    onDidOpenNotebookDocument.fire(nb);
                    onDidOpenNotebookDocument.fire(nb2);
                    onDidOpenNotebookDocument.fire(nb2);

                    // Only one prompt regardless of how many notebooks were opened.
                    const expectedMessage = `The [.NET Interactive Notebooks Preview](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.dotnet-interactive-vscode) extension is recommended for notebooks targeting the language '${languageToBeTested}'`;
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            expectedMessage,
                            Common.bannerLabelYes,
                            Common.bannerLabelNo,
                            Common.doNotShowAgain
                        )
                    ).once();
                });
                test(`Got recommendations once per session when selecting a kernel`, async () => {
                    const notebook = createNotebook('python');
                    const notebook2 = createNotebook('python');
                    const controller = createController(languageToBeTested);
                    const controller2 = createController(languageToBeTested);
                    onNotebookControllerSelected.fire({ notebook, controller });
                    onNotebookControllerSelected.fire({ notebook: notebook2, controller: controller2 });
                    // Only one prompt regardless of how many notebooks were opened.
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).once();
                });
                test(`Never show prompt again when opening a notebook in a new session`, async () => {
                    when(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).thenResolve(Common.doNotShowAgain as any);

                    const nb = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).once();

                    // New session
                    startNewSession();
                    when(memento.get(anything(), anything())).thenReturn(['ms-dotnettools.dotnet-interactive-vscode']);
                    const nb2 = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb2);
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).never();
                });
                test(`Open extension page to install the recommended extension`, async () => {
                    when(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).thenResolve(Common.bannerLabelYes as any);
                    when(mockedVSCodeNamespaces.commands.executeCommand(anything(), anything())).thenResolve();

                    const nb = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    await sleep(0); // wait for even loop to process pending async calls.
                    verify(
                        mockedVSCodeNamespaces.window.showInformationMessage(
                            anything(),
                            anything(),
                            anything(),
                            anything()
                        )
                    ).once();
                    verify(
                        mockedVSCodeNamespaces.commands.executeCommand(
                            'extension.open',
                            'ms-dotnettools.dotnet-interactive-vscode'
                        )
                    ).once();
                });
            });
        });
    });
});
