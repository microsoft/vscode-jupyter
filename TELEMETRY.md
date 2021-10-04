# Telemetry created by Jupyter Extension

Expand each section to see more information about that event.

<details>
  <summary>DATASCIENCE.ADD_CELL_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/commandRegistry.ts:{"line":369,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.AddCellBelow)
    private async addCellBelow(): Promise<void> {
        await this.getCurrentCodeWatcher()?.addEmptyCellToBottom();
    }
```

</details>
<details>
  <summary>DATASCIENCE.CLICKED_EXPORT_NOTEBOOK_AS_QUICK_PICK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/exportCommands.ts:{"line":119,"character":45}
```typescript
            if (pickedItem !== undefined) {
                pickedItem.handler();
            } else {
                sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick);
            }
        }
    }
```

src/client/datascience/commands/exportCommands.ts:{"line":138,"character":49}
```typescript
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    void this.commandManager.executeCommand(
```

src/client/datascience/commands/exportCommands.ts:{"line":157,"character":53}
```typescript
                    label: DataScience.exportHTMLQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.html
                        });
                        void this.commandManager.executeCommand(
```

src/client/datascience/commands/exportCommands.ts:{"line":173,"character":53}
```typescript
                    label: DataScience.exportPDFQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.pdf
                        });
                        void this.commandManager.executeCommand(
```

</details>
<details>
  <summary>DATASCIENCE.COLLAPSE_ALL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.COPY_SOURCE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.CREATE_NEW_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-window/interactiveWindowCommandListener.ts:{"line":413,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.CreateNewInteractive, undefined, false)
    private async createNewInteractiveWindow(): Promise<void> {
        await this.interactiveWindowProvider.getOrCreate(undefined);
    }
```

</details>
<details>
  <summary>DATASCIENCE.DATA_VIEWER_DATA_DIMENSIONALITY</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewer.ts:{"line":296,"character":41}
```typescript

    private maybeSendSliceDataDimensionalityTelemetry(numberOfDimensions: number) {
        if (!this.sentDataViewerSliceDimensionalityTelemetry) {
            sendTelemetryEvent(Telemetry.DataViewerDataDimensionality, undefined, { numberOfDimensions });
            this.sentDataViewerSliceDimensionalityTelemetry = true;
        }
    }
```

</details>
<details>
  <summary>DATASCIENCE.DATA_VIEWER_SLICE_ENABLEMENT_STATE_CHANGED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewer.ts:{"line":181,"character":50}
```typescript
                break;

            case DataViewerMessages.SliceEnablementStateChanged:
                void sendTelemetryEvent(Telemetry.DataViewerSliceEnablementStateChanged, undefined, {
                    newState: payload.newState ? CheckboxState.Checked : CheckboxState.Unchecked
                });
                break;
```

</details>
<details>
  <summary>DATASCIENCE.DATA_VIEWER_SLICE_OPERATION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewer.ts:{"line":242,"character":45}
```typescript
                if (payload.shape?.length) {
                    this.maybeSendSliceDataDimensionalityTelemetry(payload.shape.length);
                }
                sendTelemetryEvent(Telemetry.DataViewerSliceOperation, undefined, { source: request.source });
                return this.postMessage(DataViewerMessages.InitializeData, payload);
            }
        });
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_CONTINUE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/commandRegistry.ts:{"line":361,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugContinue)
    private async debugContinue(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_CURRENT_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":119,"character":32}
```typescript
        return this.codeLenses;
    }

    @captureTelemetry(Telemetry.DebugCurrentCell)
    public async debugCurrentCell() {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

src/client/datascience/editor-integration/codewatcher.ts:{"line":315,"character":32}
```typescript
        return this.runMatchingCell(range, advance);
    }

    @captureTelemetry(Telemetry.DebugCurrentCell)
    public async debugCell(range: Range): Promise<void> {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_FILE_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":184,"character":32}
```typescript
        return this.runFileInteractiveInternal(false);
    }

    @captureTelemetry(Telemetry.DebugFileInteractive)
    public async debugFileInteractive() {
        return this.runFileInteractiveInternal(true);
    }
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_STEP_OVER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/commandRegistry.ts:{"line":345,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugStepOver)
    private async debugStepOver(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_STOP</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/commandRegistry.ts:{"line":353,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugStop)
    private async debugStop(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debuggingManager.ts:{"line":462,"character":50}
```typescript
        );

        if (response === DataScience.setup()) {
            sendTelemetryEvent(DebuggingTelemetry.clickedOnSetup);
            this.appShell.openUrl(
                'https://github.com/microsoft/vscode-jupyter/wiki/Setting-Up-Run-by-Line-and-Debugging-for-Notebooks'
            );
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLICKED_RUN_AND_DEBUG_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debuggingManager.ts:{"line":163,"character":54}
```typescript
            }),

            this.commandManager.registerCommand(DSCommands.RunAndDebugCell, async (cell: NotebookCell | undefined) => {
                sendTelemetryEvent(DebuggingTelemetry.clickedRunAndDebugCell);
                const editor = this.vscNotebook.activeNotebookEditor;
                if (!cell) {
                    const range = editor?.selections[0];
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLICKED_RUNBYLINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debuggingManager.ts:{"line":110,"character":54}
```typescript
            }),

            this.commandManager.registerCommand(DSCommands.RunByLine, async (cell: NotebookCell | undefined) => {
                sendTelemetryEvent(DebuggingTelemetry.clickedRunByLine);
                const editor = this.vscNotebook.activeNotebookEditor;
                if (!cell) {
                    const range = editor?.selections[0];
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLOSED_MODAL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debuggingManager.ts:{"line":467,"character":50}
```typescript
                'https://github.com/microsoft/vscode-jupyter/wiki/Setting-Up-Run-by-Line-and-Debugging-for-Notebooks'
            );
        } else {
            sendTelemetryEvent(DebuggingTelemetry.closedModal);
        }
    }
}
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.ENDED_SESSION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/kernelDebugAdapter.ts:{"line":88,"character":58}
```typescript
        if (this.kernel) {
            this.disposables.push(
                this.kernel.onWillRestart(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onARestart' });
                    this.disconnect();
                })
            );
```

src/client/debugger/jupyter/kernelDebugAdapter.ts:{"line":94,"character":58}
```typescript
            );
            this.disposables.push(
                this.kernel.onWillInterrupt(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onAnInterrupt' });
                    this.disconnect();
                })
            );
```

src/client/debugger/jupyter/kernelDebugAdapter.ts:{"line":102,"character":58}
```typescript
                this.kernel.onDisposed(() => {
                    void debug.stopDebugging(this.session);
                    this.endSession.fire(this.session);
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onKernelDisposed' });
                })
            );
        }
```

src/client/debugger/jupyter/kernelDebugAdapter.ts:{"line":116,"character":62}
```typescript
                        cellStateChange.state === NotebookCellExecutionState.Idle &&
                        !this.disconected
                    ) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'normally' });
                        this.disconnect();
                    }
                },
```

src/client/debugger/jupyter/debuggingManager.ts:{"line":154,"character":62}
```typescript
                if (editor) {
                    const controller = this.notebookToRunByLineController.get(editor.document);
                    if (controller) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, {
                            reason: 'withKeybinding'
                        });
                        controller.stop();
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.IPYKERNEL6_STATUS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debuggingManager.ts:{"line":441,"character":54}
```typescript

            if (kernel) {
                const result = await isUsingIpykernel6OrLater(kernel);
                sendTelemetryEvent(DebuggingTelemetry.ipykernel6Status, undefined, {
                    status: result === IpykernelCheckResult.Ok ? 'installed' : 'notInstalled'
                });
                return result;
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debugControllers.ts:{"line":24,"character":46}
```typescript
        private readonly kernel: IKernel,
        private readonly commandManager: ICommandManager
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    public async willSendEvent(_msg: DebugProtocolMessage): Promise<boolean> {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUNBYLINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/debugger/jupyter/debugControllers.ts:{"line":53,"character":46}
```typescript
        private readonly kernel: IKernel,
        private readonly settings: IConfigurationService
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunByLine);
    }

    public continue(): void {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_INSTALL_CANCELLED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_INSTALL_FAILED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_PROMPT_TO_INSTALL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_SUCCESSFULLY_INSTALLED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DELETE_ALL_CELLS</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DELETE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/shiftEnterBanner.ts:{"line":102,"character":32}
```typescript
        );
    }

    @captureTelemetry(Telemetry.DisableInteractiveShiftEnter)
    public async disableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```

src/test/datascience/shiftEnterBanner.unit.test.ts:{"line":114,"character":22}
```typescript

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.DisableInteractiveShiftEnter
        ]);
    });
});
```

</details>
<details>
  <summary>DATASCIENCE.ENABLE_INTERACTIVE_SHIFT_ENTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/shiftEnterBanner.ts:{"line":113,"character":32}
```typescript
        await this.disableBanner();
    }

    @captureTelemetry(Telemetry.EnableInteractiveShiftEnter)
    public async enableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```

src/test/datascience/shiftEnterBanner.unit.test.ts:{"line":69,"character":22}
```typescript

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });

```

</details>
<details>
  <summary>DATASCIENCE.EXECUTE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/telemetry/telemetry.ts:{"line":78,"character":32}
```typescript
    properties?: P[E] & { waitBeforeSending?: Promise<void> },
    ex?: Error
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }

```

src/client/datascience/telemetry/telemetry.ts:{"line":115,"character":32}
```typescript
    stopWatch?: StopWatch,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> }
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

src/client/datascience/notebook/vscodeNotebookController.ts:{"line":169,"character":57}
```typescript
            return;
        }
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, this.connection);
        sendKernelTelemetryEvent(notebook.uri, Telemetry.ExecuteCell);
        // Notebook is trusted. Continue to execute cells
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(notebook, cell)));
```

src/client/datascience/jupyter/kernels/kernel.ts:{"line":155,"character":61}
```typescript
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const notebookPromise = this.startNotebook();
        if (cell.notebook.notebookType === InteractiveWindowView) {
```

</details>
<details>
  <summary>DATASCIENCE.EXECUTE_CELL_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterNotebook.ts:{"line":361,"character":49}
```typescript
                },
                () => {
                    subscriber.complete();
                    sendTelemetryEvent(Telemetry.ExecuteCellTime, stopWatch.elapsedTime);
                }
            );
        });
```

</details>
<details>
  <summary>DATASCIENCE.EXPAND_ALL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK_AS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/export/exportFileOpener.ts:{"line":24,"character":41}
```typescript
    public async openFile(format: ExportFormat, uri: Uri) {
        if (format === ExportFormat.python) {
            await this.openPythonFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: true
```

src/client/datascience/export/exportFileOpener.ts:{"line":31,"character":41}
```typescript
            });
        } else {
            const opened = await this.askOpenFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: opened
```

src/client/datascience/export/exportManager.ts:{"line":80,"character":41}
```typescript
        }

        if (reporter.token.isCancellationRequested) {
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, { format: format, cancelled: true });
            return;
        }
        await this.exportFileOpener.openFile(format, target);
```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK_AS_COMMAND</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/commands/exportCommands.ts:{"line":104,"character":45}
```typescript
            }

            if (exportMethod) {
                sendTelemetryEvent(Telemetry.ExportNotebookAsCommand, undefined, { format: exportMethod });
            }
        }

```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK_AS_FAILED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/export/exportManager.ts:{"line":52,"character":41}
```typescript
            await this.performExport(format, contents, target, exportInterpreter);
        } catch (e) {
            traceError('Export failed', e);
            sendTelemetryEvent(Telemetry.ExportNotebookAsFailed, undefined, { format: format });

            if (format === ExportFormat.pdf) {
                traceError(localize.DataScience.exportToPDFDependencyMessage());
```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_PYTHON_FILE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-window/interactiveWindowCommandListener.ts:{"line":214,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.ExportPythonFileInteractive, undefined, false)
    private async exportFile(file: Uri): Promise<void> {
        if (file && file.fsPath && file.fsPath.length > 0) {
            // If the current file is the active editor, then generate cells from the document.
```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-window/interactiveWindowCommandListener.ts:{"line":262,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.ExportPythonFileAndOutputInteractive, undefined, false)
    private async exportFileAndOutput(file: Uri): Promise<Uri | undefined> {
        if (file && file.fsPath && file.fsPath.length > 0 && (await this.jupyterExecution.isNotebookSupported())) {
            // If the current file is the active editor, then generate cells from the document.
```

</details>
<details>
  <summary>DATASCIENCE.FAILED_SHOW_DATA_EXPLORER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/variablesView/variableView.ts:{"line":175,"character":41}
```typescript
            }
        } catch (e) {
            traceError(e);
            sendTelemetryEvent(Telemetry.FailedShowDataViewer);
            void this.appShell.showErrorMessage(localize.DataScience.showDataViewerFail());
        }
    }
```

</details>
<details>
  <summary>DATASCIENCE.FAILED_TO_CREATE_CONTROLLER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/notebookControllerManager.ts:{"line":471,"character":26}
```typescript
        } catch (ex) {
            // We know that this fails when we have xeus kernels installed (untill that's resolved thats one instance when we can have duplicates).
            sendTelemetryEvent(
                Telemetry.FailedToCreateNotebookController,
                undefined,
                { kind: kernelConnection.kind },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

</details>
<details>
  <summary>DATASCIENCE.FAILED_TO_FIND_INTERPRETER_KERNEL_CONNECTION_FOR_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/helpers.ts:{"line":417,"character":37}
```typescript
            return kernelMatchingPreferredInterpreter;
        }
        // Telemetry to see if this happens in the real world, this should not be possible.
        sendTelemetryEvent(Telemetry.FailedToFindKernelSpecInterpreterForInteractive);
    }

    // If still not found, look for a match based on notebook metadata and interpreter
```

</details>
<details>
  <summary>DATASCIENCE.GET_PASSWORD_ATTEMPT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterPasswordConnect.ts:{"line":29,"character":32}
```typescript
        @inject(IConfigurationService) private readonly configService: IConfigurationService
    ) {}

    @captureTelemetry(Telemetry.GetPasswordAttempt)
    public getPasswordConnectionInfo(
        url: string,
        fetchFunction?: (url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit) => Promise<nodeFetch.Response>
```

</details>
<details>
  <summary>DATASCIENCE.GOTO_NEXT_CELL_IN_FILE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":675,"character":32}
```typescript
        });
    }

    @captureTelemetry(Telemetry.GotoNextCellInFile)
    public gotoNextCell() {
        const editor = this.documentManager.activeTextEditor;
        if (!editor || !editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.GOTO_PREV_CELL_IN_FILE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":692,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.GotoPrevCellInFile)
    public gotoPreviousCell() {
        const editor = this.documentManager.activeTextEditor;
        if (!editor || !editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.GOTO_SOURCE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.IMPORT_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-window/interactiveWindowCommandListener.ts:{"line":428,"character":32}
```typescript
        return this.statusProvider.waitWithStatus(promise, message, undefined, canceled);
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'command' }, false)
    private async importNotebook(): Promise<void> {
        const filtersKey = localize.DataScience.importDialogFilter();
        const filtersObject: { [name: string]: string[] } = {};
```

src/client/datascience/interactive-window/interactiveWindowCommandListener.ts:{"line":452,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'file' }, false)
    private async importNotebookOnFile(file: Uri): Promise<void> {
        if (file.fsPath && file.fsPath.length > 0) {
            await this.waitForStatus(
```

</details>
<details>
  <summary>DATASCIENCE.INTERRUPT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":168,"character":32}
```typescript
        this.documentExecutions.set(document, newCellExecutionQueue);
        return newCellExecutionQueue;
    }
    @captureTelemetry(Telemetry.Interrupt)
    @captureTelemetry(Telemetry.InterruptJupyterTime)
    private async interruptExecution(
        session: IJupyterSession,
```

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_COMMAND_SEARCH</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":143,"character":37}
```typescript
            action: 'displayed',
            moduleName: ProductNames.get(Product.jupyter)!
        });
        sendTelemetryEvent(Telemetry.JupyterNotInstalledErrorShown);
        const selection = await this.applicationShell.showErrorMessage(
            message,
            { modal: true },
```

</details>
<details>
  <summary>DATASCIENCE.KERNEL_SPEC_NOT_FOUND_ERROR</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/liveshare/hostRawNotebookProvider.ts:{"line":133,"character":45}
```typescript
                !kernelConnectionMetadata ||
                (kernelConnectionMetadata?.kind === 'startUsingKernelSpec' && !kernelConnectionMetadata?.kernelSpec)
            ) {
                sendTelemetryEvent(Telemetry.KernelSpecNotFoundError, undefined, {
                    resourceType: getResourceType(resource),
                    language: getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata)),
                    kernelConnectionProvided: !!kernelConnection,
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.CONVERT_NOTEBOOK_TO_PYTHON</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.CREATE_NEW_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/notebookEditorProvider.ts:{"line":129,"character":32}
```typescript
        // We do not need this.
        return;
    }
    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(options?: { contents?: string; defaultCellLanguage: string }): Promise<INotebookEditor> {
        // contents will be ignored
        const language = options?.defaultCellLanguage ?? PYTHON_LANGUAGE;
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.ARROW_DOWN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.ARROW_UP</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.DELETE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.INSERT_ABOVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.INSERT_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.REDO</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_ADD</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_MOVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.SAVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_LINE_NUMBERS</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_OUTPUT</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.UNDO</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.UNFOCUS</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.ADD_TO_END</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.DELETE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.INSERT_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_DOWN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_UP</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_ABOVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_ALL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SAVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SELECT_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SELECT_SERVER</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.TOGGLE_VARIABLE_EXPLORER</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-ipynb/nativeEditorCommandListener.ts:{"line":84,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.OpenNotebook, { scope: 'command' }, false)
    private async openNotebook(file?: Uri, contents?: string): Promise<void> {
        if (file && path.extname(file.fsPath).toLocaleLowerCase() === '.ipynb') {
            try {
```

src/client/datascience/notebook/notebookEditorProvider.ts:{"line":90,"character":47}
```typescript
        this.disposables.push(
            this.commandManager.registerCommand(Commands.OpenNotebookInPreviewEditor, async (uri?: Uri) => {
                if (uri) {
                    captureTelemetry(Telemetry.OpenNotebook, { scope: 'command' }, false);
                    this.open(uri).ignoreErrors();
                }
            })
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/activation.ts:{"line":51,"character":37}
```typescript
        }
        this.notebookOpened = true;
        this.PreWarmDaemonPool().ignoreErrors();
        sendTelemetryEvent(Telemetry.OpenNotebookAll);

        if (!this.rawSupported.isSupported && this.extensionChecker.isPythonExtensionInstalled) {
            // Warm up our selected interpreter for the extension
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK_SELECTION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/creation/notebookCreator.ts:{"line":52,"character":37}
```typescript
            matchOnDetail: true,
            placeHolder
        });
        sendTelemetryEvent(Telemetry.OpenNotebookSelection, undefined, { extensionId: item?.extensionId });
        if (item) {
            await this.editorProvider.createNew({ defaultCellLanguage: item.defaultCellLanguage });
        }
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK_SELECTION_REGISTERED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/creation/creationOptionsService.ts:{"line":20,"character":49}
```typescript
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ext.packageJSON.contributes['jupyter.kernels'].forEach((kernel: any) => {
                    sendTelemetryEvent(Telemetry.OpenNotebookSelectionRegistered, undefined, { extensionId: ext.id });
                    this._registrations.push({
                        extensionId: ext.id,
                        displayName: kernel['title'],
```

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_INTERRUPT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/telemetry/telemetry.ts:{"line":362,"character":32}
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
```

src/client/datascience/telemetry/telemetry.ts:{"line":363,"character":58}
```typescript
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
```

src/client/datascience/telemetry/telemetry.ts:{"line":364,"character":52}
```typescript
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
            clearInterruptCounter(resource);
```

src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":224,"character":30}
```typescript
                // Otherwise a real error occurred.
                sendKernelTelemetryEvent(
                    this.kernel.resourceUri,
                    Telemetry.NotebookInterrupt,
                    stopWatch.elapsedTime,
                    undefined,
                    exc
```

src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":236,"character":72}
```typescript
        })();

        return promise.then((result) => {
            sendKernelTelemetryEvent(this.kernel.resourceUri, Telemetry.NotebookInterrupt, stopWatch.elapsedTime, {
                result
            });
            return result;
```

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_LANGUAGE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/common.ts:{"line":167,"character":65}
```typescript
}

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language?: string
) {
    language = getTelemetrySafeLanguage(language);
```

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_RESTART</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/telemetry/telemetry.ts:{"line":371,"character":32}
```typescript
        }
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
```

src/client/datascience/telemetry/telemetry.ts:{"line":372,"character":58}
```typescript
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
```

src/client/datascience/telemetry/telemetry.ts:{"line":373,"character":52}
```typescript
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
        if (!failed) {
```

src/client/datascience/jupyter/kernels/kernelCommandListener.ts:{"line":182,"character":67}
```typescript
        const stopWatch = new StopWatch();
        try {
            await kernel.restart();
            sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
```

src/client/datascience/jupyter/kernels/kernelCommandListener.ts:{"line":188,"character":26}
```typescript
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(
                kernel.resourceUri,
                Telemetry.NotebookRestart,
                stopWatch.elapsedTime,
                undefined,
                exc
```

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_START</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/telemetry/telemetry.ts:{"line":404,"character":32}
```typescript
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
```

src/client/datascience/telemetry/telemetry.ts:{"line":405,"character":58}
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
```

src/client/datascience/telemetry/telemetry.ts:{"line":406,"character":52}
```typescript
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
            trackKernelResourceInformation(resource, { startFailed: true });
```

src/client/datascience/jupyter/kernels/kernel.ts:{"line":301,"character":34}
```typescript
                } catch (ex) {
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        ex
```

src/client/datascience/interactive-common/notebookProvider.ts:{"line":141,"character":56}
```typescript
              )
            : this.jupyterNotebookProvider.createNotebook(options);

        sendKernelTelemetryWhenDone(resource, Telemetry.NotebookStart, promise, undefined, {
            disableUI: options.disableUI
        });

```

</details>
<details>
  <summary>DATASCIENCE.OPEN_PLOT_VIEWER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/plotting/plotViewerProvider.ts:{"line":45,"character":41}
```typescript
            this.currentViewer = this.serviceContainer.get<IPlotViewer>(IPlotViewer);
            this.currentViewerClosed = this.currentViewer.closed(this.closedViewer);
            this.currentViewer.removed(this.removedPlot);
            sendTelemetryEvent(Telemetry.OpenPlotViewer);
            await this.currentViewer.show();
        }

```

</details>
<details>
  <summary>DATASCIENCE.OPENED_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.RECOMMENT_EXTENSION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/extensionRecommendation.ts:{"line":116,"character":37}
```typescript
            `[${extensionInfo.displayName}](${extensionInfo.extensionLink})`,
            language
        );
        sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'displayed' });
        const selection = await this.appShell.showInformationMessage(
            message,
            Common.bannerLabelYes(),
```

src/client/datascience/extensionRecommendation.ts:{"line":125,"character":45}
```typescript
        );
        switch (selection) {
            case Common.bannerLabelYes(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'ok' });
                this.commandManager.executeCommand('extension.open', extensionId).then(noop, noop);
                break;
            }
```

src/client/datascience/extensionRecommendation.ts:{"line":130,"character":45}
```typescript
                break;
            }
            case Common.bannerLabelNo(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'cancel' });
                break;
            }
            case Common.doNotShowAgain(): {
```

src/client/datascience/extensionRecommendation.ts:{"line":134,"character":45}
```typescript
                break;
            }
            case Common.doNotShowAgain(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'doNotShowAgain' });
                const list = this.globalMemento.get<string[]>(mementoKeyToNeverPromptExtensionAgain, []);
                if (!list.includes(extensionId)) {
                    list.push(extensionId);
```

src/client/datascience/extensionRecommendation.ts:{"line":143,"character":45}
```typescript
                break;
            }
            default:
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'dismissed' });
        }
    }
}
```

</details>
<details>
  <summary>DATASCIENCE.REDO</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.REFRESH_DATA_VIEWER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewer.ts:{"line":177,"character":50}
```typescript

            case DataViewerMessages.RefreshDataViewer:
                this.refreshData().ignoreErrors();
                void sendTelemetryEvent(Telemetry.RefreshDataViewer);
                break;

            case DataViewerMessages.SliceEnablementStateChanged:
```

</details>
<details>
  <summary>DATASCIENCE.RESTART_KERNEL_COMMAND</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernelCommandListener.ts:{"line":135,"character":37}
```typescript
            return;
        }

        sendTelemetryEvent(Telemetry.RestartKernelCommand);
        const kernel = this.kernelProvider.get(document);

        if (kernel) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_ADD_EMPTY_CELL_TO_BOTTOM</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.RUN_ALL_CELLS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":133,"character":32}
```typescript
        this.closeDocumentDisposable?.dispose(); // NOSONAR
        this.updateRequiredDisposable?.dispose(); // NOSONAR
    }
    @captureTelemetry(Telemetry.RunAllCells)
    public async runAllCells() {
        const runCellCommands = this.codeLenses.filter(
            (c) =>
```

</details>
<details>
  <summary>DATASCIENCE.RUN_ALL_CELLS_ABOVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":190,"character":32}
```typescript
    }

    // Run all cells up to the cell containing this start line and character
    @captureTelemetry(Telemetry.RunAllCellsAbove)
    public async runAllCellsAbove(stopLine: number, stopCharacter: number) {
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
        let leftCount = runCellCommands.findIndex(
```

</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_STEP</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_STOP</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_VARIABLE_HOVER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/debuggerVariables.ts:{"line":127,"character":45}
```typescript
            // Note, full variable results isn't necessary for this call. It only really needs the variable value.
            const result = this.lastKnownVariables.find((v) => v.name === name);
            if (result && notebook && notebook.identity.fsPath.endsWith('.ipynb')) {
                sendTelemetryEvent(Telemetry.RunByLineVariableHover);
            }
            return result;
        }
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":302,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunCell)
    public async runCell(range: Range): Promise<void> {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CELL_AND_ALL_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":228,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunCellAndAllBelow)
    public async runCellAndAllBelow(startLine: number, startCharacter: number) {
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
        const index = runCellCommands.findIndex(
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CHANGE_CELL_TO_CODE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":668,"character":32}
```typescript
        });
    }

    @captureTelemetry(Telemetry.ChangeCellToCode)
    public changeCellToCode() {
        this.applyToCells((editor, cell, _) => {
            return this.changeCellTo(editor, cell, 'code');
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CHANGE_CELL_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":661,"character":32}
```typescript
        await this.moveCellsDirection(false);
    }

    @captureTelemetry(Telemetry.ChangeCellToMarkdown)
    public changeCellToMarkdown() {
        this.applyToCells((editor, cell, _) => {
            return this.changeCellTo(editor, cell, 'markdown');
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CURRENT_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":325,"character":32}
```typescript
        return this.runMatchingCell(range, false, true);
    }

    @captureTelemetry(Telemetry.RunCurrentCell)
    public async runCurrentCell(): Promise<void> {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CURRENT_CELL_AND_ADD_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":353,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunCurrentCellAndAddBelow)
    public async runCurrentCellAndAddBelow(): Promise<void> {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CURRENT_CELL_AND_ADVANCE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":335,"character":32}
```typescript
        return this.runMatchingCell(this.documentManager.activeTextEditor.selection, false);
    }

    @captureTelemetry(Telemetry.RunCurrentCellAndAdvance)
    public async runCurrentCellAndAdvance() {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```

</details>
<details>
  <summary>DATASCIENCE.RUN_DELETE_CELLS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":425,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.DeleteCells)
    public deleteCells() {
        const editor = this.documentManager.activeTextEditor;
        if (!editor || !editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_ABOVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":517,"character":32}
```typescript
        editor.selections = selections;
    }

    @captureTelemetry(Telemetry.ExtendSelectionByCellAbove)
    public extendSelectionByCellAbove() {
        // This behaves similarly to excel "Extend Selection by One Cell Above".
        // The direction of the selection matters (i.e. where the active cursor)
```

</details>
<details>
  <summary>DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":583,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.ExtendSelectionByCellBelow)
    public extendSelectionByCellBelow() {
        // This behaves similarly to excel "Extend Selection by One Cell Above".
        // The direction of the selection matters (i.e. where the active cursor)
```

</details>
<details>
  <summary>DATASCIENCE.RUN_FILE_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":179,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunFileInteractive)
    public async runFileInteractive() {
        return this.runFileInteractiveInternal(false);
    }
```

</details>
<details>
  <summary>DATASCIENCE.RUN_FROM_LINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":288,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunFromLine)
    public async runFromLine(targetLine: number) {
        if (this.document && targetLine < this.document.lineCount) {
            const lastLine = this.document.lineAt(this.document.lineCount - 1);
```

</details>
<details>
  <summary>DATASCIENCE.RUN_INSERT_CELL_ABOVE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":412,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.InsertCellAbove)
    public insertCellAbove() {
        const editor = this.documentManager.activeTextEditor;
        if (editor && editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_INSERT_CELL_BELOW</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":399,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.InsertCellBelow)
    public insertCellBelow() {
        const editor = this.documentManager.activeTextEditor;
        if (editor && editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_INSERT_CELL_BELOW_POSITION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":391,"character":32}
```typescript
        );
    }

    @captureTelemetry(Telemetry.InsertCellBelowPosition)
    public insertCellBelowPosition() {
        const editor = this.documentManager.activeTextEditor;
        if (editor && editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_MOVE_CELLS_DOWN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":656,"character":32}
```typescript
        await this.moveCellsDirection(true);
    }

    @captureTelemetry(Telemetry.MoveCellsDown)
    public async moveCellsDown(): Promise<void> {
        await this.moveCellsDirection(false);
    }
```

</details>
<details>
  <summary>DATASCIENCE.RUN_MOVE_CELLS_UP</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":651,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.MoveCellsUp)
    public async moveCellsUp(): Promise<void> {
        await this.moveCellsDirection(true);
    }
```

</details>
<details>
  <summary>DATASCIENCE.RUN_SELECT_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":462,"character":32}
```typescript
        });
    }

    @captureTelemetry(Telemetry.SelectCell)
    public selectCell() {
        const editor = this.documentManager.activeTextEditor;
        if (editor && editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_SELECT_CELL_CONTENTS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":479,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.SelectCellContents)
    public selectCellContents() {
        const editor = this.documentManager.activeTextEditor;
        if (!editor || !editor.selection) {
```

</details>
<details>
  <summary>DATASCIENCE.RUN_SELECTION_OR_LINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":253,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunSelectionOrLine)
    public async runSelectionOrLine(activeEditor: TextEditor | undefined, text?: string | Uri) {
        if (this.document && activeEditor && this.fs.arePathsSame(activeEditor.document.uri, this.document.uri)) {
            let codeToExecute: string | undefined;
```

</details>
<details>
  <summary>DATASCIENCE.RUN_TO_LINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codewatcher.ts:{"line":274,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunToLine)
    public async runToLine(targetLine: number) {
        if (this.document && targetLine > 0) {
            const previousLine = this.document.lineAt(targetLine - 1);
```

</details>
<details>
  <summary>DATASCIENCE.SAVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.SCROLLED_TO_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.SELECT_JUPYTER_INTERPRETER_Command</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterSelectionCommand.ts:{"line":23,"character":45}
```typescript
    public async activate(): Promise<void> {
        this.disposables.push(
            this.cmdManager.registerCommand('jupyter.selectJupyterInterpreter', () => {
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreterCommand);
                this.service.selectInterpreter().ignoreErrors();
            })
        );
```

</details>
<details>
  <summary>DATASCIENCE.SELECT_JUPYTER_URI</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/commandLineSelector.ts:{"line":35,"character":32}
```typescript
        workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    }

    @captureTelemetry(Telemetry.SelectJupyterURI)
    public selectJupyterCommandLine(file: Uri): Promise<void> {
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingCommandLine.bind(this, file), {});
```

src/client/datascience/jupyter/serverSelector.ts:{"line":55,"character":32}
```typescript
        @inject(IJupyterServerUriStorage) private readonly serverUriStorage: IJupyterServerUriStorage
    ) {}

    @captureTelemetry(Telemetry.SelectJupyterURI)
    @traceDecorators.error('Failed to select Jupyter Uri')
    public selectJupyterURI(
        allowLocal: boolean,
```

</details>
<details>
  <summary>DATASCIENCE.SELECT_LOCAL_JUPYTER_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/vscodeNotebookController.ts:{"line":363,"character":32}
```typescript
        if (existingKernel) {
            const telemetryEvent =
                this.localOrRemoteKernel === 'local'
                    ? Telemetry.SelectLocalJupyterKernel
                    : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebookApi.notebookEditors
```

</details>
<details>
  <summary>DATASCIENCE.SELECT_REMOTE_JUPYTER_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/vscodeNotebookController.ts:{"line":364,"character":32}
```typescript
            const telemetryEvent =
                this.localOrRemoteKernel === 'local'
                    ? Telemetry.SelectLocalJupyterKernel
                    : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebookApi.notebookEditors
                .filter((editor) => editor.document === document)
```

</details>
<details>
  <summary>DATASCIENCE.SELFCERTSMESSAGECLOSE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-common/notebookServerProvider.ts:{"line":167,"character":57}
```typescript
                                )
                                .ignoreErrors();
                        } else if (value === closeOption) {
                            sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                        }
                    })
                    .then(noop, noop);
```

src/client/datascience/jupyter/jupyterPasswordConnect.ts:{"line":376,"character":49}
```typescript
                    );
                    return this.fetchFunction(url, this.addAllowUnauthorized(url, true, options));
                } else if (value === closeOption) {
                    sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                }
            }
            throw e;
```

</details>
<details>
  <summary>DATASCIENCE.SELFCERTSMESSAGEENABLED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-common/notebookServerProvider.ts:{"line":157,"character":57}
```typescript
                    )
                    .then((value) => {
                        if (value === enableOption) {
                            sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                            this.configuration
                                .updateSetting(
                                    'allowUnauthorizedRemoteConnection',
```

src/client/datascience/jupyter/jupyterPasswordConnect.ts:{"line":367,"character":49}
```typescript
                    closeOption
                );
                if (value === enableOption) {
                    sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                    await this.configService.updateSetting(
                        'allowUnauthorizedRemoteConnection',
                        true,
```

</details>
<details>
  <summary>DATASCIENCE.SET_JUPYTER_URI_LOCAL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/serverSelector.ts:{"line":67,"character":32}
```typescript
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingURI.bind(this, allowLocal), {});
    }
    @captureTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        const previousValue = await this.serverUriStorage.getUri();
        await this.serverUriStorage.setUri(Settings.JupyterServerLocalLaunch);
```

</details>
<details>
  <summary>DATASCIENCE.SET_JUPYTER_URI_UI_DISPLAYED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/serverSelector.ts:{"line":61,"character":37}
```typescript
        allowLocal: boolean,
        commandSource: SelectJupyterUriCommandSource = 'nonUser'
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.SetJupyterURIUIDisplayed, undefined, {
            commandSource
        });
        const multiStep = this.multiStepFactory.create<{}>();
```

</details>
<details>
  <summary>DATASCIENCE.SET_JUPYTER_URI_USER_SPECIFIED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/serverSelector.ts:{"line":85,"character":37}
```typescript
        await this.serverUriStorage.setUri(userURI);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });

```

</details>
<details>
  <summary>DATASCIENCE.SHOW_DATA_EXPLORER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewer.ts:{"line":210,"character":41}
```typescript

        // Log telemetry about number of rows
        try {
            sendTelemetryEvent(Telemetry.ShowDataViewer, 0, {
                rows: output.rowCount ? output.rowCount : 0,
                columns: output.columns ? output.columns.length : 0
            });
```

src/client/datascience/data-viewing/dataViewer.ts:{"line":290,"character":41}
```typescript

    private sendElapsedTimeTelemetry() {
        if (this.rowsTimer && this.pendingRowsCount === 0) {
            sendTelemetryEvent(Telemetry.ShowDataViewer, this.rowsTimer.elapsedTime);
        }
    }

```

</details>
<details>
  <summary>DATASCIENCE.START_SHOW_DATA_EXPLORER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewerFactory.ts:{"line":40,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.StartShowDataViewer)
    public async create(dataProvider: IDataViewerDataProvider, title: string): Promise<IDataViewer> {
        let result: IDataViewer | undefined;

```

</details>
<details>
  <summary>DATASCIENCE.SUBMITCELLFROMREPL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.UNDO</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":192,"character":45}
```typescript
            }

            case DataScience.selectDifferentJupyterInterpreter(): {
                sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                return JupyterInterpreterDependencyResponse.selectAnotherInterpreter;
            }

```

src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":198,"character":45}
```typescript

            case DataScience.pythonInteractiveHelpLink(): {
                this.applicationShell.openUrl(HelpLinks.PythonInteractiveHelpLink);
                sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                return JupyterInterpreterDependencyResponse.cancel;
            }

```

src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":203,"character":45}
```typescript
            }

            default:
                sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                return JupyterInterpreterDependencyResponse.cancel;
        }
    }
```

</details>
<details>
  <summary>DATASCIENCE.USER_DID_NOT_INSTALL_PANDAS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewerDependencyService.ts:{"line":107,"character":41}
```typescript
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
            throw new Error(DataScience.pandasRequiredForViewing());
        }
    }
```

</details>
<details>
  <summary>DATASCIENCE.USER_INSTALLED_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":185,"character":45}
```typescript
                        return JupyterInterpreterDependencyResponse.cancel;
                    }
                }
                sendTelemetryEvent(Telemetry.UserInstalledJupyter);

                // Check if kernelspec module is something that accessible.
                return this.checkKernelSpecAvailability(interpreter);
```

</details>
<details>
  <summary>DATASCIENCE.USER_INSTALLED_MODULE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.USER_INSTALLED_PANDAS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewerDependencyService.ts:{"line":104,"character":45}
```typescript
                cancellatonPromise
            ]);
            if (response === InstallerResponse.Installed) {
                sendTelemetryEvent(Telemetry.UserInstalledPandas);
            }
        } else {
            sendTelemetryEvent(Telemetry.UserDidNotInstallPandas);
```

</details>
<details>
  <summary>DATASCIENCE.VARIABLE_EXPLORER_TOGGLE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.DELETE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.INSERT_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.MOVE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.ACTIVE_INTERPRETER_LISTING_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/api/pythonApi.ts:{"line":366,"character":32}
```typescript
    }

    private workspaceCachedActiveInterpreter = new Map<string, Promise<PythonEnvironment | undefined>>();
    @captureTelemetry(Telemetry.ActiveInterpreterListingPerf)
    public getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        this.hookupOnDidChangeInterpreterEvent();
        const workspaceId = this.workspace.getWorkspaceFolderIdentifier(resource);
```

</details>
<details>
  <summary>DS_INTERNAL.ASK_USER_FOR_NEW_KERNEL_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":217,"character":61}
```typescript
                        } catch (ex) {
                            traceError('Failed to connect to server', ex);
                            if (ex instanceof JupyterSessionStartError && isLocalConnection && allowUI) {
                                sendTelemetryEvent(Telemetry.AskUserForNewJupyterKernel);
                                void this.kernelSelector.askForLocalKernel(options?.resource);
                            }
                            throw ex;
```

</details>
<details>
  <summary>DS_INTERNAL.CELL_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.CODE_LENS_ACQ_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/codelensprovider.ts:{"line":53,"character":26}
```typescript
        // On shutdown send how long on average we spent parsing code lens
        if (this.totalGetCodeLensCalls > 0) {
            sendTelemetryEvent(
                Telemetry.CodeLensAverageAcquisitionTime,
                this.totalExecutionTimeInMs / this.totalGetCodeLensCalls
            );
        }
```

</details>
<details>
  <summary>DS_INTERNAL.COMMAND_EXECUTED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/common/application/commandManager.ts:{"line":36,"character":45}
```typescript
        return commands.registerCommand(
            command,
            (...args: U) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, ...(args as any));
                } else {
```

src/client/common/application/commandManager.ts:{"line":70,"character":45}
```typescript
        return commands.registerTextEditorCommand(
            command,
            (textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, textEditor, edit, ...args);
                } else {
```

src/client/common/application/commandManager.ts:{"line":101,"character":41}
```typescript
        U extends ICommandNameArgumentTypeMapping[E]
    >(command: E, ...rest: U): Thenable<T | undefined> {
        if (!commandsToIgnore.has(command)) {
            sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
        }
        return commands.executeCommand<T>(command, ...rest);
    }
```

</details>
<details>
  <summary>DS_INTERNAL.COMPLETION_TIME_FROM_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.COMPLETION_TIME_FROM_LS</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.CONNECTFAILEDJUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":268,"character":57}
```typescript
                                );
                            }
                        } else {
                            sendTelemetryEvent(Telemetry.ConnectFailedJupyter, undefined, undefined, err, true);
                            throw WrappedError.from(
                                localize.DataScience.jupyterNotebookConnectFailed().format(connection.baseUrl, err),
                                err
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTLOCALJUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":225,"character":54}
```typescript
                    }

                    sendTelemetryEvent(
                        isLocalConnection ? Telemetry.ConnectLocalJupyter : Telemetry.ConnectRemoteJupyter
                    );
                    return result;
                } catch (err) {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEFAILEDJUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":252,"character":57}
```typescript

                        // Something else went wrong
                        if (!isLocalConnection) {
                            sendTelemetryEvent(Telemetry.ConnectRemoteFailedJupyter, undefined, undefined, err, true);

                            // Check for the self signed certs error specifically
                            if (err.message.indexOf('reason: self signed certificate') >= 0) {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEJUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":225,"character":86}
```typescript
                    }

                    sendTelemetryEvent(
                        isLocalConnection ? Telemetry.ConnectLocalJupyter : Telemetry.ConnectRemoteJupyter
                    );
                    return result;
                } catch (err) {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEJUPYTER_VIA_LOCALHOST</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":167,"character":53}
```typescript
                    ]);

                    if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                        sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
                    }
                    // Create a server tha  t we will then attempt to connect to.
                    result = this.serviceContainer.get<INotebookServer>(INotebookServer);
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTESELFCERTFAILEDJUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":256,"character":61}
```typescript

                            // Check for the self signed certs error specifically
                            if (err.message.indexOf('reason: self signed certificate') >= 0) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                                throw new JupyterSelfCertsError(connection.baseUrl);
                            } else {
                                throw WrappedError.from(
```

</details>
<details>
  <summary>DS_INTERNAL.ERROR_START_RAWKERNEL_WITHOUT_INTERPRETER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/liveshare/hostRawNotebookProvider.ts:{"line":98,"character":49}
```typescript
                kernelConnection.kind === 'startUsingKernelSpec'
            ) {
                if (!kernelConnection.interpreter) {
                    sendTelemetryEvent(Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter, undefined, {
                        pythonExtensionInstalled: this.extensionChecker.isPythonExtensionInstalled
                    });
                }
```

</details>
<details>
  <summary>DS_INTERNAL.EXECUTE_CELL_PERCEIVED_COLD</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/cellExecution.ts:{"line":408,"character":41}
```typescript
        const props = { notebook: true };
        if (!CellExecution.sentExecuteCellTelemetry) {
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatch.elapsedTime, props);
        }
```

src/client/datascience/editor-integration/codewatcher.ts:{"line":1022,"character":45}
```typescript
        if (runningStopWatch) {
            if (!CodeWatcher.sentExecuteCellTelemetry) {
                CodeWatcher.sentExecuteCellTelemetry = true;
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, runningStopWatch.elapsedTime);
            } else {
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, runningStopWatch.elapsedTime);
            }
```

</details>
<details>
  <summary>DS_INTERNAL.EXECUTE_CELL_PERCEIVED_WARM</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/cellExecution.ts:{"line":410,"character":41}
```typescript
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatch.elapsedTime, props);
        }
    }
    private canExecuteCell() {
```

src/client/datascience/editor-integration/codewatcher.ts:{"line":1024,"character":45}
```typescript
                CodeWatcher.sentExecuteCellTelemetry = true;
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, runningStopWatch.elapsedTime);
            } else {
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, runningStopWatch.elapsedTime);
            }
        }
    }
```

</details>
<details>
  <summary>DS_INTERNAL.FAILED_TO_UPDATE_JUPYTER_KERNEL_SPEC</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/jupyterKernelService.ts:{"line":167,"character":41}
```typescript
        try {
            await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex, true);
            throw ex;
        }
        if (cancelToken?.isCancellationRequested) {
```

src/client/datascience/jupyter/kernels/jupyterKernelService.ts:{"line":261,"character":49}
```typescript
                try {
                    await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(specModel, undefined, 2));
                } catch (ex) {
                    sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex, true);
                    throw ex;
                }
            }
```

</details>
<details>
  <summary>DS_INTERNAL.FIND_JUPYTER_COMMAND</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.FIND_JUPYTER_KERNEL_SPEC</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.FIND_KERNEL_FOR_LOCAL_CONNECTION</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.GET_PASSWORD_FAILURE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterPasswordConnect.ts:{"line":251,"character":41}
```typescript
            const requestHeaders = { Cookie: cookieString, 'X-XSRFToken': xsrfCookie };
            return { requestHeaders };
        } else {
            sendTelemetryEvent(Telemetry.GetPasswordFailure);
            return undefined;
        }
    }
```

</details>
<details>
  <summary>DS_INTERNAL.GET_PASSWORD_SUCCESS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterPasswordConnect.ts:{"line":246,"character":41}
```typescript

        // If we found everything return it all back if not, undefined as partial is useless
        if (xsrfCookie && sessionCookieName && sessionCookieValue) {
            sendTelemetryEvent(Telemetry.GetPasswordSuccess);
            const cookieString = this.getSessionCookieString(xsrfCookie, sessionCookieName, sessionCookieValue);
            const requestHeaders = { Cookie: cookieString, 'X-XSRFToken': xsrfCookie };
            return { requestHeaders };
```

</details>
<details>
  <summary>DS_INTERNAL.GET_PREFERRED_KERNEL_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.HASHED_NOTEBOOK_OUTPUT_MIME_TYPE_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.HASHED_OUTPUT_MIME_TYPE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts:{"line":152,"character":37}
```typescript
            hasJupyter: lowerMimeType.includes('jupyter'),
            hasVnd: lowerMimeType.includes('vnd')
        };
        sendTelemetryEvent(Telemetry.HashedCellOutputMimeType, undefined, props);
    }
}

```

</details>
<details>
  <summary>DS_INTERNAL.HASHED_OUTPUT_MIME_TYPE_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts:{"line":118,"character":32}
```typescript
        this.pendingChecks.set(id, setTimeout(check, 5000));
    }

    @captureTelemetry(Telemetry.HashedCellOutputMimeTypePerf)
    private checkCell(cell: NotebookCell) {
        this.pendingChecks.delete(cell.document.uri.toString());
        this.getCellOutputMimeTypes(cell).forEach(this.sendTelemetry.bind(this));
```

</details>
<details>
  <summary>DS_INTERNAL.HIDDEN_EXECUTION_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.INTERACTIVE_FILE_TOOLTIPS_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/editor-integration/hoverProvider.ts:{"line":78,"character":37}
```typescript
        const timeoutHandler = sleep(300).then(() => undefined);
        this.stopWatch.reset();
        const result = await Promise.race([timeoutHandler, this.getVariableHover(document, position, token)]);
        sendTelemetryEvent(Telemetry.InteractiveFileTooltipsPerf, this.stopWatch.elapsedTime, {
            isResultNull: !!result
        });
        return result;
```

</details>
<details>
  <summary>DS_INTERNAL.INTERPRETER_LISTING_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/api/pythonApi.ts:{"line":355,"character":32}
```typescript
        return this.didChangeInterpreter.event;
    }

    @captureTelemetry(Telemetry.InterpreterListingPerf)
    public getInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
        // Cache result as it only changes when the interpreter list changes or we add more workspace folders
```

</details>
<details>
  <summary>DS_INTERNAL.INTERRUPT_JUPYTER_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":169,"character":32}
```typescript
        return newCellExecutionQueue;
    }
    @captureTelemetry(Telemetry.Interrupt)
    @captureTelemetry(Telemetry.InterruptJupyterTime)
    private async interruptExecution(
        session: IJupyterSession,
        pendingCells: Promise<unknown>
```

</details>
<details>
  <summary>DS_INTERNAL.INVALID_KERNEL_USED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterInvalidKernelError.ts:{"line":18,"character":37}
```typescript
                getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)
            )
        );
        sendTelemetryEvent(Telemetry.KernelInvalid);
    }
}

```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_DISCOVERED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_DISCOVERY_ERRORED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/ipyWidgetScriptSource.ts:{"line":226,"character":41}
```typescript
            widgetSource = await this.scriptProvider.getWidgetScriptSource(moduleName, moduleVersion);
        } catch (ex) {
            traceError('Failed to get widget source due to an error', ex);
            sendTelemetryEvent(Telemetry.HashedIPyWidgetScriptDiscoveryError);
        } finally {
            traceInfo(
                `${ConsoleForegroundColors.Green}Script for ${moduleName}, is ${widgetSource.scriptUri} from ${widgetSource.source}`
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_LOAD_DISABLED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_LOAD_FAILURE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/commonMessageCoordinator.ts:{"line":156,"character":41}
```typescript
            }
            traceError(`Widget load failure ${errorMessage}`, payload);

            sendTelemetryEvent(Telemetry.IPyWidgetLoadFailure, 0, {
                isOnline: payload.isOnline,
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion,
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_LOAD_SUCCESS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/commonMessageCoordinator.ts:{"line":116,"character":41}
```typescript

    private sendLoadSucceededTelemetry(payload: LoadIPyWidgetClassLoadAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetLoadSuccess, 0, {
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_OVERHEAD</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/ipyWidgetMessageDispatcher.ts:{"line":503,"character":37}
```typescript
    }

    private sendOverheadTelemetry() {
        sendTelemetryEvent(Telemetry.IPyWidgetOverhead, 0, {
            totalOverheadInMs: this.totalWaitTime,
            numberOfMessagesWaitedOn: this.totalWaitedMessages,
            averageWaitTime: this.totalWaitTime / this.totalWaitedMessages,
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts:{"line":202,"character":37}
```typescript
            return this.configurationPromise.promise;
        }
        this.configurationPromise = createDeferred();
        sendTelemetryEvent(Telemetry.IPyWidgetPromptToUseCDN);
        const selection = await this.appShell.showInformationMessage(
            DataScience.useCDNForWidgets(),
            Common.ok(),
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN_SELECTION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts:{"line":232,"character":37}
```typescript
                break;
        }

        sendTelemetryEvent(Telemetry.IPyWidgetPromptToUseCDNSelection, undefined, { selection: selectionForTelemetry });
        this.configurationPromise.resolve();
    }
    private async updateScriptSources(scriptSources: WidgetCDNs[]) {
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_RENDER_FAILURE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/commonMessageCoordinator.ts:{"line":179,"character":41}
```typescript
    private sendRenderFailureTelemetry(payload: Error) {
        try {
            traceError('Error rendering a widget: ', payload);
            sendTelemetryEvent(Telemetry.IPyWidgetRenderFailure);
        } catch {
            // Do nothing on a failure
        }
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_TEST_AVAILABILITY_ON_CDN</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_TEST_AVAILABILITY_ON_LOCAL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/localWidgetScriptSourceProvider.ts:{"line":52,"character":32}
```typescript
        }
        return (this.cachedWidgetScripts = this.getWidgetScriptSourcesWithoutCache());
    }
    @captureTelemetry(Telemetry.DiscoverIPyWidgetNamesLocalPerf)
    private async getWidgetScriptSourcesWithoutCache(): Promise<WidgetScriptSource[]> {
        const sysPrefix = await this.getSysPrefixOfKernel();
        if (!sysPrefix) {
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_UNHANDLED_MESSAGE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/commonMessageCoordinator.ts:{"line":198,"character":45}
```typescript
                this.jupyterOutput.appendLine(
                    localize.DataScience.unhandledMessage().format(msg.header.msg_type, JSON.stringify(msg.content))
                );
                sendTelemetryEvent(Telemetry.IPyWidgetUnhandledMessage, undefined, { msg_type: msg.header.msg_type });
            } catch {
                // Don't care if this doesn't get logged
            }
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_USED_BY_USER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts:{"line":106,"character":37}
```typescript
            }
        }

        sendTelemetryEvent(Telemetry.HashedIPyWidgetNameUsed, undefined, {
            hashedName: getTelemetrySafeHashedString(found.moduleName),
            source: found.source,
            cdnSearched: this.configuredScriptSources.length > 0
```

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED_LOAD_FAILURE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/ipywidgets/commonMessageCoordinator.ts:{"line":168,"character":41}
```typescript
    }
    private sendUnsupportedWidgetVersionFailureTelemetry(payload: NotifyIPyWidgeWidgetVersionNotSupportedAction) {
        try {
            sendTelemetryEvent(Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure, 0, {
                moduleHash: getTelemetrySafeHashedString(payload.moduleName),
                moduleVersion: payload.moduleVersion
            });
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_CREATING_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterServer.ts:{"line":145,"character":57}
```typescript
            );
            const baseUrl = this.launchInfo?.connectionInfo.baseUrl || '';
            this.logRemoteOutput(localize.DataScience.createdNewNotebook().format(baseUrl));
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return notebook;
        } catch (ex) {
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime, undefined, ex);
```

src/client/datascience/jupyter/jupyterServer.ts:{"line":148,"character":57}
```typescript
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return notebook;
        } catch (ex) {
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime, undefined, ex);
            throw ex;
        }
    }
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_CUSTOM_COMMAND_LINE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/commandLineSelector.ts:{"line":92,"character":41}
```typescript

    private async setJupyterCommandLine(val: string): Promise<void> {
        if (val) {
            sendTelemetryEvent(Telemetry.JupyterCommandLineNonDefault);
        }
        const split = parseArgsStringToArgv(val);
        await this.configuration.updateSetting(
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_IDLE_TIMEOUT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterWaitForIdleError.ts:{"line":11,"character":37}
```typescript
export class JupyterWaitForIdleError extends BaseError {
    constructor(message: string) {
        super('timeout', message);
        sendTelemetryEvent(Telemetry.SessionIdleTimeout);
    }
}

```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_INSTALL_FAILED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_INTALLED_BUT_NO_KERNELSPEC_MODULE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":309,"character":37}
```typescript
            return JupyterInterpreterDependencyResponse.ok;
        }
        // Indicate no kernel spec module.
        sendTelemetryEvent(Telemetry.JupyterInstalledButNotKernelSpecModule);
        if (Cancellation.isCanceled(token)) {
            return JupyterInterpreterDependencyResponse.cancel;
        }
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_REGISTER_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/jupyterKernelService.ts:{"line":119,"character":32}
```typescript
     */
    // eslint-disable-next-line
    // eslint-disable-next-line complexity
    @captureTelemetry(Telemetry.RegisterInterpreterAsKernel, undefined, true)
    @traceDecorators.error('Failed to register an interpreter as a kernel')
    @reportAction(ReportableAction.KernelsRegisterKernel)
    // eslint-disable-next-line
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_START_TIMEOUT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":285,"character":41}
```typescript
            // If we're here, then starting jupyter timeout.
            // Kill any existing connections.
            connection?.dispose();
            sendTelemetryEvent(Telemetry.JupyterStartTimeout, stopWatch.elapsedTime, {
                timeout: stopWatch.elapsedTime
            });
            if (allowUI) {
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTERSTARTUPCOST</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterExecution.ts:{"line":347,"character":32}
```typescript
    }

    // eslint-disable-next-line
    @captureTelemetry(Telemetry.StartJupyter)
    private async startNotebookServer(
        useDefaultConfig: boolean,
        customCommandLine: string[],
```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/telemetry/kernelTelemetry.ts:{"line":37,"character":53}
```typescript
    });
    trackKernelResourceInformation(resource, counters);
    if (stopWatch) {
        sendKernelTelemetryEvent(resource, Telemetry.KernelCount, stopWatch.elapsedTime, counters);
    }
}

```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_ENUMERATION</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.KERNEL_FINDER_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/localKernelFinder.ts:{"line":51,"character":32}
```typescript
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
```

src/client/datascience/kernel-launcher/remoteKernelFinder.ts:{"line":55,"character":32}
```typescript
        );
    }
    @traceDecorators.verbose('Find remote kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async findKernel(
        resource: Resource,
```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_LAUNCHER_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/kernelLauncher.ts:{"line":116,"character":56}
```typescript
            // Should be available now, wait with a timeout
            return await this.launchProcess(kernelConnectionMetadata, resource, workingDirectory, timeout, cancelToken);
        })();
        sendKernelTelemetryWhenDone(resource, Telemetry.KernelLauncherPerf, promise);
        return promise;
    }

```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_LISTING_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/localKnownPathKernelSpecFinder.ts:{"line":36,"character":32}
```typescript
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    public async listKernelSpecs(
        includePythonKernels: boolean,
        cancelToken?: CancellationToken
```

src/client/datascience/kernel-launcher/localPythonAndRelatedNonPythonKernelSpecFinder.ts:{"line":48,"character":32}
```typescript
    ) {
        super(fs, workspaceService, extensionChecker);
    }
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    public async listKernelSpecs(resource: Resource, cancelToken?: CancellationToken) {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId =
```

src/client/datascience/kernel-launcher/localKernelFinder.ts:{"line":152,"character":32}
```typescript
        return this.jupyterPaths.getKernelSpecRootPath();
    }

    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    private async listKernelsWithoutCache(
        resource: Resource,
        cancelToken?: CancellationToken
```

src/client/datascience/kernel-launcher/remoteKernelFinder.ts:{"line":56,"character":32}
```typescript
    }
    @traceDecorators.verbose('Find remote kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async findKernel(
        resource: Resource,
        connInfo: INotebookProviderConnection | undefined,
```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_NOT_INSTALLED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/errorHandler/errorHandler.ts:{"line":67,"character":45}
```typescript
                        }
                    }, noop);
            } else {
                sendTelemetryEvent(Telemetry.KernelNotInstalled, undefined, {
                    action: 'displayed',
                    language: getTelemetrySafeLanguage(language)
                });
```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_PROVIDER_PERF</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.KERNEL_REGISTER_FAILED</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.KERNEL_SPEC_NOT_FOUND</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":285,"character":45}
```typescript
            .then(() => true)
            .catch((e) => {
                traceError(`Kernel spec not found: `, e);
                sendTelemetryEvent(Telemetry.KernelSpecNotFound);
                return false;
            });
    }
```

</details>
<details>
  <summary>DS_INTERNAL.LOCAL_KERNEL_SPEC_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.NATIVE_VARIABLE_VIEW_LOADED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/variablesView/variableView.ts:{"line":85,"character":32}
```typescript
        this.dataViewerChecker = new DataViewerChecker(configuration, appShell);
    }

    @captureTelemetry(Telemetry.NativeVariableViewLoaded)
    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(process.cwd(), codeWebview).catch(traceError);

```

</details>
<details>
  <summary>DS_INTERNAL.NATIVE_VARIABLE_VIEW_MADE_VISIBLE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/variablesView/variableView.ts:{"line":144,"character":41}
```typescript

        // I've we've been made visible, make sure that we are updated
        if (visible) {
            sendTelemetryEvent(Telemetry.NativeVariableViewMadeVisible);
            // If there is an active execution count, update the view with that info
            // Keep the variables up to date if document has run cells while the view was not visible
            if (this.notebookWatcher.activeNotebookExecutionCount !== undefined) {
```

</details>
<details>
  <summary>DS_INTERNAL.NATIVE.NOTEBOOK_OPEN_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-common/notebookUsageTracker.ts:{"line":62,"character":41}
```typescript
    public dispose() {
        // Send a bunch of telemetry
        if (this.openedNotebookCount) {
            sendTelemetryEvent(Telemetry.NotebookOpenCount, undefined, { count: this.openedNotebookCount });
        }
        if (this.executedNotebooksIndexedByUri.size) {
            sendTelemetryEvent(Telemetry.NotebookRunCount, undefined, {
```

</details>
<details>
  <summary>DS_INTERNAL.NATIVE.NOTEBOOK_OPEN_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.NATIVE.NOTEBOOK_RUN_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-common/notebookUsageTracker.ts:{"line":65,"character":41}
```typescript
            sendTelemetryEvent(Telemetry.NotebookOpenCount, undefined, { count: this.openedNotebookCount });
        }
        if (this.executedNotebooksIndexedByUri.size) {
            sendTelemetryEvent(Telemetry.NotebookRunCount, undefined, {
                count: this.executedNotebooksIndexedByUri.size
            });
        }
```

</details>
<details>
  <summary>DS_INTERNAL.NATIVE.OPEN_NOTEBOOK_FAILURE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.NATIVE.WORKSPACE_NOTEBOOK_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/interactive-common/notebookUsageTracker.ts:{"line":70,"character":41}
```typescript
            });
        }
        if (this.notebookCount) {
            sendTelemetryEvent(Telemetry.NotebookWorkspaceCount, undefined, { count: this.notebookCount });
        }
    }
    private onEditorOpened(doc: NotebookDocument): void {
```

</details>
<details>
  <summary>DS_INTERNAL.NEW_FILE_USED_IN_INTERACTIVE</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.NUMBER_OF_REMOTE_KERNEL_IDS_SAVED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebookStorage/preferredRemoteKernelIdProvider.ts:{"line":57,"character":37}
```typescript
        }

        // Prune list if too big
        sendTelemetryEvent(Telemetry.NumberOfSavedRemoteKernelIds, undefined, { count: list.length });
        while (list.length > MaximumKernelIdListSize) {
            list.shift();
        }
```

</details>
<details>
  <summary>DS_INTERNAL.PERCEIVED_JUPYTER_STARTUP_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernel.ts:{"line":240,"character":41}
```typescript
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
```

src/client/datascience/jupyter/kernels/kernel.ts:{"line":291,"character":34}
```typescript
                    }
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.PerceivedJupyterStartupNotebook,
                        stopWatch.elapsedTime
                    );
                    if (this.notebook?.connection) {
```

</details>
<details>
  <summary>DS_INTERNAL.PREFERRED_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/localKernelFinder.ts:{"line":81,"character":41}
```typescript
                preferredInterpreter,
                undefined
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
```

src/client/datascience/kernel-launcher/localKernelFinder.ts:{"line":93,"character":26}
```typescript
            }
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                {
                    result: 'failed',
```

src/client/datascience/kernel-launcher/remoteKernelFinder.ts:{"line":81,"character":41}
```typescript
                undefined,
                this.preferredRemoteKernelIdProvider
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage
```

src/client/datascience/kernel-launcher/remoteKernelFinder.ts:{"line":89,"character":26}
```typescript
            return preferred;
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                { result: 'failed', resourceType, language: telemetrySafeLanguage },
                ex,
```

</details>
<details>
  <summary>DS_INTERNAL.PYTHON_EXTENSION_NOT_INSTALLED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/api/pythonApi.ts:{"line":170,"character":37}
```typescript
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        const no = localize.Common.bannerLabelNo();
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
```

src/client/api/pythonApi.ts:{"line":173,"character":41}
```typescript
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```

src/client/api/pythonApi.ts:{"line":176,"character":41}
```typescript
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async installPythonExtension() {
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":62,"character":37}
```typescript
        }
    }
    private async handleExecutionWithoutPythonExtension() {
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonExtensionRequiredToRunNotebook(),
            { modal: true },
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":69,"character":41}
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":72,"character":41}
```typescript
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async handleExecutionWithoutPython() {
```

</details>
<details>
  <summary>DS_INTERNAL.PYTHON_KERNEL_EXECUTABLE_MATCHES</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/helpers.ts:{"line":767,"character":37}
```typescript
            kernelConnection.interpreter.path.toLowerCase(),
            sysExecutable.toLowerCase()
        );
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
```

src/client/datascience/jupyter/kernels/helpers.ts:{"line":792,"character":49}
```typescript
                });
                if (execOutput.stdout.trim().length > 0) {
                    const match = areInterpreterPathsSame(execOutput.stdout.trim().toLowerCase(), sysExecutable);
                    sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
                        match: match ? 'true' : 'false',
                        kernelConnectionType: kernelConnection.kind
                    });
```

</details>
<details>
  <summary>DS_INTERNAL.PYTHON_MODULE_INSTALL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/api/pythonApi.ts:{"line":282,"character":41}
```typescript
            action = 'failed';
            throw ex;
        } finally {
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action,
                moduleName: ProductNames.get(product)!
            });
```

src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts:{"line":139,"character":37}
```typescript
        }

        const message = getMessageForLibrariesNotInstalled(missingProducts, interpreter.displayName);
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.jupyter)!
        });
```

src/client/datascience/data-viewing/dataViewerDependencyService.ts:{"line":67,"character":37}
```typescript
        interpreter?: PythonEnvironment,
        token?: CancellationToken
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":136,"character":37}
```typescript
        const ipykernelProductName = ProductNames.get(Product.ipykernel)!;
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ipykernelProductName,
            resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":154,"character":45}
```typescript
        const options = resource ? [installPrompt, selectKernel] : [installPrompt];
        try {
            if (!this.isCodeSpace) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'prompted',
                    moduleName: ipykernelProductName,
                    resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":168,"character":45}
```typescript
                      promptCancellationPromise
                  ]);
            if (installerToken.isCancellationRequested) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'dismissed',
                    moduleName: ipykernelProductName,
                    resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":178,"character":45}
```typescript
            }

            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'differentKernel',
                    moduleName: ipykernelProductName,
                    resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":186,"character":45}
```typescript
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installPrompt) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'install',
                    moduleName: ipykernelProductName,
                    resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":203,"character":49}
```typescript
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'installed',
                        moduleName: ipykernelProductName,
                        resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":211,"character":49}
```typescript
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'failed',
                        moduleName: ipykernelProductName,
                        resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":221,"character":41}
```typescript
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'dismissed',
                moduleName: ipykernelProductName,
                resourceType,
```

src/client/datascience/jupyter/kernels/kernelDependencyService.ts:{"line":229,"character":41}
```typescript
            });
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'error',
                moduleName: ipykernelProductName,
                resourceType,
```

</details>
<details>
  <summary>DS_INTERNAL.PYTHON_NOT_INSTALLED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/errorHandler/errorHandler.ts:{"line":55,"character":45}
```typescript
            const language = getLanguageInNotebookMetadata(err.notebookMetadata);
            if (isPythonNotebook(err.notebookMetadata) || !language) {
                // If we know its a python notebook or there's no language in the metadata, then assume its a Python notebook.
                sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
                this.applicationShell
                    .showErrorMessage(DataScience.pythonNotInstalled(), Common.download())
                    .then((selection) => {
```

src/client/datascience/errorHandler/errorHandler.ts:{"line":60,"character":57}
```typescript
                    .showErrorMessage(DataScience.pythonNotInstalled(), Common.download())
                    .then((selection) => {
                        if (selection === Common.download()) {
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
                            this.applicationShell.openUrl('https://www.python.org/downloads');
                        } else {
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
```

src/client/datascience/errorHandler/errorHandler.ts:{"line":63,"character":57}
```typescript
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
                            this.applicationShell.openUrl('https://www.python.org/downloads');
                        } else {
                            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
                        }
                    }, noop);
            } else {
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":76,"character":37}
```typescript
        }
    }
    private async handleExecutionWithoutPython() {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonNotInstalledNonMarkdown(),
            { modal: true },
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":83,"character":41}
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
```

src/client/datascience/notebook/noPythonKernelsNotebookController.ts:{"line":86,"character":41}
```typescript
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
        }
    }
}
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_CREATING_NOTEBOOK</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawNotebookProvider.ts:{"line":75,"character":32}
```typescript
        return this.rawNotebookSupportedService.isSupported;
    }

    @captureTelemetry(Telemetry.RawKernelCreatingNotebook, undefined, true)
    public async createNotebook(
        identity: Uri,
        resource: Resource,
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_PROCESS_LAUNCH</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/kernelProcess.ts:{"line":81,"character":32}
```typescript
        }
    }

    @captureTelemetry(Telemetry.RawKernelProcessLaunch, undefined, true)
    public async launch(workingDirectory: string, timeout: number, cancelToken?: CancellationToken): Promise<void> {
        if (this.launchedOnce) {
            throw new Error('Kernel has already been launched.');
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_CONNECT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":173,"character":57}
```typescript
                throw error;
            }
        } finally {
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionConnect, stopWatch.elapsedTime);
        }

        this.connected = true;
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_DISPOSED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawSession.ts:{"line":62,"character":37}
```typescript
    public async dispose() {
        // We want to know who called dispose on us
        const stacktrace = new Error().stack;
        sendTelemetryEvent(Telemetry.RawKernelSessionDisposed, undefined, { stacktrace });

        // Now actually dispose ourselves
        this.isDisposing = true;
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_KERNEL_PROCESS_EXITED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/kernel-launcher/kernelLauncher.ts:{"line":142,"character":45}
```typescript

        kernelProcess.exited(
            ({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
```

src/client/datascience/raw-kernel/rawSession.ts:{"line":172,"character":37}
```typescript
        traceError(`Disposing session as kernel process died ExitCode: ${e.exitCode}, Reason: ${e.reason}`);
        // Send telemetry so we know why the kernel process exited,
        // as this affects our kernel startup success
        sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
            exitCode: e.exitCode,
            exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(e.reason)
        });
```

src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":238,"character":45}
```typescript
        if (session && (session as RawSession).kernelProcess) {
            // Watch to see if our process exits
            this.processExitHandler = (session as RawSession).kernelProcess.exited(({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_NO_IPYKERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":148,"character":61}
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                    reason: error.reason
                });
                traceError('Raw session failed to start because dependencies not installed');
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_SHUTDOWN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":216,"character":41}
```typescript
        // We want to know why we got shut down
        const stacktrace = new Error().stack;
        return super.shutdownSession(session, statusHandler, isRequestToShutdownRestartSession).then(() => {
            sendTelemetryEvent(Telemetry.RawKernelSessionShutdown, undefined, {
                isRequestToShutdownRestartSession,
                stacktrace
            });
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":100,"character":57}
```typescript

            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo('Raw session started and connected');
            this.setSession(newSession);

```

src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":120,"character":30}
```typescript
            if (error instanceof CancellationError) {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```

src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":131,"character":30}
```typescript
            } else if (error instanceof TimedOutError) {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```

src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":143,"character":30}
```typescript
            } else if (error instanceof IpyKernelNotInstalledError) {
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```

src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":157,"character":30}
```typescript
                // Send our telemetry event with the error included
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_EXCEPTION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":164,"character":30}
```typescript
                );
                sendKernelTelemetryEvent(
                    resource,
                    Telemetry.RawKernelSessionStartException,
                    undefined,
                    undefined,
                    error
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_SUCCESS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":99,"character":57}
```typescript
            newSession = await this.startRawSession(resource, kernelConnection, timeout, cancelToken, disableUI);

            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo('Raw session started and connected');
            this.setSession(newSession);
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_TIMEOUT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":136,"character":61}
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartTimeout);
                traceError('Raw session failed to start in given timeout');
                // Translate into original error
                throw new RawKernelSessionStartError(kernelConnection, error);
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_USER_CANCEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":125,"character":61}
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartUserCancel);
                traceInfo('Starting of raw session cancelled by user');
                throw error;
            } else if (error instanceof TimedOutError) {
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_START_RAW_SESSION</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawJupyterSession.ts:{"line":271,"character":32}
```typescript
        });
    }

    @captureTelemetry(Telemetry.RawKernelStartRawSession, undefined, true)
    private async startRawSession(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
```

</details>
<details>
  <summary>DS_INTERNAL.REGISTER_AND_USE_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/jupyterKernelService.ts:{"line":188,"character":37}
```typescript
            );
        }

        sendTelemetryEvent(Telemetry.RegisterAndUseInterpreterAsKernel);
        return kernelSpecFilePath;
    }
    private async updateKernelEnvironment(
```

</details>
<details>
  <summary>DS_INTERNAL.REMOTE_KERNEL_SPEC_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.RESTART_JUPYTER_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":244,"character":32}
```typescript
    }

    @captureTelemetry(Telemetry.RestartKernel)
    @captureTelemetry(Telemetry.RestartJupyterTime)
    private async restartExecution(notebook: INotebook): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
        await notebook.session.restart(this.interruptTimeout);
```

</details>
<details>
  <summary>DS_INTERNAL.RESTART_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernelExecution.ts:{"line":243,"character":32}
```typescript
        });
    }

    @captureTelemetry(Telemetry.RestartKernel)
    @captureTelemetry(Telemetry.RestartJupyterTime)
    private async restartExecution(notebook: INotebook): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
```

</details>
<details>
  <summary>DS_INTERNAL.SELECT_JUPYTER_INTERPRETER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts:{"line":94,"character":41}
```typescript
            resolveToUndefinedWhenCancelled
        ]);
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

```

src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts:{"line":105,"character":45}
```typescript
                return interpreter;
            }
            case JupyterInterpreterDependencyResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                return this.selectInterpreter(token);
```

src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts:{"line":168,"character":37}
```typescript
        this._selectedInterpreter = interpreter;
        this._onDidChangeInterpreter.fire(interpreter);
        this.interpreterSelectionState.updateSelectedPythonPath(interpreter.path);
        sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'selected' });
    }

    // For a given python path check if it can run jupyter for us
```

</details>
<details>
  <summary>DS_INTERNAL.SELECT_JUPYTER_INTERPRETER_MESSAGE_DISPLAYED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.ts:{"line":77,"character":45}
```typescript
            if (!interpreter) {
                // Unlikely scenario, user hasn't selected python, python extension will fall over.
                // Get user to select something.
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreterMessageDisplayed);
                return DataScience.selectJupyterInterpreter();
            }
        }
```

</details>
<details>
  <summary>DS_INTERNAL.SETTINGS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/datascience.ts:{"line":116,"character":41}
```typescript
                    resultSettings[k] = currentValue;
                }
            }
            sendTelemetryEvent(Telemetry.DataScienceSettings, 0, resultSettings);
        }
    }
}
```

</details>
<details>
  <summary>DS_INTERNAL.SHIFTENTER_BANNER_SHOWN</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/shiftEnterBanner.ts:{"line":77,"character":37}
```typescript
            return;
        }

        sendTelemetryEvent(Telemetry.ShiftEnterBannerShown);
        const response = await this.appShell.showInformationMessage(this.bannerMessage, ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[InteractiveShiftEnterLabelIndex.Yes]: {
```

src/test/datascience/shiftEnterBanner.unit.test.ts:{"line":68,"character":22}
```typescript
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });
```

src/test/datascience/shiftEnterBanner.unit.test.ts:{"line":113,"character":22}
```typescript
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.DisableInteractiveShiftEnter
        ]);
    });
```

</details>
<details>
  <summary>DS_INTERNAL.SHOW_DATA_NO_PANDAS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewerDependencyService.ts:{"line":59,"character":37}
```typescript
            throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
        }

        sendTelemetryEvent(Telemetry.PandasNotInstalled);
        await this.installMissingDependencies(interpreter, token);
    }

```

</details>
<details>
  <summary>DS_INTERNAL.SHOW_DATA_PANDAS_TOO_OLD</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/data-viewing/dataViewerDependencyService.ts:{"line":53,"character":41}
```typescript
            if (isVersionOfPandasSupported(pandasVersion)) {
                return;
            }
            sendTelemetryEvent(Telemetry.PandasTooOld);
            // Warn user that we cannot start because pandas is too old.
            const versionStr = `${pandasVersion.major}.${pandasVersion.minor}.${pandasVersion.build}`;
            throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
```

</details>
<details>
  <summary>DS_INTERNAL.START_EXECUTE_NOTEBOOK_CELL_PERCEIVED_COLD</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernel.ts:{"line":242,"character":45}
```typescript
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
        }
    }
```

</details>
<details>
  <summary>DS_INTERNAL.START_JUPYTER_PROCESS</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/notebookStarter.ts:{"line":144,"character":41}
```typescript
            }

            // Fire off telemetry for the process being talkable
            sendTelemetryEvent(Telemetry.StartJupyterProcess, stopWatch.elapsedTime);

            try {
                const port = parseInt(url.parse(connection.baseUrl).port || '0', 10);
```

</details>
<details>
  <summary>DS_INTERNAL.START_RAW_FAILED_UI_DISABLED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/kernels/kernel.ts:{"line":307,"character":53}
```typescript
                        ex
                    );
                    if (options?.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else {
                        this.errorHandler.handleError(ex).ignoreErrors(); // Just a notification, so don't await this
                    }
```

</details>
<details>
  <summary>DS_INTERNAL.START_SESSION_FAILED_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/baseJupyterSession.ts:{"line":38,"character":37}
```typescript
export class JupyterSessionStartError extends WrappedError {
    constructor(originalException: Error) {
        super(originalException.message, originalException);
        sendTelemetryEvent(Telemetry.StartSessionFailedJupyter, undefined, undefined, originalException, true);
    }
}

```

</details>
<details>
  <summary>DS_INTERNAL.SWITCH_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/vscodeNotebookController.ts:{"line":357,"character":57}
```typescript
            // We don't know as its the default kernel on Jupyter server.
        }
        trackKernelResourceInformation(document.uri, { kernelConnection: this.connection });
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
```

</details>
<details>
  <summary>DS_INTERNAL.SWITCH_TO_EXISTING_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/common.ts:{"line":167,"character":30}
```typescript
}

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language?: string
) {
    language = getTelemetrySafeLanguage(language);
```

src/client/datascience/notebook/vscodeNotebookController.ts:{"line":339,"character":64}
```typescript
        }
        switch (this.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
```

src/client/datascience/notebook/vscodeNotebookController.ts:{"line":343,"character":30}
```typescript
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelModel.language
                );
                break;
```

src/client/datascience/notebook/vscodeNotebookController.ts:{"line":349,"character":30}
```typescript
                break;
            case 'startUsingKernelSpec':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelSpec.language
                );
                break;
```

</details>
<details>
  <summary>DS_INTERNAL.SWITCH_TO_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.SYNC_ALL_CELLS</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.SYNC_SINGLE_CELL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.USE_EXISTING_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.USE_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


## Locations Used
</details>
<details>
  <summary>DS_INTERNAL.VARIABLE_EXPLORER_FETCH_TIME</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterVariables.ts:{"line":43,"character":32}
```typescript
    }

    // IJupyterVariables implementation
    @captureTelemetry(Telemetry.VariableExplorerFetchTime, undefined, true)
    public async getVariables(
        request: IJupyterVariablesRequest,
        notebook?: INotebook
```

</details>
<details>
  <summary>DS_INTERNAL.VARIABLE_EXPLORER_VARIABLE_COUNT</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/variablesView/variableView.ts:{"line":188,"character":41}
```typescript
            const response = await this.variables.getVariables(args, activeNotebook);

            this.postMessage(InteractiveWindowMessages.GetVariablesResponse, response).ignoreErrors();
            sendTelemetryEvent(Telemetry.VariableExplorerVariableCount, undefined, {
                variableCount: response.totalCount
            });
        } else {
```

</details>
<details>
  <summary>DS_INTERNAL.VSCNOTEBOOK_CELL_TRANSLATION_FAILED</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/notebook/helpers/helpers.ts:{"line":724,"character":41}
```typescript
            // Unless we already know its an unknown output type.
            const outputType: nbformat.OutputType =
                <nbformat.OutputType>customMetadata?.outputType || (isStream ? 'stream' : 'display_data');
            sendTelemetryEvent(Telemetry.VSCNotebookCellTranslationFailed, undefined, {
                isErrorOutput: outputType === 'error'
            });

```

</details>
<details>
  <summary>DS_INTERNAL.WAIT_FOR_IDLE_JUPYTER</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/jupyter/jupyterSession.ts:{"line":53,"character":32}
```typescript
    }

    @reportAction(ReportableAction.JupyterSessionWaitForIdleSession)
    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
```

</details>
<details>
  <summary>DS_INTERNAL.WEBVIEW_STARTUP</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/webviews/webviewHost.ts:{"line":298,"character":41}
```typescript
    protected webViewRendered() {
        if (this.webviewInit && !this.webviewInit.resolved) {
            // Send telemetry for startup
            sendTelemetryEvent(Telemetry.WebviewStartup, this.startupStopwatch.elapsedTime, { type: this.title });

            // Resolve our started promise. This means the webpanel is ready to go.
            this.webviewInit.resolve();
```

</details>
<details>
  <summary>DS_INTERNAL.WEBVIEW_STYLE_UPDATE</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/webviews/webviewHost.ts:{"line":316,"character":32}
```typescript
        this.dispose();
    };

    @captureTelemetry(Telemetry.WebviewStyleUpdate)
    private async handleCssRequest(request: IGetCssRequest): Promise<void> {
        const settings = await this.generateDataScienceExtraSettings();
        const requestIsDark = settings.ignoreVscodeTheme ? false : request?.isDark;
```

</details>
<details>
  <summary>DS_INTERNAL.ZMQ_NATIVE_BINARIES_LOADING</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawNotebookSupportedService.ts:{"line":57,"character":41}
```typescript
        try {
            require('zeromq');
            traceInfo(`ZMQ install verified.`);
            sendTelemetryEvent(Telemetry.ZMQSupported);
            this._isSupported = true;
        } catch (e) {
            traceError(`Exception while attempting zmq :`, e);
```

</details>
<details>
  <summary>DS_INTERNAL.ZMQ_NATIVE_BINARIES_NOT_LOADING</summary>

## Description


No description provided

## Properties


## Locations Used
src/client/datascience/raw-kernel/rawNotebookSupportedService.ts:{"line":61,"character":41}
```typescript
            this._isSupported = true;
        } catch (e) {
            traceError(`Exception while attempting zmq :`, e);
            sendTelemetryEvent(Telemetry.ZMQNotSupported);
            this._isSupported = false;
        }

```

</details>
