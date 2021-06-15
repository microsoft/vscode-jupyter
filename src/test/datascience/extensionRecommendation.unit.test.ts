// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { nbformat } from '@jupyterlab/coreutils';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import { EventEmitter, Memento, NotebookDocument } from 'vscode';
import { IApplicationShell, ICommandManager, IVSCodeNotebook } from '../../client/common/application/types';
import { disposeAllDisposables } from '../../client/common/helpers';
import { IDisposable, IExtensions } from '../../client/common/types';
import { sleep } from '../../client/common/utils/async';
import { Common } from '../../client/common/utils/localize';
import { ExtensionRecommendationService } from '../../client/datascience/extensionRecommendation';
import { JupyterNotebookView } from '../../client/datascience/notebook/constants';
import { INotebookControllerManager } from '../../client/datascience/notebook/types';
import { VSCodeNotebookController } from '../../client/datascience/notebook/vscodeNotebookController';
import { IJupyterKernelSpec } from '../../client/datascience/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
suite('DataScience Extension Recommendation', () => {
    ['kernelspec', 'language_info'].forEach((whereIsLanguageDefined) => {
        ['csharp', 'fsharp', 'powershell'].forEach((languageToBeTested) => {
            suite(`Notebook language '${languageToBeTested}' defined in ${whereIsLanguageDefined}`, () => {
                const disposables: IDisposable[] = [];
                let recommendation: ExtensionRecommendationService;
                let vscNotebook: IVSCodeNotebook;
                let controllerManager: INotebookControllerManager;
                let memento: Memento;
                let appShell: IApplicationShell;
                let extensions: IExtensions;
                let commandManager: ICommandManager;
                let onDidOpenNotebookDocument: EventEmitter<NotebookDocument>;
                let onNotebookControllerSelected: EventEmitter<{
                    notebook: NotebookDocument;
                    controller: VSCodeNotebookController;
                }>;
                setup(() => {
                    startNewSession();
                });
                function startNewSession() {
                    onDidOpenNotebookDocument = new EventEmitter<NotebookDocument>();
                    onNotebookControllerSelected = new EventEmitter<{
                        notebook: NotebookDocument;
                        controller: VSCodeNotebookController;
                    }>();
                    vscNotebook = mock<IVSCodeNotebook>();
                    when(vscNotebook.onDidOpenNotebookDocument).thenReturn(onDidOpenNotebookDocument.event);
                    controllerManager = mock<INotebookControllerManager>();
                    when(controllerManager.onNotebookControllerSelected).thenReturn(onNotebookControllerSelected.event);
                    memento = mock<Memento>();
                    appShell = mock<IApplicationShell>();
                    extensions = mock<IExtensions>();
                    commandManager = mock<ICommandManager>();
                    recommendation = new ExtensionRecommendationService(
                        instance(vscNotebook),
                        instance(controllerManager),
                        disposables,
                        instance(memento),
                        instance(appShell),
                        instance(extensions),
                        instance(commandManager)
                    );

                    when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenReturn();
                    when(extensions.getExtension(anything())).thenReturn();
                    when(memento.get(anything(), anything())).thenReturn([]);
                    recommendation.activate();
                }
                teardown(() => disposeAllDisposables(disposables));
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
                    when(controller.connection).thenReturn({ kind: 'startUsingKernelSpec', kernelSpec, id: '' });
                    return instance(controller);
                }
                test('No recommendations for python Notebooks', async () => {
                    const nb = createNotebook('python');
                    onDidOpenNotebookDocument.fire(nb);
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
                });
                test('No recommendations for python kernels', async () => {
                    const notebook = createNotebook('');
                    const controller = createController('python');
                    onNotebookControllerSelected.fire({ notebook, controller });
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
                });
                test('No recommendations for julia Notebooks', async () => {
                    const nb = createNotebook('julia');
                    onDidOpenNotebookDocument.fire(nb);
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
                });
                test('No recommendations for julia kernels', async () => {
                    const notebook = createNotebook('');
                    const controller = createController('julia');
                    onNotebookControllerSelected.fire({ notebook, controller });
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
                });
                test(`Got recommendations once per session when opening a notebook`, async () => {
                    const nb = createNotebook(languageToBeTested);
                    const nb2 = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    onDidOpenNotebookDocument.fire(nb);
                    onDidOpenNotebookDocument.fire(nb2);
                    onDidOpenNotebookDocument.fire(nb2);

                    // Only one prompt regardless of how many notebooks were opened.
                    const expectedMessage = `The [.NET Interactive Notebooks Preview](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.dotnet-interactive-vscode) extension is recommended for notebooks targetting the language '${languageToBeTested}'`;
                    verify(
                        appShell.showInformationMessage(
                            expectedMessage,
                            Common.bannerLabelYes(),
                            Common.bannerLabelNo(),
                            Common.doNotShowAgain()
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
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
                });
                test(`Never show prompt again when opening a notebook in a new session`, async () => {
                    when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                        Common.doNotShowAgain() as any
                    );

                    const nb = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();

                    // New session
                    startNewSession();
                    when(memento.get(anything(), anything())).thenReturn(['ms-dotnettools.dotnet-interactive-vscode']);
                    const nb2 = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb2);
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).never();
                });
                test(`Open extension page to install the recommended extension`, async () => {
                    when(appShell.showInformationMessage(anything(), anything(), anything(), anything())).thenResolve(
                        Common.bannerLabelYes() as any
                    );
                    when(commandManager.executeCommand(anything(), anything())).thenResolve();

                    const nb = createNotebook(languageToBeTested);
                    onDidOpenNotebookDocument.fire(nb);
                    await sleep(0); // wait for even loop to process pending async calls.
                    verify(appShell.showInformationMessage(anything(), anything(), anything(), anything())).once();
                    verify(
                        commandManager.executeCommand('extension.open', 'ms-dotnettools.dotnet-interactive-vscode')
                    ).once();
                });
            });
        });
    });
});
