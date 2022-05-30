# Telemetry created by Jupyter Extension

Expand each section to see more information about that event.

<details>
  <summary>DATASCIENCE.ADD_CELL_BELOW</summary>

## Description



 Data Science

## Properties


No properties for event


## Locations Used

[src/interactive-window/commands/commandRegistry.ts#L367](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L367)
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

[src/interactive-window/commands/exportCommands.ts#L128](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/exportCommands.ts#L128)
```typescript
            if (pickedItem !== undefined) {
                pickedItem.handler();
            } else {
                sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick);
            }
        }
    }
```


[src/interactive-window/commands/exportCommands.ts#L144](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/exportCommands.ts#L144)
```typescript
                label: DataScience.exportPythonQuickPickLabel(),
                picked: true,
                handler: () => {
                    sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                        format: ExportFormat.python
                    });
                    void this.commandManager.executeCommand(Commands.ExportAsPythonScript, sourceDocument, interpreter);
```


[src/interactive-window/commands/exportCommands.ts#L158](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/exportCommands.ts#L158)
```typescript
                    label: DataScience.exportHTMLQuickPickLabel(),
                    picked: false,
                    handler: () => {
                        sendTelemetryEvent(Telemetry.ClickedExportNotebookAsQuickPick, undefined, {
                            format: ExportFormat.html
                        });
                        void this.commandManager.executeCommand(
```


[src/interactive-window/commands/exportCommands.ts#L173](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/exportCommands.ts#L173)
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

[src/interactive-window/interactiveWindowCommandListener.ts#L358](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/interactiveWindowCommandListener.ts#L358)
```typescript
        }
    }

    @captureTelemetry(Telemetry.CreateNewInteractive, undefined, false)
    private async createNewInteractiveWindow(connection?: KernelConnectionMetadata): Promise<void> {
        await this.interactiveWindowProvider.getOrCreate(undefined, connection);
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

[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L322](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L322)
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

[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L204](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L204)
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

[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L265](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L265)
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

[src/interactive-window/commands/commandRegistry.ts#L359](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L359)
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugContinue)
    private async debugContinue(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_CURRENT_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L115](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L115)
```typescript
        return this.codeLenses;
    }

    @captureTelemetry(Telemetry.DebugCurrentCell)
    public async debugCurrentCell() {
        if (!this.documentManager.activeTextEditor || !this.documentManager.activeTextEditor.document) {
            return;
```


[src/interactive-window/editor-integration/codewatcher.ts#L313](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L313)
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

[src/interactive-window/editor-integration/codewatcher.ts#L179](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L179)
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

[src/interactive-window/commands/commandRegistry.ts#L333](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L333)
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugStepOver)
    private async debugStepOver(): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUG_STOP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/commands/commandRegistry.ts#L341](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L341)
```typescript
        }
    }

    @captureTelemetry(Telemetry.DebugStop)
    private async debugStop(uri: Uri): Promise<void> {
        // Make sure that we are in debug mode
        if (this.debugService?.activeDebugSession && this.interactiveWindowProvider) {
```

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/debugger/debuggingManagerBase.ts#L198](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/debugger/debuggingManagerBase.ts#L198)
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

[src/notebooks/debugger/debuggingManager.ts#L144](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/debugger/debuggingManager.ts#L144)
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

[src/notebooks/debugger/debuggingManager.ts#L91](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/debugger/debuggingManager.ts#L91)
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

[src/kernels/debugger/debuggingManagerBase.ts#L203](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/debugger/debuggingManagerBase.ts#L203)
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

[src/kernels/debugger/kernelDebugAdapterBase.ts#L104](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/debugger/kernelDebugAdapterBase.ts#L104)
```typescript
                this.kernel.onDisposed(() => {
                    void debug.stopDebugging(this.session);
                    this.endSession.fire(this.session);
                    sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'onKernelDisposed' });
                })
            );
        }
```


[src/kernels/debugger/kernelDebugAdapterBase.ts#L118](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/debugger/kernelDebugAdapterBase.ts#L118)
```typescript
                        cellStateChange.state === NotebookCellExecutionState.Idle &&
                        !this.disconnected
                    ) {
                        sendTelemetryEvent(DebuggingTelemetry.endedSession, undefined, { reason: 'normally' });
                        void this.disconnect();
                    }
                },
```


[src/notebooks/debugger/debuggingManager.ts#L135](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/debugger/debuggingManager.ts#L135)
```typescript
                if (editor) {
                    const controller = this.notebookToRunByLineController.get(editor.notebook);
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

[src/kernels/debugger/debuggingManagerBase.ts#L180](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/debugger/debuggingManagerBase.ts#L180)
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
  <summary>DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_IW_JUPYTER</summary>

## Description




 Telemetry sent when we have managed to successfully start the Interactive Window debugger using the Jupyter protocol.

## Properties


No properties for event


## Locations Used

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/debugger/debugCellControllers.ts#L20](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/debugger/debugCellControllers.ts#L20)
```typescript
        private readonly kernel: IKernel,
        private readonly commandManager: ICommandManager
    ) {
        sendTelemetryEvent(DebuggingTelemetry.successfullyStartedRunAndDebugCell);
    }

    public async willSendEvent(_msg: DebugProtocolMessage): Promise<boolean> {
```


[src/interactive-window/debugger/jupyter/debugCellControllers.ts#L23](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/jupyter/debugCellControllers.ts#L23)
```typescript
        public readonly debugCell: NotebookCell,
        private readonly kernel: IKernel
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

[src/notebooks/debugger/runByLineController.ts#L29](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/debugger/runByLineController.ts#L29)
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

[src/interactive-window/shiftEnterBanner.ts#L93](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/shiftEnterBanner.ts#L93)
```typescript
        );
    }

    @captureTelemetry(Telemetry.DisableInteractiveShiftEnter)
    public async disableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L103](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L103)
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

[src/interactive-window/shiftEnterBanner.ts#L104](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/shiftEnterBanner.ts#L104)
```typescript
        await this.disableBanner();
    }

    @captureTelemetry(Telemetry.EnableInteractiveShiftEnter)
    public async enableInteractiveShiftEnter(): Promise<void> {
        await this.configuration.updateSetting(
            'sendSelectionToInteractiveWindow',
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L72](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L72)
```typescript

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });

```

</details>
<details>
  <summary>DATASCIENCE.ENTER_JUPYTER_URI</summary>

## Description




 Captures the telemetry when the Uri is manually entered by the user as part of the workflow when selecting a Kernel.

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/serverSelector.ts#L87](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L87)
```typescript
        return multiStep.run(this.startSelectingURI.bind(this, allowLocal), {});
    }

    @captureTelemetry(Telemetry.EnterJupyterURI)
    @traceDecoratorError('Failed to enter Jupyter Uri')
    public async enterJupyterURI(): Promise<string | undefined> {
        let initialValue = defaultUri;
```

</details>
<details>
  <summary>DATASCIENCE.EXECUTE_CELL</summary>

## Description



 Applies to everything (interactive+Notebooks & local+remote)

## Properties


No properties for event


## Locations Used

[src/telemetry/telemetry.ts#L82](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L82)
```typescript
    properties?: P[E] & { waitBeforeSending?: Promise<void> },
    ex?: Error
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }

```


[src/telemetry/telemetry.ts#L119](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L119)
```typescript
    stopWatch?: StopWatch,
    properties?: P[E] & { [waitBeforeSending]?: Promise<void> }
) {
    if (eventName === Telemetry.ExecuteCell) {
        setSharedProperty('userExecutedCell', 'true');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
```


[src/notebooks/controllers/vscodeNotebookController.ts#L256](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L256)
```typescript
            return;
        }
        initializeInteractiveOrNotebookTelemetryBasedOnUserAction(notebook.uri, this.connection);
        sendKernelTelemetryEvent(notebook.uri, Telemetry.ExecuteCell);
        // Notebook is trusted. Continue to execute cells
        await Promise.all(cells.map((cell) => this.executeCell(notebook, cell)));
    }
```


[src/kernels/kernel.base.ts#L197](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L197)
```typescript
    }
    public async executeCell(cell: NotebookCell): Promise<NotebookCellRunState> {
        traceCellMessage(cell, `kernel.executeCell, ${getDisplayPath(cell.notebook.uri)}`);
        sendKernelTelemetryEvent(this.resourceUri, Telemetry.ExecuteCell);
        const stopWatch = new StopWatch();
        const sessionPromise = this.startJupyterSession();
        const promise = this.kernelExecution.executeCell(sessionPromise, cell);
```


[src/test/datascience/telemetry.vscode.test.ts#L154](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L154)
```typescript
        };

        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.ExecuteCell);
        assertEvent(Telemetry.OpenNotebookAll);
        assertEvent(Telemetry.NotebookStart);
    });
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

[src/platform/export/exportFileOpener.ts#L28](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/export/exportFileOpener.ts#L28)
```typescript
    public async openFile(format: ExportFormat, uri: Uri, openDirectly: boolean = false) {
        if (format === ExportFormat.python) {
            await this.openPythonFile(uri, openDirectly);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: true
```


[src/platform/export/exportFileOpener.ts#L35](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/export/exportFileOpener.ts#L35)
```typescript
            });
        } else {
            const opened = await this.askOpenFile(uri);
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, {
                format: format,
                successful: true,
                opened: opened
```


[src/platform/export/fileConverter.ts#L65](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/export/fileConverter.ts#L65)
```typescript
        }

        if (reporter.token.isCancellationRequested) {
            sendTelemetryEvent(Telemetry.ExportNotebookAs, undefined, { format: format, cancelled: true });
            return;
        }
    }
```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_NOTEBOOK_AS_COMMAND</summary>

## Description


No description provided

## Properties

-  format: ExportFormat

## Locations Used

[src/interactive-window/commands/exportCommands.ts#L113](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/exportCommands.ts#L113)
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

[src/platform/export/fileConverter.ts#L85](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/export/fileConverter.ts#L85)
```typescript
            await this.performExport(format, sourceDocument, target, token, candidateInterpreter);
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

[src/interactive-window/interactiveWindowCommandListener.ts#L199](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/interactiveWindowCommandListener.ts#L199)
```typescript
        return result;
    }

    @captureTelemetry(Telemetry.ExportPythonFileInteractive, undefined, false)
    private async exportFile(file: Uri): Promise<void> {
        const filePath = getFilePath(file);
        if (filePath && filePath.length > 0 && this.jupyterExporter) {
```

</details>
<details>
  <summary>DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/interactiveWindowCommandListener.ts#L248](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/interactiveWindowCommandListener.ts#L248)
```typescript
        }
    }

    @captureTelemetry(Telemetry.ExportPythonFileAndOutputInteractive, undefined, false)
    private async exportFileAndOutput(file: Uri): Promise<Uri | undefined> {
        const filePath = getFilePath(file);
        if (
```

</details>
<details>
  <summary>DATASCIENCE.FAILED_SHOW_DATA_EXPLORER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/webviews/extension-side/variablesView/variableView.node.ts#L170](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/variablesView/variableView.node.ts#L170)
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

[src/notebooks/controllers/notebookControllerManager.ts#L918](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/notebookControllerManager.ts#L918)
```typescript
            }
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

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.FETCH_CONTROLLERS</summary>

## Description




 Telemetry sent when we have loaded some controllers.

## Properties


No properties for event


## Locations Used

[src/kernels/kernelFinder.base.ts#L242](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelFinder.base.ts#L242)
```typescript
        const key = `${kind}:${useCache}`;
        if (this.startTimeForFetching && !this.fetchingTelemetrySent.has(key)) {
            this.fetchingTelemetrySent.add(key);
            sendTelemetryEvent(Telemetry.FetchControllers, this.startTimeForFetching.elapsedTime, {
                cached: useCache === 'useCache',
                kind
            });
```

</details>
<details>
  <summary>DATASCIENCE.GET_PASSWORD_ATTEMPT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L39](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L39)
```typescript
        this.serverUriStorage.onDidRemoveUris(this.onDidRemoveUris, this, this.disposables);
    }

    @captureTelemetry(Telemetry.GetPasswordAttempt)
    public getPasswordConnectionInfo(url: string): Promise<IJupyterPasswordConnectInfo | undefined> {
        if (!url || url.length < 1) {
            return Promise.resolve(undefined);
```

</details>
<details>
  <summary>DATASCIENCE.GOTO_NEXT_CELL_IN_FILE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L673](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L673)
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

[src/interactive-window/editor-integration/codewatcher.ts#L690](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L690)
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

[src/interactive-window/interactiveWindowCommandListener.ts#L373](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/interactiveWindowCommandListener.ts#L373)
```typescript
        return this.statusProvider.waitWithStatus(promise, message, undefined, canceled);
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'command' }, false)
    private async importNotebook(): Promise<void> {
        const filtersKey = localize.DataScience.importDialogFilter();
        const filtersObject: { [name: string]: string[] } = {};
```


[src/interactive-window/interactiveWindowCommandListener.ts#L396](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/interactiveWindowCommandListener.ts#L396)
```typescript
        }
    }

    @captureTelemetry(Telemetry.ImportNotebook, { scope: 'file' }, false)
    private async importNotebookOnFile(file: Uri): Promise<void> {
        const filepath = getFilePath(file);
        if (filepath && filepath.length > 0) {
```

</details>
<details>
  <summary>DATASCIENCE.INTERACTIVE_WINDOW_DEBUG_SETUP_CODE_FAILURE</summary>

## Description


No description provided

## Properties

- 
        ename: string;
- 
        evalue: string;

## Locations Used

[src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L111](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L111)
```typescript
        executeSilently(kernel.session, this.tracingEnableCode, {
            traceErrors: true,
            traceErrorsMessage: 'Execute_request failure enabling tracing code for IW',
            telemetryName: Telemetry.InteractiveWindowDebugSetupCodeFailure
        }).ignoreErrors();
    }

```


[src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L122](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L122)
```typescript
        executeSilently(kernel.session, this.tracingDisableCode, {
            traceErrors: true,
            traceErrorsMessage: 'Execute_request failure disabling tracing code for IW',
            telemetryName: Telemetry.InteractiveWindowDebugSetupCodeFailure
        }).ignoreErrors();
    }

```


[src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L151](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L151)
```typescript
                const importResults = await executeSilently(kernel.session, this.waitForDebugClientCode, {
                    traceErrors: true,
                    traceErrorsMessage: 'Execute_request failure starting debug session for IW',
                    telemetryName: Telemetry.InteractiveWindowDebugSetupCodeFailure
                });
                if (importResults.some((item) => item.output_type === 'error')) {
                    traceWarning(`${this.debuggerPackage} not found in path.`);
```


[src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L268](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L268)
```typescript
                      {
                          traceErrors: true,
                          traceErrorsMessage: 'Execute_request failure appending debugger paths for IW',
                          telemetryName: Telemetry.InteractiveWindowDebugSetupCodeFailure
                      }
                  )
                : [];
```


[src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L297](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/debugger/interactiveWindowDebugger.node.ts#L297)
```typescript
            ? await executeSilently(kernel.session, this.enableDebuggerCode, {
                  traceErrors: true,
                  traceErrorsMessage: 'Execute_request failure enabling debugging for IW',
                  telemetryName: Telemetry.InteractiveWindowDebugSetupCodeFailure
              })
            : [];

```

</details>
<details>
  <summary>DATASCIENCE.INTERRUPT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/execution/kernelExecution.ts#L199](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L199)
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
  <summary>DATASCIENCE.JUPYTER_KERNEL_API_ACCESS</summary>

## Description


No description provided

## Properties

- 
        extensionId: string;
- 
        allowed: 'yes' | 'no';

## Locations Used

[src/platform/api/apiAccessService.ts#L67](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/apiAccessService.ts#L67)
```typescript
        const extensionPermissions = this.globalState.get<ApiExtensionInfo | undefined>(API_ACCESS_GLOBAL_KEY);
        const extensionPermission = extensionPermissions?.find((item) => item.extensionId === info.extensionId);
        if (extensionPermission) {
            sendTelemetryEvent(Telemetry.JupyterKernelApiAccess, undefined, {
                extensionId: info.extensionId,
                allowed: extensionPermission.allowed
            });
```


[src/platform/api/apiAccessService.ts#L95](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/apiAccessService.ts#L95)
```typescript
                extensionPermissions.push({ allowed: allow ? 'yes' : 'no', extensionId: info.extensionId });
                return this.globalState.update(API_ACCESS_GLOBAL_KEY, extensionPermissions);
            });
            sendTelemetryEvent(Telemetry.JupyterKernelApiAccess, undefined, {
                extensionId: info.extensionId,
                allowed: allow ? 'yes' : 'no'
            });
```

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_KERNEL_API_USAGE</summary>

## Description


No description provided

## Properties

- 
        extensionId: string;
- 
        pemUsed: keyof IExportedKernelService;

## Locations Used

[src/platform/api/kernelApi.ts#L77](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L77)
```typescript
        KernelConnectionMetadata
    >();
    public get onDidChangeKernelSpecifications(): Event<void> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'onDidChangeKernelSpecifications'
        });
```


[src/platform/api/kernelApi.ts#L85](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L85)
```typescript
        return this._onDidChangeKernelSpecifications.event;
    }
    public get onDidChangeKernels(): Event<void> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'onDidChangeKernels'
        });
```


[src/platform/api/kernelApi.ts#L108](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L108)
```typescript
        );
    }
    async getKernelSpecifications(refresh?: boolean): Promise<KernelConnectionMetadata[]> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernelSpecifications'
        });
```


[src/platform/api/kernelApi.ts#L117](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L117)
```typescript
        return items.map((item) => this.translateKernelConnectionMetadataToExportedType(item));
    }
    getActiveKernels(): { metadata: KernelConnectionMetadata; uri: Uri | undefined }[] {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getActiveKernels'
        });
```


[src/platform/api/kernelApi.ts#L156](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L156)
```typescript
        return kernels;
    }
    getKernel(uri: Uri): { metadata: KernelConnectionMetadata; connection: IKernelConnectionInfo } | undefined {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'getKernel'
        });
```


[src/platform/api/kernelApi.ts#L170](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L170)
```typescript
        }
    }
    async startKernel(spec: KernelConnectionMetadata, uri: Uri): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'startKernel'
        });
```


[src/platform/api/kernelApi.ts#L177](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/kernelApi.ts#L177)
```typescript
        return this.startOrConnect(spec, uri);
    }
    async connect(spec: ActiveKernel, uri: Uri): Promise<IKernelConnectionInfo> {
        sendTelemetryEvent(Telemetry.JupyterKernelApiUsage, undefined, {
            extensionId: this.callingExtensionId,
            pemUsed: 'connect'
        });
```

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_KERNEL_FILTER_USED</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/controllers/kernelFilter/kernelFilterUI.ts#L112](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/kernelFilter/kernelFilterUI.ts#L112)
```typescript
                    .map((item) => item.connection)
                    .filter((item) => !selectedItems.has(item));
                void this.kernelFilter.storeHiddenKernels(hiddenConnections.map((item) => item));
                sendTelemetryEvent(Telemetry.JupyterKernelFilterUsed);
            },
            this,
            disposables
```

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_KERNEL_HIDDEN_VIA_FILTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/controllers/kernelFilter/kernelFilterService.ts#L55](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/kernelFilter/kernelFilterService.ts#L55)
```typescript
        });

        if (hidden) {
            sendTelemetryEvent(Telemetry.JupyterKernelHiddenViaFilter);
        }
        return hidden;
    }
```

</details>
<details>
  <summary>DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L153](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L153)
```typescript
                moduleName: ProductNames.get(Product.jupyter)!,
                pythonEnvType: interpreter.envType
            });
            sendTelemetryEvent(Telemetry.JupyterNotInstalledErrorShown);
            const selection = await this.applicationShell.showErrorMessage(
                message,
                { modal: true },
```

</details>
<details>
  <summary>DATASCIENCE.KERNEL_CRASH</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/kernelCrashMonitor.ts#L73](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelCrashMonitor.ts#L73)
```typescript
    }
    private async endCellAndDisplayErrorsInCell(kernel: IKernel) {
        const lastExecutedCell = this.lastExecutedCellPerKernel.get(kernel);
        sendKernelTelemetryEvent(kernel.resourceUri, Telemetry.KernelCrash);
        if (!lastExecutedCell) {
            return;
        }
```

</details>
<details>
  <summary>DATASCIENCE.KERNEL_SPEC_LANGUAGE</summary>

## Description


No description provided

## Properties

- 
        /**
         * Language of the kernelSpec.
         */
        language: string;
- 
        /**
         * Whether this is a local or remote kernel.
         */
        kind: 'local' | 'remote';
- 
        /**
         * Whether shell is used to start the kernel. E.g. `"/bin/sh"` is used in the argv of the kernelSpec.
         * OCaml is one such kernel.
         */
        usesShell?: boolean;

## Locations Used

[src/kernels/raw/finder/helper.ts#L15](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/finder/helper.ts#L15)
```typescript
        arg = arg.toLowerCase();
        return shellScripts.some((shell) => arg.includes(shell));
    });
    sendTelemetryEvent(Telemetry.KernelSpecLanguage, undefined, {
        language: getTelemetrySafeLanguage(kernelSpec.language),
        kind,
        usesShell
```

</details>
<details>
  <summary>DATASCIENCE.KERNEL_STARTUP_CODE_FAILURE</summary>

## Description


No description provided

## Properties

- 
        ename: string;
- 
        evalue: string;

## Locations Used

[src/kernels/kernel.base.ts#L545](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L545)
```typescript
            await this.executeSilently(session, startupCode, {
                traceErrors: true,
                traceErrorsMessage: 'Error executing jupyter extension internal startup code',
                telemetryName: Telemetry.KernelStartupCodeFailure
            });

            // Run user specified startup commands
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

[src/notebooks/notebookEditorProvider.ts#L30](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/notebookEditorProvider.ts#L30)
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

[src/kernels/activation.node.ts#L42](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/activation.node.ts#L42)
```typescript
        }
        this.notebookOpened = true;
        void this.PreWarmDaemonPool();
        sendTelemetryEvent(Telemetry.OpenNotebookAll);

        if (!this.rawSupported.isSupported && this.extensionChecker.isPythonExtensionInstalled) {
            // Warm up our selected interpreter for the extension
```


[src/test/datascience/telemetry.vscode.test.ts#L155](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L155)
```typescript

        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.ExecuteCell);
        assertEvent(Telemetry.OpenNotebookAll);
        assertEvent(Telemetry.NotebookStart);
    });
    test('Run interactive window', async () => {
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

Event can be removed. Not referenced anywhere

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

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_INTERRUPT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/telemetry/telemetry.ts#L366](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L366)
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
```


[src/telemetry/telemetry.ts#L367](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L367)
```typescript
function resetData(resource: Resource, eventName: string, properties: any) {
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
```


[src/telemetry/telemetry.ts#L368](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L368)
```typescript
    // Once we have successfully interrupted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookInterrupt) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookInterrupt>;
        const data: undefined | typeof kv[Telemetry.NotebookInterrupt] = properties;
        // Check result to determine if success.
        if (data && 'result' in data && data.result === InterruptResult.Success) {
            clearInterruptCounter(resource);
```


[src/notebooks/execution/kernelExecution.ts#L255](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L255)
```typescript
                // Otherwise a real error occurred.
                sendKernelTelemetryEvent(
                    this.kernel.resourceUri,
                    Telemetry.NotebookInterrupt,
                    stopWatch.elapsedTime,
                    undefined,
                    exc
```


[src/notebooks/execution/kernelExecution.ts#L267](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L267)
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

[src/platform/common/utils.ts#L164](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/utils.ts#L164)
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

[src/telemetry/telemetry.ts#L375](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L375)
```typescript
        }
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
```


[src/telemetry/telemetry.ts#L376](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L376)
```typescript
    }
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
```


[src/telemetry/telemetry.ts#L377](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L377)
```typescript
    // Once we have successfully restarted, clear the interrupt counter.
    if (eventName === Telemetry.NotebookRestart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookRestart>;
        const data: undefined | typeof kv[Telemetry.NotebookRestart] = properties;
        // For restart to be successful, we should not have `failed`
        const failed = data && 'failed' in data ? data.failed : false;
        if (!failed) {
```


[src/kernels/kernel.base.ts#L291](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L291)
```typescript
            await (this._jupyterSessionPromise
                ? this.kernelExecution.restart(this._jupyterSessionPromise)
                : this.start(new DisplayOptions(false)));
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime);
        } catch (ex) {
            traceError(`Restart failed ${getDisplayPath(this.id)}`, ex);
            this._ignoreJupyterSessionDisposedErrors = true;
```


[src/kernels/kernel.base.ts#L302](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L302)
```typescript
            this.restarting = undefined;
            // If we get a kernel promise failure, then restarting timed out. Just shutdown and restart the entire server.
            // Note, this code might not be necessary, as such an error is thrown only when interrupting a kernel times out.
            sendKernelTelemetryEvent(this.resourceUri, Telemetry.NotebookRestart, stopWatch.elapsedTime, undefined, ex);
            await session?.dispose().catch(noop);
            this._ignoreJupyterSessionDisposedErrors = false;
            throw ex;
```

</details>
<details>
  <summary>DATASCIENCE.NOTEBOOK_START</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/telemetry/telemetry.ts#L408](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L408)
```typescript
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
```


[src/telemetry/telemetry.ts#L409](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L409)
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
```


[src/telemetry/telemetry.ts#L410](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/telemetry.ts#L410)
```typescript
function incrementStartFailureCount(resource: Resource, eventName: any, properties: any) {
    if (eventName === Telemetry.NotebookStart) {
        let kv: Pick<IEventNamePropertyMapping, Telemetry.NotebookStart>;
        const data: undefined | typeof kv[Telemetry.NotebookStart] = properties;
        // Check start failed.
        if (data && 'failed' in data && data.failed) {
            trackKernelResourceInformation(resource, { startFailed: true });
```


[src/kernels/jupyter/launcher/notebookProvider.ts#L100](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/notebookProvider.ts#L100)
```typescript

        sendKernelTelemetryWhenDone(
            options.resource,
            Telemetry.NotebookStart,
            promise || Promise.resolve(undefined),
            undefined,
            {
```


[src/test/datascience/telemetry.vscode.test.ts#L156](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L156)
```typescript
        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.ExecuteCell);
        assertEvent(Telemetry.OpenNotebookAll);
        assertEvent(Telemetry.NotebookStart);
    });
    test('Run interactive window', async () => {
        const { activeInteractiveWindow } = await runNewPythonFile(
```

</details>
<details>
  <summary>DATASCIENCE.OPEN_PLOT_VIEWER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/webviews/extension-side/plotting/plotViewerProvider.node.ts#L45](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/plotting/plotViewerProvider.node.ts#L45)
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
  <summary>DATASCIENCE.PYTHON_VARIABLE_FETCHING_CODE_FAILURE</summary>

## Description


No description provided

## Properties

- 
        ename: string;
- 
        evalue: string;

## Locations Used

[src/kernels/variables/pythonVariableRequester.node.ts#L63](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/pythonVariableRequester.node.ts#L63)
```typescript
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getDataFrameInfo',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];
```


[src/kernels/variables/pythonVariableRequester.node.ts#L96](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/pythonVariableRequester.node.ts#L96)
```typescript
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getDataFrameRows',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];
```


[src/kernels/variables/pythonVariableRequester.node.ts#L129](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/pythonVariableRequester.node.ts#L129)
```typescript
                          {
                              traceErrors: true,
                              traceErrorsMessage: 'Failure in execute_request for getVariableProperties',
                              telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                          }
                      )
                    : [];
```


[src/kernels/variables/pythonVariableRequester.node.ts#L157](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/pythonVariableRequester.node.ts#L157)
```typescript
                      {
                          traceErrors: true,
                          traceErrorsMessage: 'Failure in execute_request for getVariableNamesAndTypesFromKernel',
                          telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                      }
                  )
                : [];
```


[src/kernels/variables/pythonVariableRequester.node.ts#L203](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/pythonVariableRequester.node.ts#L203)
```typescript
                  {
                      traceErrors: true,
                      traceErrorsMessage: 'Failure in execute_request for getFullVariable',
                      telemetryName: Telemetry.PythonVariableFetchingCodeFailure
                  }
              )
            : [];
```

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

[src/platform/common/extensionRecommendation.node.ts#L120](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/extensionRecommendation.node.ts#L120)
```typescript
            `[${extensionInfo.displayName}](${extensionInfo.extensionLink})`,
            language
        );
        sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'displayed' });
        const selection = await this.appShell.showInformationMessage(
            message,
            Common.bannerLabelYes(),
```


[src/platform/common/extensionRecommendation.node.ts#L129](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/extensionRecommendation.node.ts#L129)
```typescript
        );
        switch (selection) {
            case Common.bannerLabelYes(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'ok' });
                this.commandManager.executeCommand('extension.open', extensionId).then(noop, noop);
                break;
            }
```


[src/platform/common/extensionRecommendation.node.ts#L134](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/extensionRecommendation.node.ts#L134)
```typescript
                break;
            }
            case Common.bannerLabelNo(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'cancel' });
                break;
            }
            case Common.doNotShowAgain(): {
```


[src/platform/common/extensionRecommendation.node.ts#L138](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/extensionRecommendation.node.ts#L138)
```typescript
                break;
            }
            case Common.doNotShowAgain(): {
                sendTelemetryEvent(Telemetry.RecommendExtension, undefined, { extensionId, action: 'doNotShowAgain' });
                const list = this.globalMemento.get<string[]>(mementoKeyToNeverPromptExtensionAgain, []);
                if (!list.includes(extensionId)) {
                    list.push(extensionId);
```


[src/platform/common/extensionRecommendation.node.ts#L147](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/extensionRecommendation.node.ts#L147)
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

[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L200](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L200)
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

[src/kernels/kernelCommandListener.ts#L117](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelCommandListener.ts#L117)
```typescript
            return;
        }

        sendTelemetryEvent(Telemetry.RestartKernelCommand);
        const kernel = this.kernelProvider.get(document.uri);

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

[src/interactive-window/editor-integration/codewatcher.ts#L129](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L129)
```typescript
        this.closeDocumentDisposable?.dispose(); // NOSONAR
        this.updateRequiredDisposable?.dispose(); // NOSONAR
    }
    @captureTelemetry(Telemetry.RunAllCells)
    public async runAllCells() {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter(
```

</details>
<details>
  <summary>DATASCIENCE.RUN_ALL_CELLS_ABOVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L185](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L185)
```typescript
    }

    // Run all cells up to the cell containing this start line and character
    @captureTelemetry(Telemetry.RunAllCellsAbove)
    public async runAllCellsAbove(stopLine: number, stopCharacter: number) {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
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

[src/kernels/variables/debuggerVariables.node.ts#L120](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/debuggerVariables.node.ts#L120)
```typescript
            // Note, full variable results isn't necessary for this call. It only really needs the variable value.
            const result = this.lastKnownVariables.find((v) => v.name === name);
            if (result && kernel?.resourceUri?.fsPath.endsWith('.ipynb')) {
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

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DATASCIENCE.RUN_CELL_AND_ALL_BELOW</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L223](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L223)
```typescript
        await finished;
    }

    @captureTelemetry(Telemetry.RunCellAndAllBelow)
    public async runCellAndAllBelow(startLine: number, startCharacter: number) {
        const iw = await this.getActiveInteractiveWindow();
        const runCellCommands = this.codeLenses.filter((c) => c.command && c.command.command === Commands.RunCell);
```

</details>
<details>
  <summary>DATASCIENCE.RUN_CHANGE_CELL_TO_CODE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L666](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L666)
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

[src/interactive-window/editor-integration/codewatcher.ts#L659](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L659)
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

[src/interactive-window/editor-integration/codewatcher.ts#L323](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L323)
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

[src/interactive-window/editor-integration/codewatcher.ts#L351](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L351)
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

[src/interactive-window/editor-integration/codewatcher.ts#L333](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L333)
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

[src/interactive-window/editor-integration/codewatcher.ts#L423](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L423)
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

[src/interactive-window/editor-integration/codewatcher.ts#L515](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L515)
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

[src/interactive-window/editor-integration/codewatcher.ts#L581](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L581)
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

[src/interactive-window/editor-integration/codewatcher.ts#L174](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L174)
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunFileInteractive)
    public async runFileInteractive() {
        return this.runFileInteractiveInternal(false);
    }
```


[src/test/datascience/telemetry.vscode.test.ts#L173](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L173)
```typescript
        };

        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.RunFileInteractive);
        assertEvent(Telemetry.ExecuteCellPerceivedWarm);
        assertEvent(Telemetry.SwitchKernel);
    });
```

</details>
<details>
  <summary>DATASCIENCE.RUN_FROM_LINE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L285](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L285)
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunFromLine)
    public async runFromLine(targetLine: number) {
        if (this.document && targetLine < this.document.lineCount) {
            const iw = await this.getActiveInteractiveWindow();
```

</details>
<details>
  <summary>DATASCIENCE.RUN_INSERT_CELL_ABOVE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L410](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L410)
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

[src/interactive-window/editor-integration/codewatcher.ts#L397](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L397)
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

[src/interactive-window/editor-integration/codewatcher.ts#L389](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L389)
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

[src/interactive-window/editor-integration/codewatcher.ts#L654](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L654)
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

[src/interactive-window/editor-integration/codewatcher.ts#L649](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L649)
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

[src/interactive-window/editor-integration/codewatcher.ts#L460](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L460)
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

[src/interactive-window/editor-integration/codewatcher.ts#L477](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L477)
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

[src/interactive-window/editor-integration/codewatcher.ts#L248](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L248)
```typescript
        await finished;
    }

    @captureTelemetry(Telemetry.RunSelectionOrLine)
    public async runSelectionOrLine(activeEditor: TextEditor | undefined, text?: string | Uri) {
        if (this.document && activeEditor && urlPath.isEqual(activeEditor.document.uri, this.document.uri)) {
            const iw = await this.getActiveInteractiveWindow();
```

</details>
<details>
  <summary>DATASCIENCE.RUN_TO_LINE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/editor-integration/codewatcher.ts#L270](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L270)
```typescript
        }
    }

    @captureTelemetry(Telemetry.RunToLine)
    public async runToLine(targetLine: number) {
        if (this.document && targetLine > 0) {
            const iw = await this.getActiveInteractiveWindow();
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

[src/kernels/jupyter/interpreter/jupyterInterpreterSelectionCommand.node.ts#L24](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterSelectionCommand.node.ts#L24)
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

[src/kernels/jupyter/serverSelector.ts#L74](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L74)
```typescript
        @inject(IsWebExtension) private readonly isWebExtension: boolean
    ) {}

    @captureTelemetry(Telemetry.SelectJupyterURI)
    @traceDecoratorError('Failed to select Jupyter Uri')
    public selectJupyterURI(
        allowLocal: boolean,
```


[src/kernels/jupyter/launcher/commandLineSelector.ts#L36](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/commandLineSelector.ts#L36)
```typescript
        workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));
    }

    @captureTelemetry(Telemetry.SelectJupyterURI)
    public selectJupyterCommandLine(file: Uri): Promise<void> {
        const multiStep = this.multiStepFactory.create<{}>();
        return multiStep.run(this.startSelectingCommandLine.bind(this, file), {});
```

</details>
<details>
  <summary>DATASCIENCE.SELECT_LOCAL_JUPYTER_KERNEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/controllers/vscodeNotebookController.ts#L590](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L590)
```typescript
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
            const telemetryEvent = isLocalConnection(this.kernelConnection)
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

[src/notebooks/controllers/vscodeNotebookController.ts#L591](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L591)
```typescript
        if (existingKernel) {
            const telemetryEvent = isLocalConnection(this.kernelConnection)
                ? Telemetry.SelectLocalJupyterKernel
                : Telemetry.SelectRemoteJupyterKernel;
            sendKernelTelemetryEvent(document.uri, telemetryEvent);
            this.notebookApi.notebookEditors
                .filter((editor) => editor.notebook === document)
```

</details>
<details>
  <summary>DATASCIENCE.SELFCERTSMESSAGECLOSE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/jupyterUtils.ts#L63](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterUtils.ts#L63)
```typescript
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
    }
    return false;
}
```


[src/kernels/jupyter/jupyterUtils.ts#L87](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterUtils.ts#L87)
```typescript
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
    }
    return false;
}
```


[src/platform/errors/errorHandler.ts#L301](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/errors/errorHandler.ts#L301)
```typescript
                            ConfigurationTarget.Workspace
                        );
                    } else if (value === closeOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageClose);
                    }
                });
            return KernelInterpreterDependencyResponse.failed;
```


[src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L395](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L395)
```typescript
                    );
                    return this.requestCreator.getFetchMethod()(url, this.addAllowUnauthorized(url, true, options));
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

[src/kernels/jupyter/jupyterUtils.ts#L59](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterUtils.ts#L59)
```typescript
        closeOption
    );
    if (value === enableOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
```


[src/kernels/jupyter/jupyterUtils.ts#L83](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterUtils.ts#L83)
```typescript
        closeOption
    );
    if (value === enableOption) {
        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
        await config.updateSetting('allowUnauthorizedRemoteConnection', true, undefined, ConfigurationTarget.Workspace);
        return true;
    } else if (value === closeOption) {
```


[src/platform/errors/errorHandler.ts#L293](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/errors/errorHandler.ts#L293)
```typescript
                .showErrorMessage(DataScience.jupyterSelfCertFail().format(err.message), enableOption, closeOption)
                .then((value) => {
                    if (value === enableOption) {
                        sendTelemetryEvent(Telemetry.SelfCertsMessageEnabled);
                        void this.configuration.updateSetting(
                            'allowUnauthorizedRemoteConnection',
                            true,
```


[src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L386](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L386)
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

[src/kernels/jupyter/serverSelector.ts#L112](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L112)
```typescript
            return computeServerId(uri);
        }
    }
    @captureTelemetry(Telemetry.SetJupyterURIToLocal)
    public async setJupyterURIToLocal(): Promise<void> {
        await this.serverUriStorage.setUriToLocal();
    }
```

</details>
<details>
  <summary>DATASCIENCE.SET_JUPYTER_URI_UI_DISPLAYED</summary>

## Description




 This telemetry tracks the display of the Picker for Jupyter Remote servers.

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/serverSelector.ts#L80](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L80)
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

[src/kernels/jupyter/serverSelector.ts#L152](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L152)
```typescript
        await this.serverUriStorage.setUriToRemote(userURI, connection.displayName);

        // Indicate setting a jupyter URI to a remote setting. Check if an azure remote or not
        sendTelemetryEvent(Telemetry.SetJupyterURIToUserSpecified, undefined, {
            azure: userURI.toLowerCase().includes('azure')
        });
    }
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

[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L233](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L233)
```typescript

        // Log telemetry about number of rows
        try {
            sendTelemetryEvent(Telemetry.ShowDataViewer, 0, {
                rows: output.rowCount ? output.rowCount : 0,
                columns: output.columns ? output.columns.length : 0
            });
```


[src/webviews/extension-side/dataviewer/dataViewer.node.ts#L316](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewer.node.ts#L316)
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

[src/webviews/extension-side/dataviewer/dataViewerFactory.ts#L41](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerFactory.ts#L41)
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

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L204](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L204)
```typescript
                }

                case DataScience.selectDifferentJupyterInterpreter(): {
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.selectAnotherInterpreter;
                }

```


[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L210](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L210)
```typescript

                case DataScience.pythonInteractiveHelpLink(): {
                    this.applicationShell.openUrl(HelpLinks.PythonInteractiveHelpLink);
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.cancel;
                }

```


[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L215](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L215)
```typescript
                }

                default:
                    sendTelemetryEvent(Telemetry.UserDidNotInstallJupyter);
                    return JupyterInterpreterDependencyResponse.cancel;
            }
        } finally {
```

</details>
<details>
  <summary>DATASCIENCE.USER_DID_NOT_INSTALL_PANDAS</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L109](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L109)
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

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L197](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L197)
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

[src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L106](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L106)
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
  <summary>DATASCIENCE.USER_STARTUP_CODE_FAILURE</summary>

## Description


No description provided

## Properties

- 
        ename: string;
- 
        evalue: string;

## Locations Used

[src/kernels/kernel.base.ts#L552](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L552)
```typescript
            await this.executeSilently(session, this.getUserStartupCommands(), {
                traceErrors: true,
                traceErrorsMessage: 'Error executing user defined startup code',
                telemetryName: Telemetry.UserStartupCodeFailure
            });
        }

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

[src/platform/api/pythonApi.ts#L335](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/pythonApi.ts#L335)
```typescript
        }
    }
    private workspaceCachedActiveInterpreter = new Map<string, Promise<PythonEnvironment | undefined>>();
    @captureTelemetry(Telemetry.ActiveInterpreterListingPerf)
    @traceDecoratorVerbose('Get Active Interpreter', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined> {
        this.hookupOnDidChangeInterpreterEvent();
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

[src/interactive-window/editor-integration/codelensprovider.ts#L68](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codelensprovider.ts#L68)
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

[src/platform/common/application/commandManager.ts#L37](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/application/commandManager.ts#L37)
```typescript
        return commands.registerCommand(
            command,
            (...args: U) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, ...(args as any));
                } else {
```


[src/platform/common/application/commandManager.ts#L71](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/application/commandManager.ts#L71)
```typescript
        return commands.registerTextEditorCommand(
            command,
            (textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) => {
                sendTelemetryEvent(Telemetry.CommandExecuted, undefined, { command: command as string });
                if (thisArg) {
                    return callback.call(thisArg, textEditor, edit, ...args);
                } else {
```


[src/platform/common/application/commandManager.ts#L102](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/application/commandManager.ts#L102)
```typescript
        U extends ICommandNameArgumentTypeMapping[E]
    >(command: E, ...rest: U): Thenable<T> {
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

[src/kernels/jupyter/launcher/jupyterExecution.ts#L167](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L167)
```typescript
                                throw new RemoteJupyterServerConnectionError(connection.baseUrl, options.serverId, err);
                            }
                        } else {
                            sendTelemetryEvent(Telemetry.ConnectFailedJupyter, undefined, undefined, err, true);
                            throw new LocalJupyterServerConnectionError(err);
                        }
                    } else {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTLOCALJUPYTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterExecution.ts#L128](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L128)
```typescript
                    traceInfo(`Connection complete server`);

                    sendTelemetryEvent(
                        options.localJupyter ? Telemetry.ConnectLocalJupyter : Telemetry.ConnectRemoteJupyter
                    );
                    return result;
                } catch (err) {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEEXPIREDCERTFAILEDJUPYTER</summary>

## Description




 Jupyter server's certificate has expired.

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterExecution.ts#L161](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L161)
```typescript
                                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                                throw new JupyterSelfCertsError(connection.baseUrl);
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteExpiredCertFailedJupyter);
                                throw new JupyterSelfCertsExpiredError(connection.baseUrl);
                            } else {
                                throw new RemoteJupyterServerConnectionError(connection.baseUrl, options.serverId, err);
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEFAILEDJUPYTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterExecution.ts#L154](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L154)
```typescript

                        // Something else went wrong
                        if (!options.localJupyter) {
                            sendTelemetryEvent(Telemetry.ConnectRemoteFailedJupyter, undefined, undefined, err, true);

                            // Check for the self signed certs error specifically
                            if (JupyterSelfCertsError.isSelfCertsError(err)) {
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTEJUPYTER</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterExecution.ts#L128](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L128)
```typescript
                    traceInfo(`Connection complete server`);

                    sendTelemetryEvent(
                        options.localJupyter ? Telemetry.ConnectLocalJupyter : Telemetry.ConnectRemoteJupyter
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

[src/kernels/jupyter/launcher/jupyterExecution.ts#L118](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L118)
```typescript
                    connection = await this.startOrConnect(options, cancelToken);

                    if (!connection.localLaunch && LocalHosts.includes(connection.hostName.toLowerCase())) {
                        sendTelemetryEvent(Telemetry.ConnectRemoteJupyterViaLocalHost);
                    }
                    // eslint-disable-next-line no-constant-condition
                    traceInfo(`Connecting to process server`);
```

</details>
<details>
  <summary>DS_INTERNAL.CONNECTREMOTESELFCERTFAILEDJUPYTER</summary>

## Description




 Jupyter server's certificate is not from a trusted authority.

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/serverSelector.ts#L125](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L125)
```typescript
            }
        } catch (err) {
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
```


[src/kernels/jupyter/serverSelector.ts#L131](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L131)
```typescript
                    return;
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return;
```


[src/kernels/jupyter/serverSelector.ts#L271](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L271)
```typescript
        } catch (err) {
            traceWarning('Uri verification error', err);
            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleSelfCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return DataScience.jupyterSelfCertFailErrorMessageOnly();
```


[src/kernels/jupyter/serverSelector.ts#L277](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L277)
```typescript
                    return DataScience.jupyterSelfCertFailErrorMessageOnly();
                }
            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                const handled = await handleExpiredCertsError(this.applicationShell, this.configService, err.message);
                if (!handled) {
                    return DataScience.jupyterSelfCertExpiredErrorMessageOnly();
```


[src/kernels/jupyter/launcher/jupyterExecution.ts#L158](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L158)
```typescript

                            // Check for the self signed certs error specifically
                            if (JupyterSelfCertsError.isSelfCertsError(err)) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteSelfCertFailedJupyter);
                                throw new JupyterSelfCertsError(connection.baseUrl);
                            } else if (JupyterSelfCertsExpiredError.isSelfCertsExpiredError(err)) {
                                sendTelemetryEvent(Telemetry.ConnectRemoteExpiredCertFailedJupyter);
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

[src/kernels/raw/session/hostRawNotebookProvider.node.ts#L90](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/hostRawNotebookProvider.node.ts#L90)
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

[src/notebooks/execution/cellExecution.ts#L449](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/cellExecution.ts#L449)
```typescript
        const props = { notebook: true };
        if (!CellExecution.sentExecuteCellTelemetry) {
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatchForTelemetry.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatchForTelemetry.elapsedTime, props);
        }
```


[src/interactive-window/editor-integration/codewatcher.ts#L1010](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L1010)
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

[src/notebooks/execution/cellExecution.ts#L451](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/cellExecution.ts#L451)
```typescript
            CellExecution.sentExecuteCellTelemetry = true;
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, this.stopWatchForTelemetry.elapsedTime, props);
        } else {
            sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, this.stopWatchForTelemetry.elapsedTime, props);
        }
    }
    private canExecuteCell() {
```


[src/interactive-window/editor-integration/codewatcher.ts#L1012](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/codewatcher.ts#L1012)
```typescript
                CodeWatcher.sentExecuteCellTelemetry = true;
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedCold, runningStopWatch.elapsedTime);
            } else {
                sendTelemetryEvent(Telemetry.ExecuteCellPerceivedWarm, runningStopWatch.elapsedTime);
            }
        }
    }
```


[src/test/datascience/telemetry.vscode.test.ts#L174](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L174)
```typescript

        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.RunFileInteractive);
        assertEvent(Telemetry.ExecuteCellPerceivedWarm);
        assertEvent(Telemetry.SwitchKernel);
    });
});
```

</details>
<details>
  <summary>DS_INTERNAL.FAILED_TO_UPDATE_JUPYTER_KERNEL_SPEC</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/jupyterKernelService.node.ts#L217](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterKernelService.node.ts#L217)
```typescript
            await this.fs.writeLocalFile(kernelSpecFilePath.fsPath, JSON.stringify(contents, undefined, 4));
        } catch (ex) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendTelemetryEvent(Telemetry.FailedToUpdateKernelSpec, undefined, undefined, ex as any, true);
            throw ex;
        }
        if (cancelToken.isCancellationRequested) {
```


[src/kernels/jupyter/jupyterKernelService.node.ts#L349](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterKernelService.node.ts#L349)
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

[src/platform/common/process/environmentActivationService.node.ts#L252](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L252)
```typescript
        ]);

        const envType = interpreter.envType;
        sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
            envType,
            pythonEnvType: envType,
            source: 'python',
```


[src/platform/common/process/environmentActivationService.node.ts#L304](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L304)
```typescript
                    interpreter?.uri
                )}, shell cannot be determined.`
            );
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, 0, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
```


[src/platform/common/process/environmentActivationService.node.ts#L347](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L347)
```typescript
                const stopWatch = new StopWatch();
                try {
                    const env = await this.getCondaEnvVariables(resource, interpreter);
                    sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                        envType,
                        pythonEnvType: envType,
                        source: 'jupyter',
```


[src/platform/common/process/environmentActivationService.node.ts#L356](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L356)
```typescript
                    });
                    return env;
                } catch (ex) {
                    sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                        envType,
                        pythonEnvType: envType,
                        source: 'jupyter',
```


[src/platform/common/process/environmentActivationService.node.ts#L400](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L400)
```typescript
            const processService = await processServicePromise;
            const hasCustomEnvVars = Object.keys(customEnvVars).length;
            if (!activationCommands || activationCommands.length === 0) {
                sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                    envType,
                    pythonEnvType: envType,
                    source: 'jupyter',
```


[src/platform/common/process/environmentActivationService.node.ts#L492](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L492)
```typescript
            } else if (returnedEnv) {
                delete returnedEnv[PYTHON_WARNINGS];
            }
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
```


[src/platform/common/process/environmentActivationService.node.ts#L502](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/environmentActivationService.node.ts#L502)
```typescript

            return returnedEnv;
        } catch (e) {
            sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, stopWatch.elapsedTime, {
                envType,
                pythonEnvType: envType,
                source: 'jupyter',
```

</details>
<details>
  <summary>DS_INTERNAL.GET_PASSWORD_FAILURE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L259](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L259)
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

[src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L254](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterPasswordConnect.ts#L254)
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

[src/kernels/jupyter/jupyterCellOutputMimeTypeTracker.node.ts#L154](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterCellOutputMimeTypeTracker.node.ts#L154)
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

[src/kernels/jupyter/jupyterCellOutputMimeTypeTracker.node.ts#L120](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterCellOutputMimeTypeTracker.node.ts#L120)
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

[src/interactive-window/editor-integration/hoverProvider.ts#L79](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/editor-integration/hoverProvider.ts#L79)
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

[src/platform/api/pythonApi.ts#L307](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/pythonApi.ts#L307)
```typescript
        return this.didChangeInterpreters.event;
    }

    @captureTelemetry(Telemetry.InterpreterListingPerf)
    @traceDecoratorVerbose('Get Interpreters', TraceOptions.Arguments | TraceOptions.BeforeCall)
    public getInterpreters(resource?: Uri): Promise<PythonEnvironment[]> {
        this.hookupOnDidChangeInterpreterEvent();
```

</details>
<details>
  <summary>DS_INTERNAL.INTERRUPT_JUPYTER_TIME</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/notebooks/execution/kernelExecution.ts#L200](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L200)
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

[src/platform/errors/jupyterInvalidKernelError.ts#L18](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/errors/jupyterInvalidKernelError.ts#L18)
```typescript
            DataScience.kernelInvalid().format(getDisplayNameOrNameOfKernelConnection(kernelConnectionMetadata)),
            kernelConnectionMetadata
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

[src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSource.ts#L171](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSource.ts#L171)
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

[src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L205](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L205)
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

[src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L164](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L164)
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

[src/kernels/ipywidgets-message-coordination/ipyWidgetMessageDispatcher.ts#L494](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/ipyWidgetMessageDispatcher.ts#L494)
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

[src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L201](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L201)
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

[src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L231](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L231)
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

[src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L228](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L228)
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

[src/kernels/ipywidgets-message-coordination/localWidgetScriptSourceProvider.node.ts#L52](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/localWidgetScriptSourceProvider.node.ts#L52)
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

[src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L247](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L247)
```typescript
                this.jupyterOutput.appendLine(
                    DataScience.unhandledMessage().format(msg.header.msg_type, JSON.stringify(msg.content))
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

[src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L118](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/ipyWidgetScriptSourceProvider.ts#L118)
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

[src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L217](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/ipywidgets-message-coordination/commonMessageCoordinator.ts#L217)
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

[src/kernels/jupyter/launcher/liveshare/hostJupyterServer.ts#L184](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/liveshare/hostJupyterServer.ts#L184)
```typescript
            this.throwIfDisposedOrCancelled(cancelToken);
            const baseUrl = this.connection?.baseUrl || '';
            this.logRemoteOutput(DataScience.createdNewNotebook().format(baseUrl));
            sendKernelTelemetryEvent(resource, Telemetry.JupyterCreatingNotebook, stopWatch.elapsedTime);
            return session;
        } catch (ex) {
            sendKernelTelemetryEvent(
```


[src/kernels/jupyter/launcher/liveshare/hostJupyterServer.ts#L189](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/liveshare/hostJupyterServer.ts#L189)
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

[src/kernels/jupyter/launcher/commandLineSelector.ts#L93](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/commandLineSelector.ts#L93)
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

[src/platform/errors/jupyterWaitForIdleError.ts#L14](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/errors/jupyterWaitForIdleError.ts#L14)
```typescript
export class JupyterWaitForIdleError extends BaseKernelError {
    constructor(kernelConnectionMetadata: KernelConnectionMetadata) {
        super('timeout', DataScience.jupyterLaunchTimedOut(), kernelConnectionMetadata);
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

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L326](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L326)
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

[src/kernels/jupyter/jupyterKernelService.node.ts#L160](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterKernelService.node.ts#L160)
```typescript
     */
    // eslint-disable-next-line
    // eslint-disable-next-line complexity
    @captureTelemetry(Telemetry.RegisterInterpreterAsKernel, undefined, true)
    @traceDecoratorError('Failed to register an interpreter as a kernel')
    // eslint-disable-next-line
    private async registerKernel(
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

Event can be removed. Not referenced anywhere

</details>
<details>
  <summary>DS_INTERNAL.JUPYTERSTARTUPCOST</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/launcher/jupyterExecution.ts#L218](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/jupyterExecution.ts#L218)
```typescript
    }

    // eslint-disable-next-line
    @captureTelemetry(Telemetry.StartJupyter)
    private async startNotebookServer(
        resource: Resource,
        useDefaultConfig: boolean,
```

</details>
<details>
  <summary>DS_INTERNAL.KERNEL_COUNT</summary>

## Description



 Misc

## Properties


No properties for event


## Locations Used

[src/telemetry/kernelTelemetry.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/kernelTelemetry.ts#L54)
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
  <summary>DS_INTERNAL.KERNEL_LAUNCHER_PERF</summary>

## Description




 Total time taken to Launch a raw kernel.

## Properties


No properties for event


## Locations Used

[src/kernels/raw/launcher/kernelLauncher.node.ts#L117](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/launcher/kernelLauncher.node.ts#L117)
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

[src/kernels/raw/finder/localKnownPathKernelSpecFinder.node.ts#L49](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/finder/localKnownPathKernelSpecFinder.node.ts#L49)
```typescript
    /**
     * @param {boolean} includePythonKernels Include/exclude Python kernels in the result.
     */
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localKernelSpec' })
    public async listKernelSpecs(
        includePythonKernels: boolean,
        cancelToken?: CancellationToken
```


[src/kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node.ts#L60](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/finder/localPythonAndRelatedNonPythonKernelSpecFinder.node.ts#L60)
```typescript
    ) {
        super(fs, workspaceService, extensionChecker, globalState);
    }
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'localPython' })
    public async listKernelSpecs(resource: Resource, ignoreCache?: boolean, cancelToken?: CancellationToken) {
        // Get an id for the workspace folder, if we don't have one, use the fsPath of the resource
        const workspaceFolderId =
```


[src/kernels/raw/finder/localKernelFinder.node.ts#L31](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/finder/localKernelFinder.node.ts#L31)
```typescript
     * Search all our local file system locations for installed kernel specs and return them
     */
    @traceDecoratorError('List kernels failed')
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'local' })
    public async listKernels(
        resource: Resource,
        @ignoreLogging() cancelToken?: CancellationToken
```


[src/kernels/jupyter/remoteKernelFinder.ts#L43](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/remoteKernelFinder.ts#L43)
```typescript
    ) {}

    // Talk to the remote server to determine sessions
    @captureTelemetry(Telemetry.KernelListingPerf, { kind: 'remote' })
    public async listKernels(
        _resource: Resource,
        connInfo: INotebookProviderConnection,
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

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L302](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L302)
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

[src/webviews/extension-side/variablesView/variableView.node.ts#L80](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/variablesView/variableView.node.ts#L80)
```typescript
        console.log(`Done initing variables`);
    }

    @captureTelemetry(Telemetry.NativeVariableViewLoaded)
    public async load(codeWebview: vscodeWebviewView) {
        await super.loadWebview(Uri.file(process.cwd()), codeWebview).catch(traceError);

```

</details>
<details>
  <summary>DS_INTERNAL.NATIVE_VARIABLE_VIEW_MADE_VISIBLE</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/webviews/extension-side/variablesView/variableView.node.ts#L139](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/variablesView/variableView.node.ts#L139)
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

[src/notebooks/notebookUsageTracker.ts#L46](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/notebookUsageTracker.ts#L46)
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

[src/notebooks/notebookUsageTracker.ts#L49](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/notebookUsageTracker.ts#L49)
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

[src/kernels/jupyter/preferredRemoteKernelIdProvider.ts#L69](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/preferredRemoteKernelIdProvider.ts#L69)
```typescript
        }

        // Prune list if too big
        sendTelemetryEvent(Telemetry.NumberOfSavedRemoteKernelIds, undefined, { count: list.length });
        while (list.length > MaximumKernelIdListSize) {
            requiresUpdate = true;
            list.shift();
```

</details>
<details>
  <summary>DS_INTERNAL.PERCEIVED_JUPYTER_STARTUP_NOTEBOOK</summary>

## Description




 Time take for jupyter server to start and be ready to run first user cell.

## Properties


No properties for event


## Locations Used

[src/kernels/kernel.base.ts#L332](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L332)
```typescript
        // Setup telemetry
        if (!this.perceivedJupyterStartupTelemetryCaptured) {
            this.perceivedJupyterStartupTelemetryCaptured = true;
            sendTelemetryEvent(Telemetry.PerceivedJupyterStartupNotebook, stopWatch.elapsedTime);
            executionPromise.finally(() =>
                sendTelemetryEvent(Telemetry.StartExecuteNotebookCellPerceivedCold, stopWatch.elapsedTime)
            );
```


[src/kernels/kernel.base.ts#L424](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L424)
```typescript

            sendKernelTelemetryEvent(
                this.resourceUri,
                Telemetry.PerceivedJupyterStartupNotebook,
                stopWatch.elapsedTime
            );
            this._session = session;
```

</details>
<details>
  <summary>DS_INTERNAL.PREFERRED_KERNEL</summary>

## Description




 Telemetry sent when we have attempted to find the preferred kernel.

## Properties


No properties for event


## Locations Used

[src/notebooks/controllers/notebookControllerManager.ts#L774](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/notebookControllerManager.ts#L774)
```typescript
                ? PYTHON_LANGUAGE
                : getTelemetrySafeLanguage(getLanguageInNotebookMetadata(notebookMetadata) || '');

        sendTelemetryEvent(Telemetry.PreferredKernel, undefined, {
            result: preferredConnection ? 'found' : 'notfound',
            resourceType,
            language: telemetrySafeLanguage,
```

</details>
<details>
  <summary>DS_INTERNAL.PREFERRED_KERNEL_EXACT_MATCH</summary>

## Description


No description provided

## Properties

- 
        matchedReason: PreferredKernelExactMatchReason;

## Locations Used

[src/notebooks/controllers/notebookControllerManager.ts#L754](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/notebookControllerManager.ts#L754)
```typescript
            onlyConnection && (matchReason |= PreferredKernelExactMatchReason.OnlyKernel);
            topMatchIsPreferredInterpreter && (matchReason |= PreferredKernelExactMatchReason.WasPreferredInterpreter);
            isExactMatch && (matchReason |= PreferredKernelExactMatchReason.IsExactMatch);
            sendTelemetryEvent(Telemetry.PreferredKernelExactMatch, undefined, {
                matchedReason: matchReason
            });
        }
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

[src/platform/api/pythonApi.ts#L214](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/pythonApi.ts#L214)
```typescript
        // Ask user if they want to install and then wait for them to actually install it.
        const yes = localize.Common.bannerLabelYes();
        const no = localize.Common.bannerLabelNo();
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const answer = await this.appShell.showInformationMessage(
            localize.DataScience.pythonExtensionRequired(),
            { modal: true },
```


[src/platform/api/pythonApi.ts#L222](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/pythonApi.ts#L222)
```typescript
            no
        );
        if (answer === yes) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```


[src/platform/api/pythonApi.ts#L225](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/api/pythonApi.ts#L225)
```typescript
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            await this.installPythonExtension();
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
        }
    }
    private async installPythonExtension() {
```


[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L67](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L67)
```typescript
        }
    }
    private async handleExecutionWithoutPythonExtension() {
        sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showInformationMessage(
            DataScience.pythonExtensionRequiredToRunNotebook(),
            { modal: true },
```


[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L74](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L74)
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'download' });
            this.commandManager.executeCommand('extension.open', PythonExtension).then(noop, noop);
        } else {
            sendTelemetryEvent(Telemetry.PythonExtensionNotInstalled, undefined, { action: 'dismissed' });
```


[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L77](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L77)
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

[src/kernels/helpers.node.ts#L51](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/helpers.node.ts#L51)
```typescript
        }
        const sysExecutable = concatMultilineString(output.text).trim().toLowerCase();
        const match = areInterpreterPathsSame(kernelConnection.interpreter.uri, Uri.file(sysExecutable));
        sendTelemetryEvent(Telemetry.PythonKerneExecutableMatches, undefined, {
            match: match ? 'true' : 'false',
            kernelConnectionType: kernelConnection.kind
        });
```


[src/kernels/helpers.node.ts#L78](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/helpers.node.ts#L78)
```typescript
                        Uri.file(execOutput.stdout.trim().toLowerCase()),
                        Uri.file(sysExecutable)
                    );
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
            | 'cancelled' // User cancelled the installation or closed the notebook or the like.
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
            | 'installedInJupyter' // The package was successfully installed in Jupyter whilst failed to install in Python ext.
            | 'failedToInstallInJupyter' // Failed to install the package in Jupyter as well as Python ext.
            | 'dismissed';
-  // User chose to dismiss the prompt.
        resourceType?: 'notebook' | 'interactive';
- 
        /**
         * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
         * If we run the same notebook tomorrow, the hash will be the same.
         */
        resourceHash?: string;
- 
        pythonEnvType?: EnvironmentType;

## Locations Used

[src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L148](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterDependencyService.node.ts#L148)
```typescript
                pipInstalledInNonCondaEnv === false ? [Product.pip].concat(missingProducts) : missingProducts,
                interpreter.displayName
            );
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'displayed',
                moduleName: ProductNames.get(Product.jupyter)!,
                pythonEnvType: interpreter.envType
```


[src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L72](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L72)
```typescript
        interpreter: PythonEnvironment,
        tokenSource: CancellationTokenSource
    ): Promise<void> {
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: ProductNames.get(Product.pandas)!,
            pythonEnvType: interpreter?.envType
```


[src/kernels/installer/productInstaller.node.ts#L276](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/installer/productInstaller.node.ts#L276)
```typescript
            action = 'failed';
            throw ex;
        } finally {
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action,
                moduleName: ProductNames.get(product)!
            });
```


[src/kernels/kernelDependencyService.node.ts#L220](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L220)
```typescript
        const productNameForTelemetry = products.map((product) => ProductNames.get(product)!).join(', ');
        const resourceType = resource ? getResourceType(resource) : undefined;
        const resourceHash = resource ? getTelemetrySafeHashedString(resource.toString()) : undefined;
        sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
            action: 'displayed',
            moduleName: productNameForTelemetry,
            resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L242](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L242)
```typescript
            : [Common.install()];
        try {
            if (!this.isCodeSpace) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'prompted',
                    moduleName: productNameForTelemetry,
                    resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L258](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L258)
```typescript
                      promptCancellationPromise
                  ]);
            if (cancelTokenSource.token.isCancellationRequested) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'dismissed',
                    moduleName: productNameForTelemetry,
                    resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L268](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L268)
```typescript
                return KernelInterpreterDependencyResponse.cancel;
            }
            if (selection === selectKernel) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'differentKernel',
                    moduleName: productNameForTelemetry,
                    resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L277](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L277)
```typescript
                });
                return KernelInterpreterDependencyResponse.selectDifferentKernel;
            } else if (selection === Common.install()) {
                sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                    action: 'install',
                    moduleName: productNameForTelemetry,
                    resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L301](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L301)
```typescript
                    cancellationPromise
                ]);
                if (response === InstallerResponse.Installed) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                        action: 'installed',
                        moduleName: productNameForTelemetry,
                        resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L310](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L310)
```typescript
                    });
                    return KernelInterpreterDependencyResponse.ok;
                } else if (response === InstallerResponse.Ignore) {
                    sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                        action: 'failed',
                        moduleName: productNameForTelemetry,
                        resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L321](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L321)
```typescript
                }
            }

            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'dismissed',
                moduleName: productNameForTelemetry,
                resourceType,
```


[src/kernels/kernelDependencyService.node.ts#L331](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelDependencyService.node.ts#L331)
```typescript
            return KernelInterpreterDependencyResponse.cancel;
        } catch (ex) {
            traceError(`Failed to install ${productNameForTelemetry}`, ex);
            sendTelemetryEvent(Telemetry.PythonModuleInstall, undefined, {
                action: 'error',
                moduleName: productNameForTelemetry,
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

[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L81](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L81)
```typescript
        }
    }
    private async handleExecutionWithoutPython() {
        sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'displayed' });
        const selection = await this.appShell.showErrorMessage(
            DataScience.pythonNotInstalledNonMarkdown(),
            { modal: true },
```


[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L88](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L88)
```typescript
            Common.install()
        );
        if (selection === Common.install()) {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'download' });
            this.appShell.openUrl('https://www.python.org/downloads');
        } else {
            sendTelemetryEvent(Telemetry.PythonNotInstalled, undefined, { action: 'dismissed' });
```


[src/notebooks/controllers/noPythonKernelsNotebookController.ts#L91](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/noPythonKernelsNotebookController.ts#L91)
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
  <summary>DS_INTERNAL.RANK_KERNELS_PERF</summary>

## Description




 Total time taken to find a kernel on disc or on a remote machine.

## Properties


No properties for event


## Locations Used

[src/kernels/kernelFinder.base.ts#L51](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelFinder.base.ts#L51)
```typescript
    ) {}

    @traceDecoratorVerbose('Rank Kernels', TraceOptions.BeforeCall | TraceOptions.Arguments)
    @captureTelemetry(Telemetry.RankKernelsPerf)
    public async rankKernels(
        resource: Resource,
        notebookMetadata?: nbformat.INotebookMetadata,
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_CREATING_NOTEBOOK</summary>

## Description



 Telemetry send when we create a notebook for a raw kernel or jupyter

## Properties


No properties for event


## Locations Used

[src/kernels/raw/session/hostRawNotebookProvider.node.ts#L69](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/hostRawNotebookProvider.node.ts#L69)
```typescript
        return this.rawNotebookSupportedService.isSupported;
    }

    @captureTelemetry(Telemetry.RawKernelCreatingNotebook, undefined, true)
    public async createNotebook(
        resource: Resource,
        kernelConnection: KernelConnectionMetadata,
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L350](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L350)
```typescript
        } else {
            traceWarning(`Didn't get response for requestKernelInfo after ${stopWatch.elapsedTime}ms.`);
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

[src/kernels/raw/launcher/kernelProcess.node.ts#L135](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/launcher/kernelProcess.node.ts#L135)
```typescript
        }
    }

    @captureTelemetry(Telemetry.RawKernelProcessLaunch, undefined, true)
    public async launch(workingDirectory: string, timeout: number, cancelToken: CancellationToken): Promise<void> {
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L142](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L142)
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

[src/kernels/raw/session/rawSession.node.ts#L101](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawSession.node.ts#L101)
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

[src/kernels/raw/launcher/kernelLauncher.node.ts#L224](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/launcher/kernelLauncher.node.ts#L224)
```typescript

        const disposable = kernelProcess.exited(
            ({ exitCode, reason }) => {
                sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
                    exitCode,
                    exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(reason)
                });
```


[src/kernels/raw/session/rawSession.node.ts#L282](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawSession.node.ts#L282)
```typescript
        traceError(`Disposing session as kernel process died ExitCode: ${e.exitCode}, Reason: ${e.reason}`);
        // Send telemetry so we know why the kernel process exited,
        // as this affects our kernel startup success
        sendTelemetryEvent(Telemetry.RawKernelSessionKernelProcessExited, undefined, {
            exitCode: e.exitCode,
            exitReason: getTelemetrySafeErrorMessageFromPythonTraceback(e.reason)
        });
```


[src/kernels/raw/session/rawJupyterSession.node.ts#L186](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L186)
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

[src/kernels/kernelConnector.ts#L144](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernelConnector.ts#L144)
```typescript
        const rawNotebookProvider = serviceContainer.tryGet<IRawNotebookProvider>(IRawNotebookProvider);
        const rawLocalKernel = rawNotebookProvider?.isSupported && isLocal;
        if (rawLocalKernel && errorContext === 'start') {
            sendKernelTelemetryEvent(resource, Telemetry.RawKernelSessionStartNoIpykernel, {
                reason: handleResult
            });
        }
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L160](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L160)
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L85](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L85)
```typescript
            Cancellation.throwIfCanceled(options.token);
            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo(
                `${DataScience.kernelStarted().format(
                    getDisplayNameOrNameOfKernelConnection(this.kernelConnectionMetadata)
```


[src/kernels/raw/session/rawJupyterSession.node.ts#L100](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L100)
```typescript
            if (isCancellationError(error) || options.token.isCancellationRequested) {
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```


[src/kernels/raw/session/rawJupyterSession.node.ts#L111](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L111)
```typescript
            } else if (error instanceof TimedOutError) {
                sendKernelTelemetryEvent(
                    this.resource,
                    Telemetry.RawKernelSessionStart,
                    stopWatch.elapsedTime,
                    undefined,
                    error
```


[src/kernels/raw/session/rawJupyterSession.node.ts#L123](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L123)
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L131](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L131)
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L84](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L84)
```typescript
            newSession = await this.startRawSession(options);
            Cancellation.throwIfCanceled(options.token);
            // Only connect our session if we didn't cancel or timeout
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartSuccess);
            sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStart, stopWatch.elapsedTime);
            traceInfo(
                `${DataScience.kernelStarted().format(
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_TIMEOUT</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/raw/session/rawJupyterSession.node.ts#L116](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L116)
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartTimeout);
                traceError('Raw session failed to start in given timeout');
                throw error;
            } else {
```

</details>
<details>
  <summary>DS_INTERNAL.RAWKERNEL_SESSION_START_USER_CANCEL</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/kernels/raw/session/rawJupyterSession.node.ts#L105](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L105)
```typescript
                    undefined,
                    error
                );
                sendKernelTelemetryEvent(this.resource, Telemetry.RawKernelSessionStartUserCancel);
                traceVerbose('Starting of raw session cancelled by user');
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

[src/kernels/raw/session/rawJupyterSession.node.ts#L238](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawJupyterSession.node.ts#L238)
```typescript
        return this.startRawSession({ token: cancelToken, ui: new DisplayOptions(disableUI) });
    }

    @captureTelemetry(Telemetry.RawKernelStartRawSession, undefined, true)
    private async startRawSession(options: { token: CancellationToken; ui: IDisplayOptions }): Promise<RawSession> {
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

[src/kernels/jupyter/jupyterKernelService.node.ts#L239](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/jupyterKernelService.node.ts#L239)
```typescript
            );
        }

        sendTelemetryEvent(Telemetry.RegisterAndUseInterpreterAsKernel);
        return kernelSpecFilePath.fsPath;
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

[src/notebooks/execution/kernelExecution.ts#L275](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L275)
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

[src/notebooks/execution/kernelExecution.ts#L274](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/execution/kernelExecution.ts#L274)
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
  <summary>DS_INTERNAL.RUNTEST</summary>

## Description


No description provided

## Properties

- 
        testName: string;
- 
        testResult: string;
- 
        perfWarmup?: 'true';
- 
        commitHash?: string;
- 
        timedCheckpoints?: string;

## Locations Used

[src/test/testHooks.node.ts#L50](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/testHooks.node.ts#L50)
```typescript
            dimensions = { ...dimensions, commitHash: process.env.GIT_SHA };
        }

        telemetryReporter.sendDangerousTelemetryEvent(Telemetry.RunTest, dimensions, measures);
    },
    afterAll: async () => {
        if (!IS_CI_SERVER) {
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

[src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L84](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L84)
```typescript
    public async selectInterpreter(): Promise<PythonEnvironment | undefined> {
        const interpreter = await this.jupyterInterpreterSelector.selectInterpreter();
        if (!interpreter) {
            sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'notSelected' });
            return;
        }

```


[src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L95](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L95)
```typescript
                return interpreter;
            }
            case JupyterInterpreterDependencyResponse.cancel:
                sendTelemetryEvent(Telemetry.SelectJupyterInterpreter, undefined, { result: 'installationCancelled' });
                return;
            default:
                return this.selectInterpreter();
```


[src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L160](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterService.node.ts#L160)
```typescript
        this._selectedInterpreter = interpreter;
        this._onDidChangeInterpreter.fire(interpreter);
        this.interpreterSelectionState.updateSelectedPythonPath(interpreter.uri);
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

[src/kernels/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.node.ts#L92](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/interpreter/jupyterInterpreterSubCommandExecutionService.node.ts#L92)
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

[src/platform/common/globalActivation.ts#L143](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/globalActivation.ts#L143)
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

[src/interactive-window/shiftEnterBanner.ts#L68](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/shiftEnterBanner.ts#L68)
```typescript
            return;
        }

        sendTelemetryEvent(Telemetry.ShiftEnterBannerShown);
        const response = await this.appShell.showInformationMessage(this.bannerMessage, ...this.bannerLabels);
        switch (response) {
            case this.bannerLabels[InteractiveShiftEnterLabelIndex.Yes]: {
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L71](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L71)
```typescript
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });
```


[src/test/datascience/shiftEnterBanner.unit.test.ts#L102](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/shiftEnterBanner.unit.test.ts#L102)
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

[src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L61](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L61)
```typescript
                throw new Error(DataScience.pandasTooOldForViewingFormat().format(versionStr));
            }

            sendTelemetryEvent(Telemetry.PandasNotInstalled);
            await this.installMissingDependencies(interpreter, tokenSource);
        } finally {
            tokenSource.dispose();
```

</details>
<details>
  <summary>DS_INTERNAL.SHOW_DATA_PANDAS_TOO_OLD</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L55](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/dataviewer/dataViewerDependencyService.node.ts#L55)
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

[src/kernels/kernel.base.ts#L334](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/kernel.base.ts#L334)
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

[src/kernels/jupyter/launcher/notebookStarter.node.ts#L156](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/launcher/notebookStarter.node.ts#L156)
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

Event can be removed. Not referenced anywhere

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

[src/kernels/common/baseJupyterSession.ts#L70](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/common/baseJupyterSession.ts#L70)
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

[src/notebooks/controllers/vscodeNotebookController.ts#L585](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L585)
```typescript
            default:
            // We don't know as its the default kernel on Jupyter server.
        }
        sendKernelTelemetryEvent(document.uri, Telemetry.SwitchKernel);
        // If we have an existing kernel, then we know for a fact the user is changing the kernel.
        // Else VSC is just setting a kernel for a notebook after it has opened.
        if (existingKernel) {
```


[src/test/datascience/telemetry.vscode.test.ts#L175](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/datascience/telemetry.vscode.test.ts#L175)
```typescript
        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.RunFileInteractive);
        assertEvent(Telemetry.ExecuteCellPerceivedWarm);
        assertEvent(Telemetry.SwitchKernel);
    });
});

```

</details>
<details>
  <summary>DS_INTERNAL.SWITCH_TO_EXISTING_KERNEL</summary>

## Description


No description provided

## Properties

-  language: string

## Locations Used

[src/platform/common/utils.ts#L164](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/utils.ts#L164)
```typescript
}

export function sendNotebookOrKernelLanguageTelemetry(
    telemetryEvent: Telemetry.SwitchToExistingKernel | Telemetry.NotebookLanguage,
    language?: string
) {
    language = getTelemetrySafeLanguage(language);
```


[src/notebooks/controllers/vscodeNotebookController.ts#L567](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L567)
```typescript
        }
        switch (this.connection.kind) {
            case 'startUsingPythonInterpreter':
                sendNotebookOrKernelLanguageTelemetry(Telemetry.SwitchToExistingKernel, PYTHON_LANGUAGE);
                break;
            case 'connectToLiveRemoteKernel':
                sendNotebookOrKernelLanguageTelemetry(
```


[src/notebooks/controllers/vscodeNotebookController.ts#L571](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L571)
```typescript
                break;
            case 'connectToLiveRemoteKernel':
                sendNotebookOrKernelLanguageTelemetry(
                    Telemetry.SwitchToExistingKernel,
                    this.connection.kernelModel.language
                );
                break;
```


[src/notebooks/controllers/vscodeNotebookController.ts#L578](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/controllers/vscodeNotebookController.ts#L578)
```typescript
            case 'startUsingLocalKernelSpec':
            case 'startUsingRemoteKernelSpec':
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

[src/kernels/variables/jupyterVariables.ts#L42](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/variables/jupyterVariables.ts#L42)
```typescript
    }

    // IJupyterVariables implementation
    @captureTelemetry(Telemetry.VariableExplorerFetchTime, undefined, true)
    public async getVariables(request: IJupyterVariablesRequest, kernel?: IKernel): Promise<IJupyterVariablesResponse> {
        return this.variableHandler.getVariables(request, kernel);
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

[src/webviews/extension-side/variablesView/variableView.node.ts#L183](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/variablesView/variableView.node.ts#L183)
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

[src/notebooks/helpers.ts#L671](https://github.com/microsoft/vscode-jupyter/tree/main/src/notebooks/helpers.ts#L671)
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

[src/kernels/jupyter/session/jupyterSession.ts#L67](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/session/jupyterSession.ts#L67)
```typescript
        return true;
    }

    @captureTelemetry(Telemetry.WaitForIdleJupyter, undefined, true)
    public waitForIdle(timeout: number): Promise<void> {
        // Wait for idle on this session
        return this.waitForIdleOnSession(this.session, timeout);
```

</details>
<details>
  <summary>DS_INTERNAL.WEB_FETCH_ERROR</summary>

## Description




 Event sent when trying to talk to a remote server and the browser gives us a generic fetch error

## Properties


No properties for event


## Locations Used

[src/kernels/jupyter/serverSelector.ts#L138](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/jupyter/serverSelector.ts#L138)
```typescript
                }
            } else {
                if (err.message.includes('Failed to fetch') && this.isWebExtension) {
                    sendTelemetryEvent(Telemetry.FetchError, undefined, { currentTask: 'connecting' });
                }
                await this.errorHandler.handleError(
                    new RemoteJupyterServerConnectionError(userURI, computeServerId(userURI), err)
```

</details>
<details>
  <summary>DS_INTERNAL.WEBVIEW_STARTUP</summary>

## Description


No description provided

## Properties

-  type: string

## Locations Used

[src/webviews/extension-side/webviewHost.ts#L279](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/webviewHost.ts#L279)
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

[src/webviews/extension-side/webviewHost.ts#L297](https://github.com/microsoft/vscode-jupyter/tree/main/src/webviews/extension-side/webviewHost.ts#L297)
```typescript
        this.dispose();
    };

    @captureTelemetry(Telemetry.WebviewStyleUpdate)
    private async handleCssRequest(): Promise<void> {
        const isDark = await this.isDark();
        return this.postMessageInternal(CssMessages.GetCssResponse, {
```

</details>
<details>
  <summary>DS_INTERNAL.ZMQ_NATIVE_BINARIES_LOADING</summary>

## Description




 Telemetry event sent when the ZMQ native binaries do work.

## Properties


No properties for event


## Locations Used

[src/kernels/raw/session/rawNotebookSupportedService.node.ts#L43](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawNotebookSupportedService.node.ts#L43)
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

[src/kernels/raw/session/rawNotebookSupportedService.node.ts#L47](https://github.com/microsoft/vscode-jupyter/tree/main/src/kernels/raw/session/rawNotebookSupportedService.node.ts#L47)
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

[src/platform/common/variables/environment.node.ts#L173](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/variables/environment.node.ts#L173)
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

[src/telemetry/envFileTelemetry.node.ts#L46](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/envFileTelemetry.node.ts#L46)
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

[src/platform/startupTelemetry.ts#L30](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/startupTelemetry.ts#L30)
```typescript
        await activatedPromise;
        durations.totalActivateTime = stopWatch.elapsedTime;
        const props = await getActivationTelemetryProps(serviceContainer);
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props);
    } catch (ex) {
        traceError('sendStartupTelemetry() failed.', ex);
    }
```


[src/platform/startupTelemetry.ts#L51](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/startupTelemetry.ts#L51)
```typescript
                traceError('getActivationTelemetryProps() failed.', ex);
            }
        }
        sendTelemetryEvent(EventName.EXTENSION_LOAD, durations, props, ex);
    } catch (exc2) {
        traceError('sendErrorTelemetry() failed.', exc2);
    }
```


[src/platform/startupTelemetry.ts#L59](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/startupTelemetry.ts#L59)
```typescript

async function getActivationTelemetryProps(
    serviceContainer: IServiceContainer
): Promise<IEventNamePropertyMapping[EventName.EXTENSION_LOAD]> {
    // eslint-disable-next-line
    // TODO: Not all of this data is showing up in the database...
    // eslint-disable-next-line
```

</details>
<details>
  <summary>HASHED_PACKAGE_NAME</summary>

## Description




 Telemetry event sent with details when tracking imports

## Properties


No properties for event


## Locations Used

[src/telemetry/importTracker.node.ts#L206](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/importTracker.node.ts#L206)
```typescript
        // Hash the package name so that we will never accidentally see a
        // user's private package name.
        const hash = getTelemetrySafeHashedString(packageName);
        sendTelemetryEvent(EventName.HASHED_PACKAGE_NAME, undefined, { hashedNamev2: hash });
    }

    private lookForImports(lines: (string | undefined)[]) {
```


[src/test/telemetry/importTracker.unit.test.ts#L50](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/telemetry/importTracker.unit.test.ts#L50)
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

[src/telemetry/importTracker.node.ts#L159](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/importTracker.node.ts#L159)
```typescript
        }
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookDocument(e: NotebookDocument) {
        this.pendingChecks.delete(e.uri.fsPath);
        const lines = this.getNotebookDocumentLines(e);
```


[src/telemetry/importTracker.node.ts#L166](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/importTracker.node.ts#L166)
```typescript
        this.lookForImports(lines);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkNotebookCell(e: NotebookCellExecutionStateChangeEvent) {
        if (!isJupyterNotebook(e.cell.notebook)) {
            return;
```


[src/telemetry/importTracker.node.ts#L190](https://github.com/microsoft/vscode-jupyter/tree/main/src/telemetry/importTracker.node.ts#L190)
```typescript
        this.lookForImports(result);
    }

    @captureTelemetry(EventName.HASHED_PACKAGE_PERF)
    private checkDocument(document: TextDocument) {
        this.pendingChecks.delete(document.fileName);
        const lines = this.getDocumentLines(document);
```


[src/test/telemetry/importTracker.unit.test.ts#L48](https://github.com/microsoft/vscode-jupyter/tree/main/src/test/telemetry/importTracker.unit.test.ts#L48)
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

[src/platform/common/experiments/service.ts#L104](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/experiments/service.ts#L104)
```typescript
        // so we need to perform these checks and send the corresponding telemetry manually.
        switch (this.getOptInOptOutStatus(experiment)) {
            case 'optOut': {
                sendTelemetryEvent(EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT, undefined, {
                    expNameOptedOutOf: experiment
                });

```


[src/platform/common/experiments/service.ts#L112](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/experiments/service.ts#L112)
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

[src/interactive-window/commands/commandRegistry.ts#L577](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L577)
```typescript
                    sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS);
                }
            } catch (e) {
                sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR, undefined, undefined, e);
                traceError(e);
                void this.errorHandler.handleError(e);
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

[src/interactive-window/commands/commandRegistry.ts#L526](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L526)
```typescript
        return this.commandManager.executeCommand('outline.focus');
    }
    private async onVariablePanelShowDataViewerRequest(request: IShowDataViewerFromVariablePanel) {
        sendTelemetryEvent(EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST);
        if (
            this.debugService?.activeDebugSession &&
            this.variableProvider &&
```

</details>
<details>
  <summary>OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS_EX</summary>

## Description


No description provided

## Properties


No properties for event


## Locations Used

[src/interactive-window/commands/commandRegistry.ts#L574](https://github.com/microsoft/vscode-jupyter/tree/main/src/interactive-window/commands/commandRegistry.ts#L574)
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

[src/platform/common/platform/platformService.node.ts#L30](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/platform/platformService.node.ts#L30)
```typescript
    public version?: SemVer;
    constructor() {
        if (this.osType === OSType.Unknown) {
            sendTelemetryEvent(EventName.PLATFORM_INFO, undefined, {
                failureType: PlatformErrors.FailedToDetermineOS
            });
        }
```


[src/platform/common/platform/platformService.node.ts#L54](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/platform/platformService.node.ts#L54)
```typescript
                try {
                    const ver = coerce(os.release());
                    if (ver) {
                        sendTelemetryEvent(EventName.PLATFORM_INFO, undefined, {
                            osVersion: `${ver.major}.${ver.minor}.${ver.patch}`
                        });
                        return (this.version = ver);
```


[src/platform/common/platform/platformService.node.ts#L61](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/platform/platformService.node.ts#L61)
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

[src/platform/common/process/pythonExecutionFactory.node.ts#L164](https://github.com/microsoft/vscode-jupyter/tree/main/src/platform/common/process/pythonExecutionFactory.node.ts#L164)
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
