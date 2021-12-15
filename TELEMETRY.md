# Telemetry created by Jupyter Extension

Expand each section to see more information about that event.

<details>
  <summary>DATASCIENCE.ADD_CELL_BELOW</summary>

## Description



 Data Science

## Properties


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L382](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L382)
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

-  format: ExportFormat

## Locations Used

[src/client/datascience/commands/exportCommands.ts#L125](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/exportCommands.ts#L125)
```typescript
            if (pickedItem !== undefined) {
                pickedItem.handler();
            } else {
                sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick);
            }
        }
    }
```


[src/client/datascience/commands/exportCommands.ts#L141](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/exportCommands.ts#L141)
```typescript
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    void this.commandManager.executeCommand(Commands.ExportAsPythonScript, sourceDocument, interpreter);
```


[src/client/datascience/commands/exportCommands.ts#L155](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/exportCommands.ts#L155)
```typescript
                    label: DataScience.exportHTMLQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.html
                        });
                        void this.commandManager.executeCommand(
```


[src/client/datascience/commands/exportCommands.ts#L170](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/exportCommands.ts#L170)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.COPY_SOURCE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.CREATE_NEW_INTERACTIVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L368](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L368)
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




 Telemetry event sent when a slice is first applied in a
 data viewer instance to a sliceable Python variable.

## Properties


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewer.ts#L314](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L314)
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




 Telemetry event sent whenever the user toggles the checkbox
 controlling whether a slice is currently being applied to an
 n-dimensional variable.

## Properties


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewer.ts#L197](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L197)
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




 Telemetry event sent whenever the user applies a valid slice
 to a sliceable Python variable in the data viewer.

## Properties


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewer.ts#L258](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L258)
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


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L374](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L374)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L120](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L120)
```typescript
        return this.codeLenses;
    }

    @captureTelemetry(Telemetry.DebugCurrentCell)
    public async debugCurrentCell() {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```


[src/client/datascience/editor-integration/codewatcher.ts#L316](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L316)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L185](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L185)
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


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L348](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L348)
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


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L356](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L356)
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugStop)
    private async debugStop(uri: Uri): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/debugger/jupyter/debuggingManager.ts#L464](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L464)
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


No properties for event


## Locations Used

[src/client/debugger/jupyter/debuggingManager.ts#L162](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L162)
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


No properties for event


## Locations Used

[src/client/debugger/jupyter/debuggingManager.ts#L109](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L109)
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


No properties for event


## Locations Used

[src/client/debugger/jupyter/debuggingManager.ts#L469](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L469)
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

-
        reason: 'normally' | 'onKernelDisposed' | 'onAnInterrupt' | 'onARestart' | 'withKeybinding';

## Locations Used

[src/client/debugger/jupyter/kernelDebugAdapter.ts#L89](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/kernelDebugAdapter.ts#L89)
```typescript
        if (this.kernel) {
            this.disposables.push(
                this.kernel.onWillRestart(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onARestart' });
                    this.disconnect();
                })
            );
```


[src/client/debugger/jupyter/kernelDebugAdapter.ts#L95](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/kernelDebugAdapter.ts#L95)
```typescript
            );
            this.disposables.push(
                this.kernel.onWillInterrupt(() => {
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onAnInterrupt' });
                    this.disconnect();
                })
            );
```


[src/client/debugger/jupyter/kernelDebugAdapter.ts#L103](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/kernelDebugAdapter.ts#L103)
```typescript
                this.kernel.onDisposed(() => {
                    void debug.stopDebugging(this.session);
                    this.endSession.fire(this.session);
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onKernelDisposed' });
                })
            );
        }
```


[src/client/debugger/jupyter/kernelDebugAdapter.ts#L117](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/kernelDebugAdapter.ts#L117)
```typescript
                        cellStateChange.state === NotebookCellExecutionState.Idle &&
                        !this.disconected
                    ) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'normally' });
                        this.disconnect();
                    }
                },
```


[src/client/debugger/jupyter/debuggingManager.ts#L153](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L153)
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

-
        status: 'installed' | 'notInstalled';

## Locations Used

[src/client/debugger/jupyter/debuggingManager.ts#L443](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debuggingManager.ts#L443)
```typescript
            }

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


No properties for event


## Locations Used

[src/client/debugger/jupyter/debugControllers.ts#L25](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debugControllers.ts#L25)
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


No properties for event


## Locations Used

[src/client/debugger/jupyter/debugControllers.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/debugger/jupyter/debugControllers.ts#L54)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_INSTALL_FAILED</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_PROMPT_TO_INSTALL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DEBUGPY_SUCCESSFULLY_INSTALLED</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DELETE_ALL_CELLS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DELETE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/shiftEnterBanner.ts#L103](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/shiftEnterBanner.ts#L103)
```typescript
        );
    }

    @captureTelemetry(Telemetry.DisableInteractiveShiftEnter)
    public async disableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L115](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L115)
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


No properties for event


## Locations Used

[src/client/datascience/shiftEnterBanner.ts#L114](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/shiftEnterBanner.ts#L114)
```typescript
        await this.disableBanner();
    }

    @captureTelemetry(Telemetry.EnableInteractiveShiftEnter)
    public async enableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L70](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L70)
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



 Applies to everything (interactive+Notebooks & local+remote)

## Properties


No properties for event


## Locations Used

[src/client/datascience/telemetry/telemetry.ts#L79](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L79)
```typescript
    properties?: P[E] & { waitBeforeSending?: Promise<void> },
    ex?: Error
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }

```


[src/client/datascience/telemetry/telemetry.ts#L116](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L116)
```typescript
    stopWatch?: StopWatch,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> }
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
```


[src/client/datascience/notebook/vscodeNotebookController.ts#L187](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L187)
```typescript
            return;
        }
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, this.connection);
        sendKernelTelemetryEvent(notebook.uri, Telemetry.ExecuteCell);
        // Notebook is trusted. Continue to execute cells
        traceInfo(`Execute Cells request ${cells.length} ${cells.map((cell) => cell.index).join(', ')}`);
        await Promise.all(cells.map((cell) => this.executeCell(notebook, cell)));
```


[src/client/datascience/jupyter/kernels/kernel.ts#L174](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L174)
```typescript
    }
    private perceivedJupyterStartupTelemetryCaptured?: boolean;
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startNotebook().then((nb) => nb.session);
        const promise = this.kernelExecution.executeCell(sessionPromise, cell);
```

</details>
<details>
  <summary>DATASCIENCE.EXECUTE_CELL_TIME</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.EXPAND_ALL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK_AS</summary>

## Description


No description provided

## Properties

-  format: ExportFormat;
-  cancelled?: boolean;
-  successful?: boolean;
-  opened?: boolean

## Locations Used

[src/client/datascience/export/exportFileOpener.ts#L25](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/export/exportFileOpener.ts#L25)
```typescript
    public async openFile(format: ExportFormat, uri: Uri) {
        if (format === ExportFormat.python) {
            await this.openPythonFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: true
```


[src/client/datascience/export/exportFileOpener.ts#L32](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/export/exportFileOpener.ts#L32)
```typescript
            });
        } else {
            const opened = await this.askOpenFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: opened
```


[src/client/datascience/export/fileConverter.ts#L107](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/export/fileConverter.ts#L107)
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

-  format: ExportFormat

## Locations Used

[src/client/datascience/commands/exportCommands.ts#L110](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/exportCommands.ts#L110)
```typescript
                this.controllers.getSelectedNotebookController(sourceDocument)?.connection.interpreter ||
                this.controllers.getPreferredNotebookController(sourceDocument)?.connection.interpreter;
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

-  format: ExportFormat

## Locations Used

[src/client/datascience/export/fileConverter.ts#L68](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/export/fileConverter.ts#L68)
```typescript
            await this.performExport(format, sourceDocument, target, candidateInterpreter);
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


No properties for event


## Locations Used

[src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L215](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L215)
```typescript
        return result;
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


No properties for event


## Locations Used

[src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L263](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L263)
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


No properties for event


## Locations Used

[src/client/datascience/variablesView/variableView.ts#L179](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/variablesView/variableView.ts#L179)
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



 Telemetry sent when we fail to create a Notebook Controller (an entry for the UI kernel list in Native Notebooks).

## Properties


No properties for event


## Locations Used

[src/client/datascience/notebook/notebookControllerManager.ts#L588](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/notebookControllerManager.ts#L588)
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




 Telemetry sent when we're unable to find a KernelSpec connection for Interactive window that can be started usig Python interpreter.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/helpers.ts#L438](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/helpers.ts#L438)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterPasswordConnect.ts#L30](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterPasswordConnect.ts#L30)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L679](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L679)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L696](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L696)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.IMPORT_NOTEBOOK</summary>

## Description


No description provided

## Properties

-  scope: 'command' | 'file'

## Locations Used

[src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L383](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L383)
```typescript
        return this.statusProvider.waitWithStatus(promise, message, undefined, canceled);
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'command' }, false)
    private async importNotebook(): Promise<void> {
        const filtersKey = localize.DataScience.importDialogFilter();
        const filtersObject: { [name: string]: string[] } = {};
```


[src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L407](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-window/interactiveWindowCommandListener.ts#L407)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernelExecution.ts#L177](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L177)
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

-
        where: 'activeInterpreter' | 'otherInterpreter' | 'path' | 'nowhere';
-
        command: JupyterCommands;

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L144](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L144)
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
  <summary>DATASCIENCE.NATIVE.CONVERT_NOTEBOOK_TO_PYTHON</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.CREATE_NEW_NOTEBOOK</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/notebook/notebookEditorProvider.ts#L31](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/notebookEditorProvider.ts#L31)
```typescript
        const nb = await this.vscodeNotebook.openNotebookDocument(file);
        await this.vscodeNotebook.showNotebookDocument(nb);
    }
    @captureTelemetry(Telemetry.CreateNewNotebook, undefined, false)
    public async createNew(options?: { contents?: string; defaultCellLanguage: string }): Promise<void> {
        // contents will be ignored
        const language = options?.defaultCellLanguage ?? PYTHON_LANGUAGE;
```

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.ARROW_DOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.ARROW_UP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.DELETE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.INSERT_ABOVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.INSERT_BELOW</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.REDO</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_ADD</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.RUN_AND_MOVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.SAVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_LINE_NUMBERS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.TOGGLE_OUTPUT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.UNDO</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.KEYBOARD.UNFOCUS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.ADD_TO_END</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.DELETE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.INSERT_BELOW</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_DOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.MOVE_CELL_UP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_ABOVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_ALL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.RUN_BELOW</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SAVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SELECT_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.SELECT_SERVER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.MOUSE.TOGGLE_VARIABLE_EXPLORER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK</summary>

## Description


No description provided

## Properties

-  scope: 'command' | 'file'

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/activation.ts#L52](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/activation.ts#L52)
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




 Telemetry sent with details of the selection of the quick pick for when user creates new notebook.
 This only applies with other extensions like .NET registers with us.

## Properties


No properties for event


## Locations Used

[src/client/datascience/notebook/creation/notebookCreator.ts#L53](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/creation/notebookCreator.ts#L53)
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

-
        /**
         * The id of the extension registering with us to be displayed the dropdown list for notebook creation.
         */
        extensionId: string;

## Locations Used

[src/client/datascience/notebook/creation/creationOptionsService.ts#L21](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/creation/creationOptionsService.ts#L21)
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


No properties for event


## Locations Used

[src/client/datascience/telemetry/telemetry.ts#L363](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L363)
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
```


[src/client/datascience/telemetry/telemetry.ts#L364](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L364)
```typescript
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
```


[src/client/datascience/telemetry/telemetry.ts#L365](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L365)
```typescript
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
            clearInterruptCounter(resource);
```


[src/client/datascience/jupyter/kernels/kernelExecution.ts#L233](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L233)
```typescript
                // Otherwise a real error occurred.
                sendKernelTelemetryEvent(
                    this.kernel.resourceUri,
                    Telemetry.NotebookInterrupt,
                    stopWatch.elapsedTime,
                    undefined,
                    exc
```


[src/client/datascience/jupyter/kernels/kernelExecution.ts#L245](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L245)
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




 Telemetry event sent to indicate the language used in a notebook

 @type { language: string }
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/common.ts#L171](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/common.ts#L171)
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


No properties for event


## Locations Used

[src/client/datascience/telemetry/telemetry.ts#L372](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L372)
```typescript
        }
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
```


[src/client/datascience/telemetry/telemetry.ts#L373](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L373)
```typescript
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
```


[src/client/datascience/telemetry/telemetry.ts#L374](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L374)
```typescript
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
        if (!failed) {
```


[src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L174](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L174)
```typescript
        const stopWatch = new StopWatch();
        try {
            await kernel.restart();
            sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (exc) {
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
```


[src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L180](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L180)
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


No properties for event


## Locations Used

[src/client/datascience/telemetry/telemetry.ts#L405](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L405)
```typescript
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
```


[src/client/datascience/telemetry/telemetry.ts#L406](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L406)
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
```


[src/client/datascience/telemetry/telemetry.ts#L407](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/telemetry.ts#L407)
```typescript
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
            trackKernelResourceInformation(resource, { startFailed: true });
```


[src/client/datascience/jupyter/kernels/kernel.ts#L349](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L349)
```typescript
                } catch (ex) {
                    sendKernelTelemetryEvent(
                        this.resourceUri,
                        Telemetry.NotebookStart,
                        stopWatch.elapsedTime,
                        undefined,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
```


[src/client/datascience/interactive-common/notebookProvider.ts#L115](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookProvider.ts#L115)
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


No properties for event


## Locations Used

[src/client/datascience/plotting/plotViewerProvider.ts#L46](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/plotting/plotViewerProvider.ts#L46)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RECOMMENT_EXTENSION</summary>

## Description



 Telemetry sent when we recommend installing an extension.

## Properties

-
        /**
         * Extension we recommended the user to install.
         */
        extensionId: string;
-
        /**
         * `displayed` - If prompt was displayed
         * `dismissed` - If prompt was displayed & dismissed by the user
         * `ok` - If prompt was displayed & ok clicked by the user
         * `cancel` - If prompt was displayed & cancel clicked by the user
         * `doNotShowAgain` - If prompt was displayed & doNotShowAgain clicked by the user
         */
        action: 'displayed' | 'dismissed' | 'ok' | 'cancel' | 'doNotShowAgain';

## Locations Used

[src/client/datascience/extensionRecommendation.ts#L117](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/extensionRecommendation.ts#L117)
```typescript
            `[${extensionInfo.displayName}](${extensionInfo.extensionLink})`,
            language
        );
        sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'displayed' });
        const selection = await this.appShell.showInformationMessage(
            message,
            Common.bannerLabelYes(),
```


[src/client/datascience/extensionRecommendation.ts#L126](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/extensionRecommendation.ts#L126)
```typescript
        );
        switch (selection) {
            case Common.bannerLabelYes(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'ok' });
                this.commandManager.executeCommand('extension.open', extensionId).then(noop, noop);
                break;
            }
```


[src/client/datascience/extensionRecommendation.ts#L131](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/extensionRecommendation.ts#L131)
```typescript
                break;
            }
            case Common.bannerLabelNo(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'cancel' });
                break;
            }
            case Common.doNotShowAgain(): {
```


[src/client/datascience/extensionRecommendation.ts#L135](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/extensionRecommendation.ts#L135)
```typescript
                break;
            }
            case Common.doNotShowAgain(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'doNotShowAgain' });
                const list = this.globalMemento.get<string[]>(mementoKeyToNeverPromptExtensionAgain, []);
                if (!list.includes(extensionId)) {
                    list.push(extensionId);
```


[src/client/datascience/extensionRecommendation.ts#L144](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/extensionRecommendation.ts#L144)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.REFRESH_DATA_VIEWER</summary>

## Description




 Sent when the jupyter.refreshDataViewer command is invoked

## Properties


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewer.ts#L193](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L193)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L127](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelCommandListener.ts#L127)
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




 Misc

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RUN_ALL_CELLS</summary>

## Description




 Run Cell Commands in Interactive Python

## Properties


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L134](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L134)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L191](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L191)
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



 Run by line events

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_STEP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_STOP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RUN_BY_LINE_VARIABLE_HOVER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/debuggerVariables.ts#L125](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/debuggerVariables.ts#L125)
```typescript
            // Note, full variable results isn't necessary for this call. It only really needs the variable value.
            const result = this.lastKnownVariables.find((v) => v.name === name);
            if (result && kernel?.notebookDocument.uri.fsPath.endsWith('.ipynb')) {
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L303](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L303)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L229](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L229)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L672](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L672)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L665](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L665)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L326](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L326)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L354](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L354)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L336](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L336)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L429](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L429)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L521](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L521)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L587](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L587)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L180](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L180)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L289](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L289)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L416](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L416)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L403](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L403)
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




 Cell Edit Commands in Interactive Python

## Properties


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L395](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L395)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L660](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L660)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L655](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L655)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L466](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L466)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L483](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L483)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L254](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L254)
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


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codewatcher.ts#L275](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L275)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.SCROLLED_TO_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.SELECT_JUPYTER_INTERPRETER_Command</summary>

## Description




 Telemetry sent when user selects an interpreter to start jupyter server.

 @type {(never | undefined)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterSelectionCommand.ts#L24](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterSelectionCommand.ts#L24)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/commandLineSelector.ts#L36](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/commandLineSelector.ts#L36)
```typescript
        workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    }

    @captureTelemetry(Telemetry.SelectJupyterURI)
    public selectJupyterCommandLine(file: Uri): Promise<void> {
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingCommandLine.bind(this, file), {});
```


[src/client/datascience/jupyter/serverSelector.ts#L56](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/serverSelector.ts#L56)
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


No properties for event


## Locations Used

[src/client/datascience/notebook/vscodeNotebookController.ts#L393](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L393)
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


No properties for event


## Locations Used

[src/client/datascience/notebook/vscodeNotebookController.ts#L394](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L394)
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


No properties for event


## Locations Used

[src/client/datascience/interactive-common/notebookServerProvider.ts#L153](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookServerProvider.ts#L153)
```typescript
                                )
                                .ignoreErrors();
                        } else if (value === closeOption) {
                            sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                        }
                    })
                    .then(noop, noop);
```


[src/client/datascience/jupyter/jupyterPasswordConnect.ts#L377](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterPasswordConnect.ts#L377)
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


No properties for event


## Locations Used

[src/client/datascience/interactive-common/notebookServerProvider.ts#L143](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookServerProvider.ts#L143)
```typescript
                    )
                    .then((value) => {
                        if (value === enableOption) {
                            sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                            this.configuration
                                .updateSetting(
                                    'allowUnauthorizedRemoteConnection',
```


[src/client/datascience/jupyter/jupyterPasswordConnect.ts#L368](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterPasswordConnect.ts#L368)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/serverSelector.ts#L68](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/serverSelector.ts#L68)
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




 This telemetry tracks the display of the Picker for Jupyter Remote servers.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/serverSelector.ts#L62](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/serverSelector.ts#L62)
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

-
        azure: boolean;

## Locations Used

[src/client/datascience/jupyter/serverSelector.ts#L86](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/serverSelector.ts#L86)
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

-  rows: number | undefined;
-  columns: number | undefined

## Locations Used

[src/client/datascience/data-viewing/dataViewer.ts#L226](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L226)
```typescript

        // Log telemetry about number of rows
        try {
            sendTelemetryEvent(Telemetry.ShowDataViewer, 0, {
                rows: output.rowCount ? output.rowCount : 0,
                columns: output.columns ? output.columns.length : 0
            });
```


[src/client/datascience/data-viewing/dataViewer.ts#L308](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewer.ts#L308)
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


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewerFactory.ts#L41](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerFactory.ts#L41)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.UNDO</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L193](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L193)
```typescript
            }

            case DataScience.selectDifferentJupyterInterpreter(): {
                sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                return JupyterInterpreterDependencyResponse.selectAnotherInterpreter;
            }

```


[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L199](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L199)
```typescript

            case DataScience.pythonInteractiveHelpLink(): {
                this.applicationShell.openUrl(HelpLinks.PythonInteractiveHelpLink);
                sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                return JupyterInterpreterDependencyResponse.cancel;
            }

```


[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L204](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L204)
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


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewerDependencyService.ts#L108](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerDependencyService.ts#L108)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L186](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L186)
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




 Telemetry event sent when installing a jupyter dependency

 @type {product: string}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.USER_INSTALLED_PANDAS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewerDependencyService.ts#L105](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerDependencyService.ts#L105)
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

-  open: boolean;
-  runByLine: boolean

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.CHANGE_TO_CODE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.CHANGE_TO_MARKDOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.DELETE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.INSERT_CELL</summary>

## Description



 Native notebooks events

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.VSCODE_NATIVE.MOVE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.ACTIVE_INTERPRETER_LISTING_PERF</summary>

## Description


No description provided

## Properties

-
        /**
         * Whether this is the first time in the session.
         * (fetching kernels first time in the session is slower, later its cached).
         * This is a generic property supported for all telemetry (sent by decorators).
         */
        firstTime?: boolean;

## Locations Used

[src/client/api/pythonApi.ts#L364](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L364)
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




 Sent when a jupyter session fails to start and we ask the user for a new kernel

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.CELL_COUNT</summary>

## Description


No description provided

## Properties

-  count: number

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.CODE_LENS_ACQ_TIME</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/editor-integration/codelensprovider.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codelensprovider.ts#L54)
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




 Telemetry sent when a command is executed.

## Properties


No properties for event


## Locations Used

[src/client/common/application/commandManager.ts#L37](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/application/commandManager.ts#L37)
```typescript
        return commands.registerCommand(
            command,
            (...args: U) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, ...(args as any));
                } else {
```


[src/client/common/application/commandManager.ts#L71](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/application/commandManager.ts#L71)
```typescript
        return commands.registerTextEditorCommand(
            command,
            (textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, textEditor, edit, ...args);
                } else {
```


[src/client/common/application/commandManager.ts#L102](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/application/commandManager.ts#L102)
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




 Telemetry event sent to capture total time taken for completions list to be provided by Jupyter.
 This is used to compare against time taken by LS.

 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.COMPLETION_TIME_FROM_LS</summary>

## Description




 Telemetry event sent to capture total time taken for completions list to be provided by LS.
 This is used to compare against time taken by Jupyter.

 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.CONNECTFAILEDJUPYTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L204](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L204)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L161](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L161)
```typescript
                    traceInfo(`Connection complete for ${options ? options.purpose : 'unknown type of'} server`);

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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L188](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L188)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L161](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L161)
```typescript
                    traceInfo(`Connection complete for ${options ? options.purpose : 'unknown type of'} server`);

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




 Connecting to an existing Jupyter server, but connecting to localhost.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L142](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L142)
```typescript
                    connection = await this.startOrConnect(options, cancelToken);

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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L192](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L192)
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



 Whether we've attempted to start a raw Python kernel without any interpreter information.
 If we don't detect such telemetry in a few months, then we can remove this along with the temporary code associated with this telemetry.

## Properties

-
        /**
         * Indicates whether the python extension is installed.
         * If we send telemetry fro this & this is `true`, then we have a bug.
         * If its `false`, then we can ignore this telemetry.
         */
        pythonExtensionInstalled: boolean;

## Locations Used

[src/client/datascience/raw-kernel/liveshare/hostRawNotebookProvider.ts#L86](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/liveshare/hostRawNotebookProvider.ts#L86)
```typescript
                kernelConnection.kind === 'startUsingLocalKernelSpec'
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




 Telemetry sent to capture first time execution of a cell.
 If `notebook = true`, this its telemetry for native editor/notebooks.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/cellExecution.ts#L419](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/cellExecution.ts#L419)
```typescript
        const props = { notebook: true };
        if (!CellExecution.sentExecuteCellTelemetry) {
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatch.elapsedTime, props);
        }
```


[src/client/datascience/editor-integration/codewatcher.ts#L1026](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L1026)
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




 Telemetry sent to capture subsequent execution of a cell.
 If `notebook = true`, this its telemetry for native editor/notebooks.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/cellExecution.ts#L421](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/cellExecution.ts#L421)
```typescript
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatch.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatch.elapsedTime, props);
        }
    }
    private canExecuteCell() {
```


[src/client/datascience/editor-integration/codewatcher.ts#L1028](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/codewatcher.ts#L1028)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L170](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L170)
```typescript
            await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any, true);
            throw ex;
        }
        if (cancelToken?.isCancellationRequested) {
```


[src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L269](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L269)
```typescript
                    await this.fs.writeLocalFile(kernelSpecFilePath, JSON.stringify(specModel, undefined, 2));
                } catch (ex) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any, true);
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

-  command: string

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.FIND_JUPYTER_KERNEL_SPEC</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.FIND_KERNEL_FOR_LOCAL_CONNECTION</summary>

## Description




 Telemetry event sent once done searching for kernel spec and interpreter for a local connection.

 @type {{
         kernelSpecFound: boolean;
         interpreterFound: boolean;
     }}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.GET_ACTIVATED_ENV_VARIABLES</summary>

## Description




 Used to capture time taken to get enviornment variables for a python environment.
 Also lets us know whether it worked or not.

## Properties


No properties for event


## Locations Used

[src/client/api/pythonApi.ts#L306](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L306)
```typescript
            .then((api) => api.getActivatedEnvironmentVariables(resource, interpreter, false));

        const envType = interpreter?.envType;
        sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
            envType,
            failed: Object.keys(env || {}).length === 0
        });
```

</details>
<details>
  <summary>DS_INTERNAL.GET_PASSWORD_FAILURE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterPasswordConnect.ts#L252](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterPasswordConnect.ts#L252)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterPasswordConnect.ts#L247](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterPasswordConnect.ts#L247)
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




 Total time taken to get the preferred kernel for notebook.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.HASHED_NOTEBOOK_OUTPUT_MIME_TYPE_PERF</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.HASHED_OUTPUT_MIME_TYPE</summary>

## Description


No description provided

## Properties

-
        /**
         * Hash of the cell output mimetype
         *
         * @type {string}
         */
        hashedName: string;
-
        hasText: boolean;
-
        hasLatex: boolean;
-
        hasHtml: boolean;
-
        hasSvg: boolean;
-
        hasXml: boolean;
-
        hasJson: boolean;
-
        hasImage: boolean;
-
        hasGeo: boolean;
-
        hasPlotly: boolean;
-
        hasVega: boolean;
-
        hasWidget: boolean;
-
        hasJupyter: boolean;
-
        hasVnd: boolean;

## Locations Used

[src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts#L153](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts#L153)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts#L119](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterCellOutputMimeTypeTracker.ts#L119)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.INTERACTIVE_FILE_TOOLTIPS_PERF</summary>

## Description



 Capture telemetry re: how long returning a tooltip takes

## Properties

-
        // Result is null if user signalled cancellation or if we timed out
        isResultNull: boolean;

## Locations Used

[src/client/datascience/editor-integration/hoverProvider.ts#L79](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/editor-integration/hoverProvider.ts#L79)
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




 Time taken to list the Python interpreters.

## Properties


No properties for event


## Locations Used

[src/client/api/pythonApi.ts#L353](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L353)
```typescript
        return this.didChangeInterpreters.event;
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernelExecution.ts#L178](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L178)
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




 Telemetry event sent when a kernel picked crashes on startup
 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterInvalidKernelError.ts#L19](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterInvalidKernelError.ts#L19)
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




 Telemetry event sent with name of a Widget found.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_DISCOVERY_ERRORED</summary>

## Description




 Something went wrong in looking for a widget.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/ipyWidgetScriptSource.ts#L221](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/ipyWidgetScriptSource.ts#L221)
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




 Telemetry event sent when an loading of 3rd party ipywidget JS scripts from 3rd party source has been disabled.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_LOAD_FAILURE</summary>

## Description




 Telemetry event sent when an ipywidget module fails to load. Module name is hashed.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L163](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L163)
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




 Telemetry event sent when an ipywidget module loads. Module name is hashed.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L123](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L123)
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




 Telemetry event sent to indicate the overhead of syncing the kernel with the UI.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/ipyWidgetMessageDispatcher.ts#L494](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/ipyWidgetMessageDispatcher.ts#L494)
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




 Telemetry sent when we prompt user to use a CDN for IPyWidget scripts.
 This is always sent when we display a prompt.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L205](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L205)
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




 Telemetry sent when user does something with the prompt displayed to user about using CDN for IPyWidget scripts.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L235](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L235)
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




 Telemetry event sent when the widget render function fails (note, this may not be sufficient to capture all failures).

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L186](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L186)
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




 Total time taken to discover a widget script on CDN.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.IPYWIDGET_TEST_AVAILABILITY_ON_LOCAL</summary>

## Description




 Total time taken to discover all IPyWidgets on disc.
 This is how long it takes to discover a single widget on disc (from python environment).

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/localWidgetScriptSourceProvider.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/localWidgetScriptSourceProvider.ts#L54)
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




 Telemetry event sent when the widget tries to send a kernel message but nothing was listening

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L205](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L205)
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




 Telemetry event sent with name of a Widget that is used.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L108](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/ipyWidgetScriptSourceProvider.ts#L108)
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




 Telemetry event sent when an ipywidget version that is not supported is used & we have trapped this and warned the user abou it.

## Properties


No properties for event


## Locations Used

[src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L175](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/ipywidgets/commonMessageCoordinator.ts#L175)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/liveshare/hostJupyterServer.ts#L230](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/liveshare/hostJupyterServer.ts#L230)
```typescript
            );
            const baseUrl = this.launchInfo?.connectionInfo.baseUrl || '';
            this.logRemoteOutput(localize.DataScience.createdNewNotebook().format(baseUrl));
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return notebook;
        } catch (ex) {
            sendKernelTelemetryEvent(
```


[src/client/datascience/jupyter/liveshare/hostJupyterServer.ts#L235](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/liveshare/hostJupyterServer.ts#L235)
```typescript
        } catch (ex) {
            sendKernelTelemetryEvent(
                resource,
                Telemetry.JupyterCreatingNotebook,
                stopWatch.elapsedTime,
                undefined,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_CUSTOM_COMMAND_LINE</summary>

## Description




 Telemetry event sent to when user customizes the jupyter command line
 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/commandLineSelector.ts#L93](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/commandLineSelector.ts#L93)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterWaitForIdleError.ts#L12](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterWaitForIdleError.ts#L12)
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




 Telemetry event sent if there's an error installing a jupyter required dependency

 @type { product: string }
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.JUPYTER_INTALLED_BUT_NO_KERNELSPEC_MODULE</summary>

## Description




 Telemetry event sent when jupyter has been found in interpreter but we cannot find kernelspec.

 @type {(never | undefined)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L310](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L310)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L121](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L121)
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

-
        /**
         * Total time spent in attempting to start and connect to jupyter before giving up.
         *
         * @type {number}
         */
        timeout: number;

## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L221](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L221)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterExecution.ts#L283](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterExecution.ts#L283)
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



 Misc

## Properties


No properties for event


## Locations Used

[src/client/datascience/telemetry/kernelTelemetry.ts#L53](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/telemetry/kernelTelemetry.ts#L53)
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




 Telemetry event sent to every time a kernel enumeration is done

 @type {...}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_FINDER_PERF</summary>

## Description




 Total time taken to find a kernel on disc or on a remote machine.

## Properties


No properties for event


## Locations Used

[src/client/datascience/kernel-launcher/localKernelFinder.ts#L52](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localKernelFinder.ts#L52)
```typescript
        @inject(IFileSystem) private readonly fs: IFileSystem
    ) {}
    @traceDecorators.verbose('Find kernel spec')
    @captureTelemetry(Telemetry.KernelFinderPerf)
    public async findKernel(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
```


[src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L56](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L56)
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




 Total time taken to Launch a raw kernel.

## Properties


No properties for event


## Locations Used

[src/client/datascience/kernel-launcher/kernelLauncher.ts#L118](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/kernelLauncher.ts#L118)
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

-
        /**
         * Whether this is the first time in the session.
         * (fetching kernels first time in the session is slower, later its cached).
         * This is a generic property supported for all telemetry (sent by decorators).
         */
        firstTime?: boolean;
-
        /**
         * Whether this telemetry is for listing of all kernels or just python or just non-python.
         * (fetching kernels first time in the session is slower, later its cached).
         */
        kind: 'remote' | 'local' | 'localKernelSpec' | 'localPython';

## Locations Used

[src/client/datascience/kernel-launcher/localKnownPathKernelSpecFinder.ts#L64](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localKnownPathKernelSpecFinder.ts#L64)
```typescript
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    public async listKernelSpecs(
        includePythonKernels: boolean,
        cancelToken?: CancellationToken
```


[src/client/datascience/kernel-launcher/localPythonAndRelatedNonPythonKernelSpecFinder.ts#L50](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localPythonAndRelatedNonPythonKernelSpecFinder.ts#L50)
```typescript
    ) {
        super(fs, workspaceService, extensionChecker);
    }
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    public async listKernelSpecs(resource: Resource, ignoreCache?: boolean, cancelToken?: CancellationToken) {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId =
```


[src/client/datascience/kernel-launcher/localKernelFinder.ts#L153](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localKernelFinder.ts#L153)
```typescript
        return this.jupyterPaths.getKernelSpecRootPath();
    }

    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    private async listKernelsWithoutCache(
        resource: Resource,
        cancelToken?: CancellationToken
```


[src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L57](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L57)
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

-
        action: 'displayed';
-  // Message displayed.
        /**
         * Language found in the notebook if a known language. Otherwise 'unknown'
         */
        language: string;

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_PROVIDER_PERF</summary>

## Description




 Total time taken to list kernels for VS Code.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_REGISTER_FAILED</summary>

## Description




 Telemetry event sent to indicate registering a kernel with jupyter failed.

 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_SPEC_NOT_FOUND</summary>

## Description




 Telemetry event sent to indicate 'jupyter kernelspec' is not possible.

 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L286](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L286)
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

-
        /**
         * Number of kernel specs.
         */
        count: number;

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.NATIVE_VARIABLE_VIEW_LOADED</summary>

## Description



 Native variable view events

## Properties


No properties for event


## Locations Used

[src/client/datascience/variablesView/variableView.ts#L89](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/variablesView/variableView.ts#L89)
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


No properties for event


## Locations Used

[src/client/datascience/variablesView/variableView.ts#L148](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/variablesView/variableView.ts#L148)
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

-  count: number

## Locations Used

[src/client/datascience/interactive-common/notebookUsageTracker.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookUsageTracker.ts#L54)
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.NATIVE.NOTEBOOK_RUN_COUNT</summary>

## Description


No description provided

## Properties

-  count: number

## Locations Used

[src/client/datascience/interactive-common/notebookUsageTracker.ts#L57](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookUsageTracker.ts#L57)
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




 Telemetry event fired if a failure occurs loading a notebook

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.NATIVE.WORKSPACE_NOTEBOOK_COUNT</summary>

## Description


No description provided

## Properties

-  count: number

## Locations Used

[src/client/datascience/interactive-common/notebookUsageTracker.ts#L62](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/interactive-common/notebookUsageTracker.ts#L62)
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




 Telemetry event sent when a user runs the interactive window with a new file
 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.NUMBER_OF_REMOTE_KERNEL_IDS_SAVED</summary>

## Description



 When users connect to a remote kernel, we store the kernel id so we can re-connect to that
 when user opens the same notebook. We only store the last 100.
 Count is the number of entries saved in the list.

## Properties

-  count: number

## Locations Used

[src/client/datascience/notebookStorage/preferredRemoteKernelIdProvider.ts#L59](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebookStorage/preferredRemoteKernelIdProvider.ts#L59)
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




 Time take for jupyter server to start and be ready to run first user cell.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernel.ts#L286](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L286)
```typescript
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
```


[src/client/datascience/jupyter/kernels/kernel.ts#L338](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L338)
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




 Telemetry sent when we have attempted to find the preferred kernel.

## Properties


No properties for event


## Locations Used

[src/client/datascience/kernel-launcher/localKernelFinder.ts#L82](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localKernelFinder.ts#L82)
```typescript
                preferredInterpreter,
                undefined
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage,
```


[src/client/datascience/kernel-launcher/localKernelFinder.ts#L94](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/localKernelFinder.ts#L94)
```typescript
            }
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                {
                    result: 'failed',
```


[src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L82](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L82)
```typescript
                undefined,
                this.preferredRemoteKernelIdProvider
            );
            sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
                result: preferred ? 'found' : 'notfound',
                resourceType,
                language: telemetrySafeLanguage
```


[src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L90](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/remoteKernelFinder.ts#L90)
```typescript
            return preferred;
        } catch (ex) {
            sendTelemetryEvent(
                Telemetry.PreferredKernel,
                undefined,
                { result: 'failed', resourceType, language: telemetrySafeLanguage },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

</details>
<details>
  <summary>DS_INTERNAL.PYTHON_EXTENSION_NOT_INSTALLED</summary>

## Description


No description provided

## Properties

-
        action:
            | 'displayed' // Message displayed.
            | 'dismissed' // user dismissed the message.
            | 'download';

## Locations Used

[src/client/api/pythonApi.ts#L171](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L171)
```typescript
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        const no = localize.Common.bannerLabelNo();
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
```


[src/client/api/pythonApi.ts#L174](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L174)
```typescript
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showErrorMessage(localize.DataScience.pythonExtensionRequired(), yes, no);
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```


[src/client/api/pythonApi.ts#L177](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L177)
```typescript
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async installPythonExtension() {
```


[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L63](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L63)
```typescript
        }
    }
    private async handleExecutionWithoutPythonExtension() {
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonExtensionRequiredToRunNotebook(),
            { modal: true },
```


[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L70](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L70)
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```


[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L73](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L73)
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




 Telemetry sent for local Python Kernels.
 Tracking whether we have managed to launch the kernel that matches the interpreter.
 If match=false, then this means we have failed to launch the right kernel.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/helpers.ts#L792](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/helpers.ts#L792)
```typescript
            kernelConnection.interpreter.path.toLowerCase(),
            sysExecutable.toLowerCase()
        );
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
```


[src/client/datascience/jupyter/kernels/helpers.ts#L817](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/helpers.ts#L817)
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

-
        moduleName: string;
-
        /**
         * Whether the module was already (once before) installed into the python environment or
         * whether this already exists (detected via `pip list`)
         */
        isModulePresent?: 'true' | undefined;
-
        action:
            | 'displayed' // Install prompt may have been displayed.
            | 'prompted' // Install prompt was displayed.
            | 'installed' // Installation disabled (this is what python extension returns).
            | 'ignored' // Installation disabled (this is what python extension returns).
            | 'disabled' // Installation disabled (this is what python extension returns).
            | 'failed' // Installation disabled (this is what python extension returns).
            | 'install' // User chose install from prompt.
            | 'donotinstall' // User chose not to install from prompt.
            | 'differentKernel' // User chose to select a different kernel.
            | 'error' // Some other error.
            | 'dismissed';
-  // User chose to dismiss the prompt.
        resourceType?: 'notebook' | 'interactive';
-
        /**
         * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
         * If we run the same notebook tomorrow, the hash will be the same.
         */
        resourceHash?: string;

## Locations Used

[src/client/api/pythonApi.ts#L283](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/api/pythonApi.ts#L283)
```typescript
            action = 'failed';
            throw ex;
        } finally {
            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action,
                moduleName: ProductNames.get(product)!
            });
```


[src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L140](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterDependencyService.ts#L140)
```typescript
        }

        const message = getMessageForLibrariesNotInstalled(missingProducts, interpreter.displayName);
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.jupyter)!
        });
```


[src/client/datascience/data-viewing/dataViewerDependencyService.ts#L68](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerDependencyService.ts#L68)
```typescript
        interpreter?: PythonEnvironment,
        token?: CancellationToken
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!
        });
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L138](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L138)
```typescript
        const ipykernelProductName = ProductNames.get(Product.ipykernel)!;
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
            action: 'displayed',
            moduleName: ipykernelProductName,
            resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L156](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L156)
```typescript
        const options = resource ? [installPrompt, selectKernel] : [installPrompt];
        try {
            if (!this.isCodeSpace) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'prompted',
                    moduleName: ipykernelProductName,
                    resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L170](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L170)
```typescript
                      promptCancellationPromise
                  ]);
            if (installerToken.isCancellationRequested) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'dismissed',
                    moduleName: ipykernelProductName,
                    resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L180](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L180)
```typescript
            }

            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'differentKernel',
                    moduleName: ipykernelProductName,
                    resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L188](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L188)
```typescript
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === installPrompt) {
                sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                    action: 'install',
                    moduleName: ipykernelProductName,
                    resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L205](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L205)
```typescript
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'installed',
                        moduleName: ipykernelProductName,
                        resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L213](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L213)
```typescript
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                        action: 'failed',
                        moduleName: ipykernelProductName,
                        resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L223](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L223)
```typescript
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstal, undefined, {
                action: 'dismissed',
                moduleName: ipykernelProductName,
                resourceType,
```


[src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L231](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelDependencyService.ts#L231)
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

-
        action:
            | 'displayed' // Message displayed.
            | 'dismissed' // user dismissed the message.
            | 'download';

## Locations Used

[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L77](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L77)
```typescript
        }
    }
    private async handleExecutionWithoutPython() {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonNotInstalledNonMarkdown(),
            { modal: true },
```


[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L84](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L84)
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
```


[src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L87](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/noPythonKernelsNotebookController.ts#L87)
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



 Telemetry send when we create a notebook for a raw kernel or jupyter

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawNotebookProvider.ts#L76](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawNotebookProvider.ts#L76)
```typescript
        return this.rawNotebookSupportedService.isSupported;
    }

    @captureTelemetry(Telemetry.RawKernelCreatingNotebook, undefined, true)
    public async createNotebook(
        document: NotebookDocument,
        resource: Resource,
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_INFO_RESPONSE</summary>

## Description




 After starting a kernel we send a request to get the kernel info.
 This tracks the total time taken to get the response back (or wether we timedout).
 If we timeout and later we find successful comms for this session, then timeout is too low
 or we need more attempts.

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L296](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L296)
```typescript
                continue;
            }
        }
        sendTelemetryEvent(Telemetry.RawKernelInfoResonse, stopWatch.elapsedTime, {
            attempts,
            timedout: !gotIoPubMessage.completed
        });
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_PROCESS_LAUNCH</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/kernel-launcher/kernelProcess.ts#L102](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/kernelProcess.ts#L102)
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



 Raw kernel timing events

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L152](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L152)
```typescript
                throw error;
            }
        } finally {
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionConnect, stopWatch.elapsedTime);
        }

        this.connected = true;
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_DISPOSED</summary>

## Description




 This event is sent when a RawSession's `dispose` method is called.

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawSession.ts#L96](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawSession.ts#L96)
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




 This event is sent when the underlying kernelProcess for a
 RawJupyterSession exits.

## Properties


No properties for event


## Locations Used

[src/client/datascience/kernel-launcher/kernelLauncher.ts#L145](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/kernel-launcher/kernelLauncher.ts#L145)
```typescript

        kernelProcess.exited(
            ({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
```


[src/client/datascience/raw-kernel/rawSession.ts#L251](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawSession.ts#L251)
```typescript
        traceError(`Disposing session as kernel process died ExitCode: ${e.exitCode}, Reason: ${e.reason}`);
        // Send telemetry so we know why the kernel process exited,
        // as this affects our kernel startup success
        sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
            exitCode: e.exitCode,
            exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(e.reason)
        });
```


[src/client/datascience/raw-kernel/rawJupyterSession.ts#L197](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L197)
```typescript
            if (session !== this.session) {
                return;
            }
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


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L125](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L125)
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                    reason: error.reason
                });
                traceError('Raw session failed to start because dependencies not installed');
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_SHUTDOWN</summary>

## Description




 This event is sent when a RawJupyterSession's `shutdownSession`
 method is called.

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L171](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L171)
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



 Raw kernel single events

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L81](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L81)
```typescript

            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo('Raw session started and connected');
            this.setSession(newSession);

```


[src/client/datascience/raw-kernel/rawJupyterSession.ts#L98](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L98)
```typescript
            if (error instanceof CancellationError) {
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```


[src/client/datascience/raw-kernel/rawJupyterSession.ts#L109](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L109)
```typescript
            } else if (error instanceof TimedOutError) {
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```


[src/client/datascience/raw-kernel/rawJupyterSession.ts#L120](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L120)
```typescript
            } else if (error instanceof IpyKernelNotInstalledError) {
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```


[src/client/datascience/raw-kernel/rawJupyterSession.ts#L134](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L134)
```typescript
                // Send our telemetry event with the error included
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_EXCEPTION</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L142](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L142)
```typescript
                );
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStartException,
                    undefined,
                    undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_SUCCESS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L80](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L80)
```typescript
            newSession = await this.startRawSession(cancelToken, disableUI);

            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo('Raw session started and connected');
            this.setSession(newSession);
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_TIMEOUT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L114](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L114)
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartTimeout);
                traceError('Raw session failed to start in given timeout');
                throw error;
            } else if (error instanceof IpyKernelNotInstalledError) {
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_USER_CANCEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L103](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L103)
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartUserCancel);
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


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawJupyterSession.ts#L238](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawJupyterSession.ts#L238)
```typescript
        return this.startRawSession(cancelToken);
    }

    @captureTelemetry(Telemetry.RawKernelStartRawSession, undefined, true)
    private async startRawSession(cancelToken?: CancellationToken, disableUI?: boolean): Promise<RawSession> {
        if (
            this.kernelConnectionMetadata.kind !== 'startUsingLocalKernelSpec' &&
```

</details>
<details>
  <summary>DS_INTERNAL.REGISTER_AND_USE_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L191](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/jupyterKernelService.ts#L191)
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

-
        /**
         * Number of kernel specs.
         */
        count: number;

## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.RESTART_JUPYTER_TIME</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernelExecution.ts#L253](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L253)
```typescript
    }

    @captureTelemetry(Telemetry.RestartKernel)
    @captureTelemetry(Telemetry.RestartJupyterTime)
    private async restartExecution(session: IJupyterSession): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
        await session.restart();
```

</details>
<details>
  <summary>DS_INTERNAL.RESTART_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernelExecution.ts#L252](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernelExecution.ts#L252)
```typescript
        });
    }

    @captureTelemetry(Telemetry.RestartKernel)
    @captureTelemetry(Telemetry.RestartJupyterTime)
    private async restartExecution(session: IJupyterSession): Promise<void> {
        // Just use the internal session. Pending cells should have been canceled by the caller
```

</details>
<details>
  <summary>DS_INTERNAL.SELECT_JUPYTER_INTERPRETER</summary>

## Description


No description provided

## Properties

-
        /**
         * The result of the selection.
         * notSelected - No interpreter was selected.
         * selected - An interpreter was selected (and configured to have jupyter and notebook).
         * installationCancelled - Installation of jupyter and/or notebook was cancelled for an interpreter.
         *
         * @type {('notSelected' | 'selected' | 'installationCancelled')}
         */
        result?: 'notSelected' | 'selected' | 'installationCancelled';

## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L95](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L95)
```typescript
            resolveToUndefinedWhenCancelled
        ]);
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

```


[src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L106](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L106)
```typescript
                return interpreter;
            }
            case JupyterInterpreterDependencyResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                return this.selectInterpreter(token);
```


[src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L169](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterService.ts#L169)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.ts#L78](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.ts#L78)
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


No properties for event


## Locations Used

[src/client/datascience/datascience.ts#L126](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/datascience.ts#L126)
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


No properties for event


## Locations Used

[src/client/datascience/shiftEnterBanner.ts#L78](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/shiftEnterBanner.ts#L78)
```typescript
            return;
        }

        sendTelemetryEvent(Telemetry.ShiftEnterBannerShown);
        const response = await this.appShell.showInformationMessage(this.bannerMessage, ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[InteractiveShiftEnterLabelIndex.Yes]: {
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L69](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L69)
```typescript
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L114](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L114)
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


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewerDependencyService.ts#L60](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerDependencyService.ts#L60)
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


No properties for event


## Locations Used

[src/client/datascience/data-viewing/dataViewerDependencyService.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/data-viewing/dataViewerDependencyService.ts#L54)
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




 Time take for jupyter server to be busy from the time user first hit `run` cell until jupyter reports it is busy running a cell.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernel.ts#L288](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L288)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/notebookStarter.ts#L145](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/notebookStarter.ts#L145)
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



 Telemetry sent when starting auto starting Native Notebook kernel fails silently.

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/kernels/kernel.ts#L356](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/kernels/kernel.ts#L356)
```typescript
                        ex as any
                    );
                    if (options?.disableUI) {
                        sendTelemetryEvent(Telemetry.KernelStartFailedAndUIDisabled);
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        this.errorHandler.handleError(ex as any).ignoreErrors(); // Just a notification, so don't await this
```

</details>
<details>
  <summary>DS_INTERNAL.START_SESSION_FAILED_JUPYTER</summary>

## Description




 Telemetry event sent when starting a session for a local connection failed.

 @type {(undefined | never)}
 @memberof IEventNamePropertyMapping

## Properties


No properties for event


## Locations Used

[src/client/datascience/baseJupyterSession.ts#L37](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/baseJupyterSession.ts#L37)
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


No properties for event


## Locations Used

[src/client/datascience/notebook/vscodeNotebookController.ts#L387](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L387)
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

-  language: string

## Locations Used

[src/client/datascience/common.ts#L171](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/common.ts#L171)
```typescript
}

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language?: string
) {
    language = getTelemetrySafeLanguage(language);
```


[src/client/datascience/notebook/vscodeNotebookController.ts#L369](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L369)
```typescript
        }
        switch (this.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
```


[src/client/datascience/notebook/vscodeNotebookController.ts#L373](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L373)
```typescript
                break;
            case 'connectToLiveKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelModel.language
                );
                break;
```


[src/client/datascience/notebook/vscodeNotebookController.ts#L379](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/vscodeNotebookController.ts#L379)
```typescript
                break;
            case 'startUsingLocalKernelSpec':
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


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.SYNC_ALL_CELLS</summary>

## Description



 Sync events

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.SYNC_SINGLE_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.USE_EXISTING_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.USE_INTERPRETER_AS_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.VARIABLE_EXPLORER_FETCH_TIME</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterVariables.ts#L44](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterVariables.ts#L44)
```typescript
    }

    // IJupyterVariables implementation
    @captureTelemetry(Telemetry.VariableExplorerFetchTime, undefined, true)
    public async getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse> {
        return (await this.getVariableHandler()).getVariables(request, kernel);
    }
```

</details>
<details>
  <summary>DS_INTERNAL.VARIABLE_EXPLORER_VARIABLE_COUNT</summary>

## Description


No description provided

## Properties

-  variableCount: number

## Locations Used

[src/client/datascience/variablesView/variableView.ts#L192](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/variablesView/variableView.ts#L192)
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

-
        isErrorOutput: boolean;

## Locations Used

[src/client/datascience/notebook/helpers/helpers.ts#L725](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/notebook/helpers/helpers.ts#L725)
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


No properties for event


## Locations Used

[src/client/datascience/jupyter/jupyterSession.ts#L53](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/jupyter/jupyterSession.ts#L53)
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

-  type: string

## Locations Used

[src/client/datascience/webviews/webviewHost.ts#L284](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/webviews/webviewHost.ts#L284)
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


No properties for event


## Locations Used

[src/client/datascience/webviews/webviewHost.ts#L302](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/webviews/webviewHost.ts#L302)
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




 Telemetry event sent when the ZMQ native binaries do work.

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawNotebookSupportedService.ts#L58](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawNotebookSupportedService.ts#L58)
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




 Telemetry event sent when the ZMQ native binaries do not work.

## Properties


No properties for event


## Locations Used

[src/client/datascience/raw-kernel/rawNotebookSupportedService.ts#L62](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/raw-kernel/rawNotebookSupportedService.ts#L62)
```typescript
            this._isSupported = true;
        } catch (e) {
            traceError(`Exception while attempting zmq :`, e);
            sendTelemetryEvent(Telemetry.ZMQNotSupported);
            this._isSupported = false;
        }

```

</details>
<details>
  <summary>ENVFILE_VARIABLE_SUBSTITUTION</summary>

## Description




 Telemetry event sent when substituting Environment variables to calculate value of variables

## Properties


No properties for event


## Locations Used

[src/client/common/variables/environment.ts#L140](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/variables/environment.ts#L140)
```typescript
    });
    if (!invalid && replacement !== value) {
        value = replacement;
        sendTelemetryEvent(EventName.ENVFILE_VARIABLE_SUBSTITUTION);
    }

    return value.replace(/\\\$/g, '$');
```

</details>
<details>
  <summary>ENVFILE_WORKSPACE</summary>

## Description




 Telemetry event sent when an environment file is detected in the workspace.

## Properties


No properties for event


## Locations Used

[src/client/telemetry/envFileTelemetry.ts#L46](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/envFileTelemetry.ts#L46)
```typescript
}

function sendTelemetry(hasCustomEnvPath: boolean = false) {
    sendTelemetryEvent(EventName.ENVFILE_WORKSPACE, undefined, { hasCustomEnvPath });

    envFileTelemetrySent = true;
}
```

</details>
<details>
  <summary>EXTENSION.LOAD</summary>

## Description




 Telemetry event sent with details just after editor loads

## Properties


No properties for event


## Locations Used

[src/client/telemetry/types.ts#L8](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/types.ts#L8)
```typescript
import { IEventNamePropertyMapping } from '../telemetry/index';
import { EventName } from './constants';

export type EditorLoadTelemetry = IEventNamePropertyMapping[EventName.EXTENSION_LOAD];
export const IImportTracker = Symbol('IImportTracker');
export interface IImportTracker {}

```


[src/client/startupTelemetry.ts#L31](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/startupTelemetry.ts#L31)
```typescript
        await activatedPromise;
        durations.totalActivateTime = stopWatch.elapsedTime;
        const props = await getActivationTelemetryProps(serviceContainer);
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props);
    } catch (ex) {
        traceError('sendStartupTelemetry() failed.', ex);
    }
```


[src/client/startupTelemetry.ts#L52](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/startupTelemetry.ts#L52)
```typescript
                traceError('getActivationTelemetryProps() failed.', ex);
            }
        }
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props, ex);
    } catch (exc2) {
        traceError('sendErrorTelemetry() failed.', exc2);
    }
```

</details>
<details>
  <summary>HASHED_PACKAGE_NAME</summary>

## Description




 Telemetry event sent with details when tracking imports

## Properties


No properties for event


## Locations Used

[src/client/telemetry/importTracker.ts#L208](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/importTracker.ts#L208)
```typescript
        // Hash the package name so that we will never accidentally see a
        // user's private package name.
        const hash = getTelemetrySafeHashedString(packageName);
        sendTelemetryEvent(EventName.HASHED_PACKAGE_NAME, undefined, { hashedNamev2: hash });
    }

    private lookForImports(lines: (string | undefined)[]) {
```


[src/test/telemetry/importTracker.unit.test.ts#L44](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/telemetry/importTracker.unit.test.ts#L44)
```typescript
        public static expectHashes(...hashes: string[]) {
            expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_PERF);
            if (hashes.length > 0) {
                expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_NAME);
            }

            Reporter.properties.pop(); // HASHED_PACKAGE_PERF
```

</details>
<details>
  <summary>HASHED_PACKAGE_PERF</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/telemetry/importTracker.ts#L161](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/importTracker.ts#L161)
```typescript
        }
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookDocument(e: NotebookDocument) {
        this.pendingChecks.delete(e.uri.fsPath);
        const lines = this.getNotebookDocumentLines(e);
```


[src/client/telemetry/importTracker.ts#L168](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/importTracker.ts#L168)
```typescript
        this.lookForImports(lines);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookCell(e: NotebookCellExecutionStateChangeEvent) {
        if (!isJupyterNotebook(e.cell.notebook)) {
            return;
```


[src/client/telemetry/importTracker.ts#L192](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/telemetry/importTracker.ts#L192)
```typescript
        this.lookForImports(result);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkDocument(document: TextDocument) {
        this.pendingChecks.delete(document.fileName);
        const lines = this.getDocumentLines(document);
```


[src/test/telemetry/importTracker.unit.test.ts#L42](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/telemetry/importTracker.unit.test.ts#L42)
```typescript
        public static measures: {}[] = [];

        public static expectHashes(...hashes: string[]) {
            expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_PERF);
            if (hashes.length > 0) {
                expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_NAME);
            }
```

</details>
<details>
  <summary>JUPYTER_EXPERIMENTS_OPT_IN_OUT</summary>

## Description




 Telemetry event sent with details when a user has requested to opt it or out of an experiment group

## Properties


No properties for event


## Locations Used

[src/client/common/experiments/service.ts#L104](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/experiments/service.ts#L104)
```typescript
        // so we need to perform these checks and send the corresponding telemetry manually.
        switch (this.getOptInOptOutStatus(experiment)) {
            case 'optOut': {
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedOutOf: experiment
                });

```


[src/client/common/experiments/service.ts#L112](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/experiments/service.ts#L112)
```typescript
            }
            case 'optIn': {
                await this.experimentationService.isCachedFlightEnabled(experiment);
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedInto: experiment
                });

```


[src/test/common/experiments/service.unit.test.ts#L221](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/common/experiments/service.unit.test.ts#L221)
```typescript
            assert.isTrue(result);
            assert.equal(telemetryEvents.length, 1);
            assert.deepEqual(telemetryEvents[0], {
                eventName: EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT,
                properties: { expNameOptedInto: experiment }
            });
            sinon.assert.calledOnce(isCachedFlightEnabledStub);
```


[src/test/common/experiments/service.unit.test.ts#L241](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/common/experiments/service.unit.test.ts#L241)
```typescript
            assert.isFalse(result);
            assert.equal(telemetryEvents.length, 1);
            assert.deepEqual(telemetryEvents[0], {
                eventName: EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT,
                properties: { expNameOptedOutOf: experiment }
            });
            sinon.assert.notCalled(isCachedFlightEnabledStub);
```

</details>
<details>
  <summary>OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR_EX</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L558](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L558)
```typescript
                    sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
                }
            } catch (e) {
                sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
                traceError(e);
                void this.appShell.showErrorMessage(e.toString());
            }
```

</details>
<details>
  <summary>OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST_EX</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L540](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L540)
```typescript
        return this.commandManager.executeCommand('outline.focus');
    }
    private async onVariablePanelShowDataViewerRequest(request: IShowDataViewerFromVariablePanel) {
        sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST);
        if (this.debugService.activeDebugSession) {
            try {
                const variable = convertDebugProtocolVariableToIJupyterVariable(
```

</details>
<details>
  <summary>OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS_EX</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/client/datascience/commands/commandRegistry.ts#L555](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/datascience/commands/commandRegistry.ts#L555)
```typescript
                if (columnSize && (await this.dataViewerChecker.isRequestedColumnSizeAllowed(columnSize))) {
                    const title: string = `${DataScience.dataExplorerTitle()} - ${jupyterVariable.name}`;
                    await this.dataViewerFactory.create(jupyterVariableDataProvider, title);
                    sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
                }
            } catch (e) {
                sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
```

</details>
<details>
  <summary>PLATFORM.INFO</summary>

## Description




 Telemetry event sent after fetching the OS version

## Properties


No properties for event


## Locations Used

[src/client/common/platform/platformService.ts#L21](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/platform/platformService.ts#L21)
```typescript
    public version?: SemVer;
    constructor() {
        if (this.osType === OSType.Unknown) {
            sendTelemetryEvent(EventName.PLATFORM_INFO, undefined, {
                failureType: PlatformErrors.FailedToDetermineOS
            });
        }
```


[src/client/common/platform/platformService.ts#L45](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/platform/platformService.ts#L45)
```typescript
                try {
                    const ver = coerce(os.release());
                    if (ver) {
                        sendTelemetryEvent(EventName.PLATFORM_INFO, undefined, {
                            osVersion: `${ver.major}.${ver.minor}.${ver.patch}`
                        });
                        return (this.version = ver);
```


[src/client/common/platform/platformService.ts#L52](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/platform/platformService.ts#L52)
```typescript
                    }
                    throw new Error('Unable to parse version');
                } catch (ex) {
                    sendTelemetryEvent(EventName.PLATFORM_INFO, undefined, {
                        failureType: PlatformErrors.FailedToParseVersion
                    });
                    return parseVersion(os.release());
```

</details>
<details>
  <summary>PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES</summary>

## Description


No description provided

## Properties

-
        /**
         * Carries `true` if environment variables are present, `false` otherwise
         *
         * @type {boolean}
         */
        hasEnvVars?: boolean;
-
        /**
         * Carries `true` if fetching environment variables failed, `false` otherwise
         *
         * @type {boolean}
         */
        failed?: boolean;
-
        /**
         * Whether the environment was activated within a terminal or not.
         *
         * @type {boolean}
         */
        activatedInTerminal?: boolean;
-
        /**
         * Whether the environment was activated by the wrapper class.
         * If `true`, this telemetry is sent by the class that wraps the two activation providers   .
         *
         * @type {boolean}
         */
        activatedByWrapper?: boolean;

## Locations Used

[src/client/common/process/pythonExecutionFactory.ts#L172](https://github.com/microsoft/vscode-jupyter/tree/main/src/client/common/process/pythonExecutionFactory.ts#L172)
```typescript
            options.allowEnvironmentFetchExceptions
        );
        const hasEnvVars = envVars && Object.keys(envVars).length > 0;
        sendTelemetryEvent(EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES, undefined, { hasEnvVars });
        if (!hasEnvVars) {
            return this.create({
                resource: options.resource,
```

</details>
