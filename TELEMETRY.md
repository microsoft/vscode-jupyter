# Telemetry created by Jupyter Extension

Expand each section to see more information about that event.

* DATASCIENCE.ADD_CELL_BELOW  (Telemetry.AddCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    User adds a cell below the current cell for IW.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.CLICKED_EXPORT_NOTEBOOK_AS_QUICK_PICK  (Telemetry.ClickedExportNotebookAsQuickPick)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User exports the IW or Notebook to a specific format.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        What format to export to was selected in the quick pick.  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.CREATE_NEW_INTERACTIVE  (Telemetry.CreateNewInteractive)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to create a new Interactive Window.  
    ```



* DATASCIENCE.DATA_VIEWER_DATA_DIMENSIONALITY  (Telemetry.DataViewerDataDimensionality)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent when a slice is first applied in a  
    data viewer instance to a sliceable Python variable.  
    ```

    - Measures:  
        - `numberOfDimensions`: `number`  
        This property represents the number of dimensions  
        on the target variable being sliced. This should  
        always be 2 at minimum.  


* DATASCIENCE.DATA_VIEWER_SLICE_ENABLEMENT_STATE_CHANGED  (Telemetry.DataViewerSliceEnablementStateChanged)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent whenever the user toggles the checkbox  
    controlling whether a slice is currently being applied to an  
    n-dimensional variable.  
    ```

    - Properties:  
        - `newState`: `<see below>`  
        This property is either 'checked' when the result of toggling  
        the checkbox is for slicing to be enabled, or 'unchecked'  
        when the result of toggling the checkbox is for slicing  
        to be disabled.  
        Possible values include:  
            - `checked`  
            - `unchecked`  


* DATASCIENCE.DATA_VIEWER_SLICE_OPERATION  (Telemetry.DataViewerSliceOperation)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent whenever the user applies a valid slice  
    to a sliceable Python variable in the data viewer.  
    ```

    - Properties:  
        - `source`: `<see below>`  
        This property indicates whether the slice operation  
        was triggered using the dropdown or the textbox in  
        the slice control panel. `source` is one of `dropdown`,  
        `textbox`, or `checkbox`.  
        Possible values include:  
            - `dropdown`  
            - `textbox`  
            - `checkbox`  


* DATASCIENCE.DEBUG_CONTINUE  (Telemetry.DebugContinue)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry event sent when user hits the `continue` button while debugging IW  
    ```



* DATASCIENCE.DEBUG_CURRENT_CELL  (Telemetry.DebugCurrentCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry event sent when user debugs the cell in the IW  
    ```



* DATASCIENCE.DEBUG_FILE_INTERACTIVE  (Telemetry.DebugFileInteractive)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry event sent when user debugs the file in the IW  
    ```



* DATASCIENCE.DEBUG_STEP_OVER  (Telemetry.DebugStepOver)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry event sent when user hits the `step over` button while debugging IW  
    ```



* DATASCIENCE.DEBUG_STOP  (Telemetry.DebugStop)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry event sent when user hits the `stop` button while debugging IW  
    ```



* DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP  (DebuggingTelemetry.clickedOnSetup)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the user accepts the prompt to install ipykernel 6 automatically.  
    ```



* DATASCIENCE.DEBUGGING.CLICKED_RUN_AND_DEBUG_CELL  (DebuggingTelemetry.clickedRunAndDebugCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the user attempts to start debugging a notebook cell.  
    ```



* DATASCIENCE.DEBUGGING.CLICKED_RUNBYLINE  (DebuggingTelemetry.clickedRunByLine)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the user attempts to start run by line.  
    ```



* DATASCIENCE.DEBUGGING.CLOSED_MODAL  (DebuggingTelemetry.closedModal)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the user dismisses the prompt to install ipykernel 6 automatically.  
    ```



* DATASCIENCE.DEBUGGING.ENDED_SESSION  (DebuggingTelemetry.endedSession)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when a notebook debugging session ends.  
    ```

    - Properties:  
        - `reason`: `<see below>`  
        The reason the session ended.  
        Possible values include:  
            - `'normally'`  
            - `'onKernelDisposed'`  
            - `'onAnInterrupt'`  
            - `'onARestart'`  
            - `'withKeybinding'`  


* DATASCIENCE.DEBUGGING.IPYKERNEL6_STATUS  (DebuggingTelemetry.ipykernel6Status)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    An event describing whether the environment has ipykernel 6 installed.  
    ```

    - Properties:  
        - `status`: `<see below>`  
        Whether ipykernel 6 is installed.  
        Possible values include:  
            - `'installed'`  
            - `'notInstalled'`  


* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_IW_JUPYTER  (DebuggingTelemetry.successfullyStartedIWJupyterDebugger)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Telemetry sent when we have managed to successfully start the Interactive Window debugger using the Jupyter protocol.  
    ```



* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL  (DebuggingTelemetry.successfullyStartedRunAndDebugCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the user successfully starts debugging a notebook cell.  
    ```



* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUNBYLINE  (DebuggingTelemetry.successfullyStartedRunByLine)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Sent when the run by line session starts successfully.  
    ```



* DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER  (Telemetry.DisableInteractiveShiftEnter)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)  
    ```



* DATASCIENCE.ENABLE_INTERACTIVE_SHIFT_ENTER  (Telemetry.EnableInteractiveShiftEnter)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Enable using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)  
    ```



* DATASCIENCE.ENTER_JUPYTER_URI  (Telemetry.EnterJupyterURI)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    A URI has been selected and is being checked for validity.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.EXECUTE_CELL  (Telemetry.ExecuteCell)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when a user executes a cell.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DATASCIENCE.EXPORT_NOTEBOOK_AS  (Telemetry.ExportNotebookAs)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Called on the completion of exporting a Jupyter notebook into a new format  
    This is the result of the operation, so it's not tagged as a user action as that  
    comes from ExportNotebookAsCommand or ExportNotebookAsQuickPick  
    ```

    - Properties:  
        - `cancelled`?: `boolean`  
        Was the export operation cancelled.  
        - `format`: `<see below>`  
        What format was the export performed to.  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  
        - `opened`?: `boolean`  
        Did the user end with opening the file in VS Code.  
        - `successful`?: `boolean`  
        Was the export operation successful.  


* DATASCIENCE.EXPORT_NOTEBOOK_AS_COMMAND  (Telemetry.ExportNotebookAsCommand)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Called when user exports a Jupyter Notebook or IW into a Python file, HTML, PDF, etc.  
    Command is `Jupyter: Export to Python Script` or `Jupyter: Export to HTML`  
    Basically user is exporting some jupyter notebook or IW into a Python file or other.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        What format was the export performed to.  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.EXPORT_NOTEBOOK_AS_FAILED  (Telemetry.ExportNotebookAsFailed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Export Notebook operation failed.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        What format was the export performed to.  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.EXPORT_PYTHON_FILE  (Telemetry.ExportPythonFileInteractive)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User exports a .py file with cells as a Jupyter Notebook.  
    ```



* DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT  (Telemetry.ExportPythonFileAndOutputInteractive)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User exports a .py file with cells along with the outputs which that file would generate in the Interactive Windows as a Jupyter Notebook.  
    ```



* DATASCIENCE.FAILED_SHOW_DATA_EXPLORER  (Telemetry.FailedShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Failed to show the data viewer via the variable view.  
    ```



* DATASCIENCE.FAILED_TO_CREATE_CONTROLLER  (Telemetry.FailedToCreateNotebookController)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry sent when we fail to create a Notebook Controller (an entry for the UI kernel list in Native Notebooks).  
    ```

    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        Common to most of the events.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        Common to most of the events.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Common to most of the events.  
        - `kind`: `<see below>`  
        What kind of kernel spec did we fail to create.  
        Possible values include:  
            - `'startUsingPythonInterpreter'`  
            - `'startUsingDefaultKernel'`  
            - `'startUsingLocalKernelSpec'`  
            - `'startUsingRemoteKernelSpec'`  
            - `'connectToLiveRemoteKernel'`  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `stackTrace`?: `string`  
        Node stacktrace without PII.  
        Common to most of the events.  


* DATASCIENCE.GOTO_NEXT_CELL_IN_FILE  (Telemetry.GotoNextCellInFile)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Navigation Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.GOTO_PREV_CELL_IN_FILE  (Telemetry.GotoPrevCellInFile)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Navigation Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.IMPORT_NOTEBOOK  (Telemetry.ImportNotebook)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Called when user imports a Jupyter Notebook into a Python file.  
    Command is `Jupyter: Import Jupyter Notebook`  
    Basically user is exporting some jupyter notebook into a Python file.  
    ```

    - Properties:  
        - `scope`: `<see below>`  
        The command can be called as a command, in which a file then needs to be selected, or with a file  
        as the context already, in which case the import command doesn't ask for selection.  
        Possible values include:  
            - `'command'`  
            - `'file'`  


* DATASCIENCE.INTERACTIVE_WINDOW_DEBUG_SETUP_CODE_FAILURE  (Telemetry.InteractiveWindowDebugSetupCodeFailure)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Error information from the debugger output channel while running initialization code.  
    ```



* DATASCIENCE.JUPYTER_KERNEL_API_ACCESS  (Telemetry.JupyterKernelApiAccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when an extension attempts to use our 3rd party API.  
    ```

    - Properties:  
        - `allowed`: `<see below>`  
        Whether or not the extension was able to use the API.  
        Possible values include:  
            - `'yes'`  
            - `'no'`  
        - `extensionId`: `string`  
        Extension Id that's attempting to use the API.  


* DATASCIENCE.JUPYTER_KERNEL_API_USAGE  (Telemetry.JupyterKernelApiUsage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when an extension uses our 3rd party API.  
    ```

    - Properties:  
        - `extensionId`: `string`  
        Extension Id that's attempting to use the API.  
        - `pemUsed`: `keyof IExportedKernelService`  
        Name of the API member used.  


* DATASCIENCE.JUPYTER_KERNEL_FILTER_USED  (Telemetry.JupyterKernelFilterUsed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Called when the user clicks accept on the kernel filter UI.  
    ```



* DATASCIENCE.JUPYTER_KERNEL_HIDDEN_VIA_FILTER  (Telemetry.JupyterKernelHiddenViaFilter)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Called when a controller that would have been shown is hidden by a filter.  
    ```



* DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN  (Telemetry.JupyterNotInstalledErrorShown)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when we display a message informing the user about Jupyter not being installed (or not detected).  
    ```



* DATASCIENCE.KERNEL_CRASH  (Telemetry.KernelCrash)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when Kernel crashes.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DATASCIENCE.KERNEL_SPEC_LANGUAGE  (Telemetry.KernelSpecLanguage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to detect the different languages of kernel specs used.  
    ```

    - Properties:  
        - `kind`: `<see below>`  
        Whether this is a local or remote kernel.  
        Possible values include:  
            - `'local'`  
            - `'remote'`  
        - `language`: `<see below>`  
        Language of the kernelSpec.  
        Possible values include:  
            - `null or <empty>`  
        - `usesShell`?: `boolean`  
        Whether shell is used to start the kernel. E.g. `"/bin/sh"` is used in the argv of the kernelSpec.  
        OCaml is one such kernel.  


* DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL  (Telemetry.OpenNotebookAll)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Sent when we have opened any Jupyter notebook in a VS Code session.  
    Not tagging as a user action as this could be something like auto opening a file  
    from a previous session and not a direct user action.  
    ```

    - Properties:  
        - `nbformat`: `<see below>`  
        Major Format of the Notebook.  
        Useful in determining the most popular versions of nbformats used by users.  
        Possible values include:  
            - `null or <empty>`  
        - `nbformat_minor`: `<see below>`  
        Minor Format of the Notebook.  
        Useful in determining the most popular versions of nbformats used by users.  
        Possible values include:  
            - `null or <empty>`  


* DATASCIENCE.NO_ACTIVE_KERNEL_SESSION  (Telemetry.NoActiveKernelSession)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Send when we want to install data viewer dependendies, but don't have an active kernel session.  
    Used by the dataViewerDependencyService.  
    ```



* DATASCIENCE.NOTEBOOK_INTERRUPT  (Telemetry.NotebookInterrupt)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user interrupts the kernel.  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    ```

    - `When interrupt is a success`:  
        - Properties:  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Common to most of the events.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            Common to most of the events.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            Common to most of the events.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            Common to most of the events.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            Common to most of the events.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            Common to most of the events.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            Common to most of the events.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            Common to most of the events.  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            Common to most of the events.  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            Common to most of the events.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Common to most of the events.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            Common to most of the events.  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            Common to most of the events.  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Common to most of the events.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `result`: `<see below>`  
            The result of the interrupt,  
            Possible values include:  
                - `success`  
                - `timeout`  
                - `restart`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            Common to most of the events.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
    - `If there are unhandled exceptions`:  
        - Properties:  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Common to most of the events.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            Common to most of the events.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            Common to most of the events.  
            - `failed`: `true`  
            Whether there was a failure.  
            Common to most of the events.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            Common to most of the events.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Common to most of the events.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            Common to most of the events.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            Common to most of the events.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            Common to most of the events.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            Common to most of the events.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            Common to most of the events.  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            Common to most of the events.  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            Common to most of the events.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Common to most of the events.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            Common to most of the events.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            Common to most of the events.  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Common to most of the events.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `stackTrace`?: `string`  
            Node stacktrace without PII.  
            Common to most of the events.  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            Common to most of the events.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  


* DATASCIENCE.NOTEBOOK_RESTART  (Telemetry.NotebookRestart)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user Restarts the Kernel.  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    ```

    -  Group 1:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Common to most of the events.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
    - `If there are unhandled exceptions.`:  
        - Properties:  
            - `failed`: `true`  
            Whether there was a failure.  
            Common to most of the events.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            Common to most of the events.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Common to most of the events.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Common to most of the events.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `stackTrace`?: `string`  
            Node stacktrace without PII.  
            Common to most of the events.  


* DATASCIENCE.NOTEBOOK_START  (Telemetry.NotebookStart)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Send when a kernel starts.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `failed`: `true`  
        Whether there was a failure.  
        Common to most of the events.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        Common to most of the events.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `stackTrace`?: `string`  
        Node stacktrace without PII.  
        Common to most of the events.  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DATASCIENCE.OPEN_PLOT_VIEWER  (Telemetry.OpenPlotViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    A new instance of the plot viewer was opened.  
    ```



* DATASCIENCE.PYTHON_VARIABLE_FETCHING_CODE_FAILURE  (Telemetry.PythonVariableFetchingCodeFailure)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Python code that we ran to fetch variables had a failure.  
    ```



* DATASCIENCE.RECOMMENT_EXTENSION  (Telemetry.RecommendExtension)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry sent when we recommend installing an extension.  
    ```

    - Properties:  
        - `action`: `<see below>`  
        `displayed` - If prompt was displayed  
        `dismissed` - If prompt was displayed & dismissed by the user  
        `ok` - If prompt was displayed & ok clicked by the user  
        `cancel` - If prompt was displayed & cancel clicked by the user  
        `doNotShowAgain` - If prompt was displayed & doNotShowAgain clicked by the user  
        Possible values include:  
            - `'displayed'`  
            - `'dismissed'`  
            - `'ok'`  
            - `'cancel'`  
            - `'doNotShowAgain'`  
        - `extensionId`: `string`  
        Extension we recommended the user to install.  


* DATASCIENCE.REFRESH_DATA_VIEWER  (Telemetry.RefreshDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Sent when the jupyter.refreshDataViewer command is invoked  
    ```



* DATASCIENCE.RUN_ALL_CELLS  (Telemetry.RunAllCells)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run all cells from the active python file in the Interactive Window  
    ```



* DATASCIENCE.RUN_ALL_CELLS_ABOVE  (Telemetry.RunAllCellsAbove)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run all the above cells in the Interactive Window  
    ```



* DATASCIENCE.RUN_BY_LINE_VARIABLE_HOVER  (Telemetry.RunByLineVariableHover)  
      Owner: [@roblourens](https://github.com/roblourens)  
    ```
    Fired when a user hovers a variable while debugging the IW.  
    ```



* DATASCIENCE.RUN_CELL_AND_ALL_BELOW  (Telemetry.RunCellAndAllBelow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run current cell and all below in the Interactive Window  
    ```



* DATASCIENCE.RUN_CHANGE_CELL_TO_CODE  (Telemetry.ChangeCellToCode)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CHANGE_CELL_TO_MARKDOWN  (Telemetry.ChangeCellToMarkdown)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CURRENT_CELL  (Telemetry.RunCurrentCell)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run the current Cell in the Interactive Window  
    ```



* DATASCIENCE.RUN_CURRENT_CELL_AND_ADD_BELOW  (Telemetry.RunCurrentCellAndAddBelow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Run the cell and everything below it in the Interactive Window.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CURRENT_CELL_AND_ADVANCE  (Telemetry.RunCurrentCellAndAdvance)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run current cell in the Interactive Window and advance cursor to the next cell  
    ```



* DATASCIENCE.RUN_DELETE_CELLS  (Telemetry.DeleteCells)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_ABOVE  (Telemetry.ExtendSelectionByCellAbove)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Selection Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_BELOW  (Telemetry.ExtendSelectionByCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Selection Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_FILE_INTERACTIVE  (Telemetry.RunFileInteractive)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run the active file in the Interactive Window  
    ```



* DATASCIENCE.RUN_FROM_LINE  (Telemetry.RunFromLine)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run the active file contents from the cursor location in the Interactive Window  
    ```



* DATASCIENCE.RUN_INSERT_CELL_ABOVE  (Telemetry.InsertCellAbove)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_INSERT_CELL_BELOW  (Telemetry.InsertCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_INSERT_CELL_BELOW_POSITION  (Telemetry.InsertCellBelowPosition)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_MOVE_CELLS_DOWN  (Telemetry.MoveCellsDown)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_MOVE_CELLS_UP  (Telemetry.MoveCellsUp)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Edit Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECT_CELL  (Telemetry.SelectCell)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Selection Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECT_CELL_CONTENTS  (Telemetry.SelectCellContents)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Cell Selection Command in Interactive Window  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECTION_OR_LINE  (Telemetry.RunSelectionOrLine)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run a Selection or Line in the Interactive Window  
    ```



* DATASCIENCE.RUN_TO_LINE  (Telemetry.RunToLine)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Command to Run the active file contents up to the cursor location in the Interactive Window  
    ```



* DATASCIENCE.SELECT_JUPYTER_INTERPRETER_Command  (Telemetry.SelectJupyterInterpreterCommand)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user selects an interpreter to start jupyter server.  
    ```



* DATASCIENCE.SELECT_JUPYTER_URI  (Telemetry.SelectJupyterURI)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User has triggered selection of a Jupyter URI for a remote connection.  
    Note: Might not come from a direct user action.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.SELECT_LOCAL_JUPYTER_KERNEL  (Telemetry.SelectLocalJupyterKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Kernel was switched to a local kernel connection.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DATASCIENCE.SELECT_REMOTE_JUPYTER_KERNEL  (Telemetry.SelectRemoteJupyterKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Kernel was switched to a remote kernel connection.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DATASCIENCE.SELFCERTSMESSAGECLOSE  (Telemetry.SelfCertsMessageClose)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when users chose not to allow connecting to Jupyter over HTTPS when certificate isn't trusted by a trusted CA.  
    ```



* DATASCIENCE.SELFCERTSMESSAGEENABLED  (Telemetry.SelfCertsMessageEnabled)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when users chose to use self-signed certificates when connecting to Jupyter over https.  
    Basically this means users has chosen to connect to Jupyter over HTTPS when certificate isn't trusted by a trusted CA.  
    ```



* DATASCIENCE.SET_JUPYTER_URI_LOCAL  (Telemetry.SetJupyterURIToLocal)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Jupyter URI was set to local.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.SET_JUPYTER_URI_UI_DISPLAYED  (Telemetry.SetJupyterURIUIDisplayed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    This telemetry tracks the display of the Picker for Jupyter Remote servers.  
    ```

    - Properties:  
        - `commandSource`: `<see below>`  
        This telemetry tracks the source of this UI.  
        nonUser - Invoked internally by our code.  
        toolbar - Invoked by user from Native or Interactive window toolbar.  
        commandPalette - Invoked from command palette by the user.  
        nativeNotebookStatusBar - Invoked from Native notebook statusbar.  
        nativeNotebookToolbar - Invoked from Native notebook toolbar.  
        Possible values include:  
            - `nonUser`  
            - `toolbar`  
            - `commandPalette`  
            - `nativeNotebookStatusBar`  
            - `nativeNotebookToolbar`  
            - `errorHandler`  
            - `prompt`  


* DATASCIENCE.SET_JUPYTER_URI_USER_SPECIFIED  (Telemetry.SetJupyterURIToUserSpecified)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Jupyter URI was valid and set to a remote setting.  
    ```

    - Properties:  
        - `azure`: `boolean`  
        Was the URI set to an Azure uri.  


* DATASCIENCE.SHOW_DATA_EXPLORER  (Telemetry.ShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Request was made to show the data viewer with specific data frame info.  
    ```

    - Properties:  
        - `columns`: `<see below>`  
        Count of columns in the target data frame.  
        Possible values include:  
            - `null or <empty>`  
        - `rows`: `<see below>`  
        Count of rows in the target data frame.  
        Possible values include:  
            - `null or <empty>`  


* DATASCIENCE.SHOW_DATA_EXPLORER_ROWS_LOADED  (Telemetry.ShowDataViewerRowsLoaded)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Data viewer loads rows in chunks, this event is sent when the rows have all been loaded  
    ```

    - Properties:  
        - `rowsTimer`: `<see below>`  
        Timer to indicate how long it took to load all the rows  
        Possible values include:  
            - `null or <empty>`  


* DATASCIENCE.START_SHOW_DATA_EXPLORER  (Telemetry.StartShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User requested to open the data frame viewer.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER  (Telemetry.UserDidNotInstallJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when user click `cancel` button when prompted to install Jupyter.  
    ```



* DATASCIENCE.USER_DID_NOT_INSTALL_PANDAS  (Telemetry.UserDidNotInstallPandas)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Prompted to install Pandas and chose not to install  
    Note: This could be just ignoring the UI so not a user action.  
    ```



* DATASCIENCE.USER_INSTALLED_JUPYTER  (Telemetry.UserInstalledJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when user installs Jupyter.  
    ```



* DATASCIENCE.USER_INSTALLED_PANDAS  (Telemetry.UserInstalledPandas)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Installed the python Pandas package.  
    ```



* DATAVIEWER.USING_INTERPRETER  (Telemetry.DataViewerUsingInterpreter)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When the Data Viewer installer is using a Python interpreter to do the install.  
    ```



* DATAVIEWER.USING_KERNEL  (Telemetry.DataViewerUsingKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When the Data Viewer installer is using the Kernel to do the install.  
    ```



* DATAVIEWER.WEBVIEW_LOADED  (Telemetry.DataViewerWebviewLoaded)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Data Viewer webview was loaded.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.ACTIVE_INTERPRETER_LISTING_PERF  (Telemetry.ActiveInterpreterListingPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken by Python extension to return the active Python environment.  
    ```

    - Properties:  
        - `firstTime`?: `boolean`  
        Whether this is the first time in the session.  
        (fetching kernels first time in the session is slower, later its cached).  
        This is a generic property supported for all telemetry (sent by decorators).  
    - Measures:  
        - `duration`: `number`  
        Total time taken to list interpreters.  


* DS_INTERNAL.CELL_OUTPUT_MIME_TYPE  (Telemetry.CellOutputMimeType)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Mime type of a cell output.  
    Used to detect the popularity of a mime type, that would help determine which mime types are most common.  
    E.g. if we see widget mimetype, then we know how many use ipywidgets and the like and helps us prioritize widget issues,  
    or prioritize rendering of widgets when opening an existing notebook or the like.  
    ```

    - Properties:  
        - `mimeType`: `string`  
        Mimetype of the output.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `when`: `<see below>`  
        Whether the package was detected in an existing file (upon open, upon save, upon close) or when it was being used during execution.  
        Possible values include:  
            - `'onExecution'`  
            - `'onOpenCloseOrSave'`  


* DS_INTERNAL.CODE_LENS_ACQ_TIME  (Telemetry.CodeLensAverageAcquisitionTime)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    How long on average we spent parsing code lens. Sent on shutdown.  
    We should be able to deprecate in favor of DocumentWithCodeCells, but we should compare the numbers first.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.COMMAND_EXECUTED  (Telemetry.CommandExecuted)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    A command that the extension contributes is executed.  
    ```

    - Properties:  
        - `command`: `string`  
        Name of the command executed.  


* DS_INTERNAL.CONNECTFAILEDJUPYTER  (Telemetry.ConnectFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when we have failed to connect to the local Jupyter server we started.  
    ```

    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        Common to most of the events.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        Common to most of the events.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Common to most of the events.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `stackTrace`?: `string`  
        Node stacktrace without PII.  
        Common to most of the events.  


* DS_INTERNAL.CONNECTREMOTEEXPIREDCERTFAILEDJUPYTER  (Telemetry.ConnectRemoteExpiredCertFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Jupyter server's certificate has expired.  
    ```



* DS_INTERNAL.CONNECTREMOTEFAILEDJUPYTER  (Telemetry.ConnectRemoteFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when we fail to connect to a remote jupyter server.  
    ```

    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        Common to most of the events.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        Common to most of the events.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Common to most of the events.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `stackTrace`?: `string`  
        Node stacktrace without PII.  
        Common to most of the events.  


* DS_INTERNAL.CONNECTREMOTEJUPYTER_VIA_LOCALHOST  (Telemetry.ConnectRemoteJupyterViaLocalHost)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Connecting to an existing Jupyter server, but connecting to localhost.  
    ```



* DS_INTERNAL.CONNECTREMOTESELFCERTFAILEDJUPYTER  (Telemetry.ConnectRemoteSelfCertFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Jupyter server's certificate is not from a trusted authority.  
    ```



* DS_INTERNAL.DOCUMENT_WITH_CODE_CELLS  (Telemetry.DocumentWithCodeCells)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Info about code lenses, count and average time to parse the document.  
    ```

    - Measures:  
        - `codeLensUpdateTime`: `number`  
        Average time taken to aquire code lenses for a document without using the cache  
        - `maxCellCount`: `number`  
        Maximum number of code lenses returned for the document  


* DS_INTERNAL.FAILED_TO_UPDATE_JUPYTER_KERNEL_SPEC  (Telemetry.FailedToUpdateKernelSpec)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when we fail to update the kernel spec json file.  
    ```

    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        Common to most of the events.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        Common to most of the events.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Common to most of the events.  
        - `language`: `<see below>`  
        Language of the kernel spec.  
        Possible values include:  
            - `null or <empty>`  
        - `name`: `string`  
        Name of the kernel spec.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        Common to most of the events.  
        - `stackTrace`?: `string`  
        Node stacktrace without PII.  
        Common to most of the events.  


* DS_INTERNAL.GET_ACTIVATED_ENV_VARIABLES  (Telemetry.GetActivatedEnvironmentVariables)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Used to capture time taken to get environment variables for a python environment.  
    Also lets us know whether it worked or not.  
    ```

    - Properties:  
        - `envType`?: `<see below>`  
        Type of the Python environment.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `failed`: `boolean`  
        Whether the env variables were fetched successfully or not.  
        - `reason`?: `<see below>`  
        Reason for not being able to get the env variables.  
        Possible values include:  
            - `'noActivationCommands'`  
            - `'unknownOS'`  
            - `'emptyVariables'`  
            - `'unhandledError'`  
            - `'emptyFromCondaRun'`  
            - `'emptyFromPython'`  
            - `'condaActivationFailed'`  
            - `'failedToGetActivatedEnvVariablesFromPython'`  
            - `'failedToGetCustomEnvVariables'`  
        - `source`: `<see below>`  
        Source where the env variables were fetched from.  
        If `python`, then env variables were fetched from Python extension.  
        If `jupyter`, then env variables were fetched from Jupyter extension.  
        Possible values include:  
            - `'python'`  
            - `'jupyter'`  
    - Measures:  
        - `duration`: `number`  
        Time taken.  


* DS_INTERNAL.GET_PASSWORD_FAILURE  (Telemetry.GetPasswordFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to indicate we've failed to connect to a Remote Jupyter Server successfully after requesting a password.  
    ```



* DS_INTERNAL.GET_PASSWORD_SUCCESS  (Telemetry.GetPasswordSuccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to indicate we've connected to a Remote Jupyter Server successfully after requesting a password.  
    ```



* DS_INTERNAL.INTERACTIVE_FILE_TOOLTIPS_PERF  (Telemetry.InteractiveFileTooltipsPerf)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    How long it took to return our hover tooltips for a .py file.  
    ```

    - Properties:  
        - `isResultNull`: `boolean`  
        Result is null if user signalled cancellation or if we timed out  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.IPYWIDGET_DISCOVER_WIDGETS_NB_EXTENSIONS  (Telemetry.DiscoverIPyWidgetNamesPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to discover all IPyWidgets.  
    This is how long it takes to discover all widgets on disc (from python environment).  
    ```

    - Properties:  
        - `type`: `<see below>`  
        Whether we're looking for widgets on local Jupyter environment (local connections) or remote.  
        Possible values include:  
            - `'local'`  
            - `'remote'`  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.IPYWIDGET_DISCOVERY_ERRORED  (Telemetry.HashedIPyWidgetScriptDiscoveryError)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Something went wrong in looking for a widget.  
    ```



* DS_INTERNAL.IPYWIDGET_EXTENSIONJS_INFO  (Telemetry.IPyWidgetExtensionJsInfo)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent once we've successfully or unsuccessfully parsed the extension.js file in the widget folder.  
    E.g. if we have a widget named ipyvolume, we attempt to parse the nbextensions/ipyvolume/extension.js file to get some info out of it.  
    ```

    - `Successfully parsed extension.js`:  
        - Properties:  
            - `patternUsedToRegisterRequireConfig`: `string`  
            Pattern (code style) used to register require.config enties.  
            - `widgetFolderNameHash`: `string`  
            Hash of the widget folder name.  
        - Measures:  
            - `requireEntryPointCount`: `number`  
            Total number of entries in the require config.  
    - `Failed to parse extension.js.`:  
        - Properties:  
            - `failed`: `true`  
            Failed to parse extension.js.  
            - `failure`: `<see below>`  
            Reason for the failure.  
            Possible values include:  
                - `'couldNotLocateRequireConfigStart'`  
                - `'couldNotLocateRequireConfigEnd'`  
                - `'noRequireConfigEntries'`  
            - `patternUsedToRegisterRequireConfig`: `<see below>`  
            Pattern (code style) used to register require.config entries.  
            Pattern (code style) used to register require.config enties.  
            Possible values include:  
                - `null or <empty>`  
            - `widgetFolderNameHash`: `string`  
            Hash of the widget folder name.  


* DS_INTERNAL.IPYWIDGET_LOAD_FAILURE  (Telemetry.IPyWidgetLoadFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget module fails to load. Module name is hashed.  
    ```

    - Properties:  
        - `isOnline`: `boolean`  
        Whether we've detected a connection to the internet or not (to access the CDN).  
        - `moduleHash`: `string`  
        Hash of the widget module.  
        - `moduleVersion`: `string`  
        Version of the module.  
        - `timedout`: `boolean`  
        Whether we timedout getting the source of the script (fetching script source in extension code).  


* DS_INTERNAL.IPYWIDGET_LOAD_SUCCESS  (Telemetry.IPyWidgetLoadSuccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget module loads. Module name is hashed.  
    ```

    - Properties:  
        - `moduleHash`: `string`  
        Hash of the module name.  
        - `moduleVersion`: `string`  
        Version of the module.  


* DS_INTERNAL.IPYWIDGET_OVERHEAD  (Telemetry.IPyWidgetOverhead)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to indicate the overhead of syncing the kernel with the UI.  
    ```

    - Measures:  
        - `averageWaitTime`: `number`  
        Average wait timne.  
        - `numberOfMessagesWaitedOn`: `number`  
        Number of messages  
        - `numberOfRegisteredHooks`: `number`  
        Number of registered hook.  
        - `totalOverheadInMs`: `number`  
        Total time in ms  


* DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN  (Telemetry.IPyWidgetPromptToUseCDN)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when we prompt user to use a CDN for IPyWidget scripts.  
    This is always sent when we display a prompt.  
    ```



* DS_INTERNAL.IPYWIDGET_PROMPT_TO_USE_CDN_SELECTION  (Telemetry.IPyWidgetPromptToUseCDNSelection)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user does something with the prompt displayed to user about using CDN for IPyWidget scripts.  
    ```

    - Properties:  
        - `selection`: `<see below>`  
        The section made by the user.  
        Possible values include:  
            - `'ok'`  
            - `'cancel'`  
            - `'dismissed'`  
            - `'doNotShowAgain'`  


* DS_INTERNAL.IPYWIDGET_RENDER_FAILURE  (Telemetry.IPyWidgetRenderFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when the widget render function fails (note, this may not be sufficient to capture all failures).  
    ```



* DS_INTERNAL.IPYWIDGET_TIME_TO_COPY_NBEXTENSIONS_DIR  (Telemetry.IPyWidgetNbExtensionCopyTime)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time take to copy the nb extensions folder.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.IPYWIDGET_UNHANDLED_MESSAGE  (Telemetry.IPyWidgetUnhandledMessage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when the widget tries to send a kernel message but nothing was listening  
    ```

    - Properties:  
        - `msg_type`: `string`  
        Type of the protocol message sent by Jupyter kernel.  


* DS_INTERNAL.IPYWIDGET_USED_BY_USER  (Telemetry.HashedIPyWidgetNameUsed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with name of a Widget that is used.  
    Helps determine which widgets are used the most, and which are not.  
    Useful in prioritizing which widgets to work on if things fail to work.  
    ```

    - Properties:  
        - `cdnSearched`: `boolean`  
        Whether we searched CDN or not.  
        - `hashedName`: `string`  
        Hash of the widget module.  
        If the widget is found on a CDN, then the unhashed name is sent in `moduleName`.  
        - `modelName`?: `string`  
        Name of the widget model that's loaded.  
        Sent only for cases where `source` is `cdn` or when module is found on cdn.  
        As that is the only time we can safely send the name (if its on public CDN then its public information).  
        - `moduleName`?: `string`  
        Name of the widget module  
        Sent only for cases where `source` is `cdn` or when module is found on cdn.  
        As that is the only time we can safely send the name (if its on public CDN then its public information).  
        - `moduleVersion`?: `string`  
        Version of the Module used, sent only for cases where `source` is `cdn` or when module is found on cdn.  
        - `source`?: `<see below>`  
        Where did we find the hashed name (CDN or user environment or remote jupyter).  
        Possible values include:  
            - `'cdn'`  
            - `'local'`  
            - `'remote'`  


* DS_INTERNAL.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED_LOAD_FAILURE  (Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget version that is not supported is used & we have trapped this and warned the user abou it.  
    ```

    - Properties:  
        - `moduleHash`: `string`  
        Hash of the widget module.  
        - `moduleVersion`: `string`  
        Version of the module.  


* DS_INTERNAL.JUPYTER_CUSTOM_COMMAND_LINE  (Telemetry.JupyterCommandLineNonDefault)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to when user customizes the jupyter command line  
    ```



* DS_INTERNAL.JUPYTER_INTALLED_BUT_NO_KERNELSPEC_MODULE  (Telemetry.JupyterInstalledButNotKernelSpecModule)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when jupyter has been found in interpreter but we cannot find kernelspec.  
    ```



* DS_INTERNAL.JUPYTER_REGISTER_INTERPRETER_AS_KERNEL  (Telemetry.RegisterInterpreterAsKernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to measure the time taken to register an interpreter as a Jupyter kernel.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.JUPYTERSTARTUPCOST  (Telemetry.StartJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time taken to start the Jupyter server.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.KERNEL_COUNT  (Telemetry.KernelCount)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent with the total number of different types of kernels in the kernel picker.  
    ```

    - Measures:  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel list.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel list.  
        - `localKernelSpecCount`: `number`  
        Total number of local kernel specs in the list.  
        - `remoteKernelSpecCount`: `number`  
        Total number of remote kernel specs in the list.  


* DS_INTERNAL.KERNEL_LAUNCHER_PERF  (Telemetry.KernelLauncherPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to Launch a raw kernel.  
    ```

    -  Group 1:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Common to most of the events.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
    -  Group 2:  
        - Properties:  
            - `failed`: `true`  
            Whether there was a failure.  
            Common to most of the events.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            Common to most of the events.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Common to most of the events.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
            Common to most of the events.  
            - `stackTrace`?: `string`  
            Node stacktrace without PII.  
            Common to most of the events.  


* DS_INTERNAL.KERNEL_LISTING_PERF  (Telemetry.KernelListingPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time taken to list the kernels.  
    ```

    - Properties:  
        - `kind`: `<see below>`  
        Whether this telemetry is for listing of all kernels or just python or just non-python.  
        (fetching kernels first time in the session is slower, later its cached).  
        Possible values include:  
            - `'remote'`  
            - `'local'`  
            - `'localKernelSpec'`  
            - `'localPython'`  
    - Measures:  
        - `duration`: `number`  
        Total time taken to list kernels.  


* DS_INTERNAL.KERNEL_SPEC_NOT_FOUND  (Telemetry.KernelSpecNotFound)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to indicate 'jupyter kernelspec' is not possible.  
    ```



* DS_INTERNAL.NATIVE_VARIABLE_VIEW_LOADED  (Telemetry.NativeVariableViewLoaded)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Variable View webview was loaded.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.NATIVE_VARIABLE_VIEW_MADE_VISIBLE  (Telemetry.NativeVariableViewMadeVisible)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Variable View webview was made visible.  
    ```



* DS_INTERNAL.NEW_FILE_USED_IN_INTERACTIVE  (Telemetry.NewFileForInteractiveWindow)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Telemetry event sent when a user runs the interactive window with a new file  
    ```



* DS_INTERNAL.NUMBER_OF_REMOTE_KERNEL_IDS_SAVED  (Telemetry.NumberOfSavedRemoteKernelIds)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When users connect to a remote kernel, we store the kernel id so we can re-connect to that  
    when user opens the same notebook. We only store the last 100.  
    Count is the number of kernels saved in the list.  
    ```

    - Measures:  
        - `count`: `number`  
        Count is the number of kernels saved in the list.  


* DS_INTERNAL.PERCEIVED_JUPYTER_STARTUP_NOTEBOOK  (Telemetry.PerceivedJupyterStartupNotebook)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time take for jupyter server to start and be ready to run first user cell.  
    (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.PREFERRED_KERNEL  (Telemetry.PreferredKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry sent when we have attempted to find the preferred kernel.  
    ```

    - Properties:  
        - `hasActiveInterpreter`?: `boolean`  
        If we have an active interpreter or not.  
        - `language`: `string`  
        Language of the target notebook or interactive window  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `result`: `<see below>`  
        Note if we did or did not find a preferred kernel.  
        Possible values include:  
            - `'found'`  
            - `'notfound'`  
            - `'failed'`  


* DS_INTERNAL.PREFERRED_KERNEL_EXACT_MATCH  (Telemetry.PreferredKernelExactMatch)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Send we we complete our preferred kernel match. Matched reason might be 'no match'.  
    ```

    - Properties:  
        - `matchedReason`: `<see below>`  
        How/why the preferred kernel was matched the way it was.  
        Possible values include:  
            - `null or <empty>`  


* DS_INTERNAL.PYTHON_EXTENSION_INSTALLED_VIA_KERNEL_PICKER  (Telemetry.PythonExtensionInstalledViaKernelPicker)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Python extension was attempted to be installed via the kernel picker command.  
    ```

    - Properties:  
        - `action`: `<see below>`  
        Did the Extension install succeed or fail?  
        Possible values include:  
            - `'success'`  
            - `'failed'`  


* DS_INTERNAL.PYTHON_EXTENSION_NOT_INSTALLED  (Telemetry.PythonExtensionNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The kernel picker command to install python extension was shown.  
    ```

    - Properties:  
        - `action`: `<see below>`  
        The message was displayed, or indicate that the user dismissed or downloaded the message.  
        Possible values include:  
            - `'displayed'`  
            - `'dismissed'`  
            - `'download'`  


* DS_INTERNAL.PYTHON_MODULE_INSTALL  (Telemetry.PythonModuleInstall)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user is presented with a dialog to install a python package.  
    Also sent with the user's response to the dialog.  
    ```

    - Properties:  
        - `action`: `<see below>`  
        Action taken by the user or the extension.  
        Possible values include:  
            - `'cancelled'`  
            - `'displayed'`  
            - `'prompted'`  
            - `'installed'`  
            - `'ignored'`  
            - `'disabled'`  
            - `'failed'`  
            - `'install'`  
            - `'donotinstall'`  
            - `'differentKernel'`  
            - `'error'`  
            - `'installedInJupyter'`  
            - `'failedToInstallInJupyter'`  
            - `'dismissed'`  
            - `'moreInfo'`  
        - `isModulePresent`?: `<see below>`  
        Whether the module was already (once before) installed into the python environment or  
        whether this already exists (detected via `pip list`)  
        Possible values include:  
            - `'true'`  
            - `null or <empty>`  
        - `moduleName`: `string`  
        Name of the python module to be installed.  
        - `pythonEnvType`?: `<see below>`  
        Type of the python environment.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.PYTHON_NOT_INSTALLED  (Telemetry.PythonNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The kernel picker command to install python was shown.  
    ```

    - Properties:  
        - `action`: `<see below>`  
        The message was displayed, or indicate that the user dismissed or downloaded the message.  
        Possible values include:  
            - `'displayed'`  
            - `'dismissed'`  
            - `'download'`  


* DS_INTERNAL.RANK_KERNELS_PERF  (Telemetry.RankKernelsPerf)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Time taken to load kernels if needed and rank them all.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_INFO_RESPONSE  (Telemetry.RawKernelInfoResponse)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    After starting a kernel we send a request to get the kernel info.  
    This tracks the total time taken to get the response back (or wether we timedout).  
    If we timeout and later we find successful comms for this session, then timeout is too low  
    or we need more attempts.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `timedout`: `boolean`  
        Whether we timedout while waiting for response for Kernel info request.  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  
    - Measures:  
        - `attempts`: `number`  
        Total number of attempts and sending a request and waiting for response.  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_PROCESS_LAUNCH  (Telemetry.RawKernelProcessLaunch)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to measure time taken to spawn the raw kernel process.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_SESSION_DISPOSED  (Telemetry.RawKernelSessionDisposed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when a RawSession's `dispose` method is called.  
    Used to determine what part of the code that shut down the session, so as to determine when and how the kernel session crashed.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `stacktrace`: `<see below>`  
        This is the callstack at the time that the `dispose` method  
        is called, intended for us to be able to identify who called  
        `dispose` on the RawSession.  
        Possible values include:  
            - `null or <empty>`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DS_INTERNAL.RAWKERNEL_SESSION_KERNEL_PROCESS_EXITED  (Telemetry.RawKernelSessionKernelProcessExited)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when the underlying kernelProcess for a  
    RawJupyterSession exits.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `exitReason`: `<see below>`  
        The kernel process's exit reason, based on the error  
        object's reason  
        Possible values include:  
            - `null or <empty>`  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  
    - Measures:  
        - `exitCode`: `number`  
        The kernel process's exit code.  


* DS_INTERNAL.RAWKERNEL_SESSION_NO_IPYKERNEL  (Telemetry.RawKernelSessionStartNoIpykernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when raw kernel startup fails due to missing ipykernel dependency.  
    This is useful to see what the user does with this error message.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `reason`: `<see below>`  
        Captures the result of the error message, whether user dismissed this or picked a new kernel or the like.  
        Possible values include:  
            - `0`  
        Enum Member: KernelInterpreterDependencyResponse.ok  
        Could mean dependencies are already installed
or user clicked ok to install and it got installed.  
            - `1`  
        Enum Member: KernelInterpreterDependencyResponse.cancel  
            - `2`  
        Enum Member: KernelInterpreterDependencyResponse.failed  
            - `3`  
        Enum Member: KernelInterpreterDependencyResponse.selectDifferentKernel  
        User chose to select a different kernel.  
            - `4`  
        Enum Member: KernelInterpreterDependencyResponse.uiHidden  
        Missing dependencies not installed and UI not displayed to the user
as the kernel startup is part of a background process.
In such cases we do not notify user of any failures or the like.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DS_INTERNAL.RAWKERNEL_SESSION_SHUTDOWN  (Telemetry.RawKernelSessionShutdown)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when a RawJupyterSession's `shutdownSession` method is called.  
    Used to determine what part of the code that shut down the session, so as to determine when and how the kernel session crashed.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isRequestToShutdownRestartSession`: `<see below>`  
        This indicates whether the session being shutdown is a restart session.  
        Possible values include:  
            - `true`  
            - `false`  
            - `null or <empty>`  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `stacktrace`: `<see below>`  
        This is the callstack at the time that the `shutdownSession`  
        method is called, intended for us to be ale to identify who  
        tried to shutdown the session.  
        Possible values include:  
            - `null or <empty>`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DS_INTERNAL.RUNTEST  (Telemetry.RunTest)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    A automated test has been run  
    ```

    - Properties:  
        - `commitHash`?: `string`  
        The git commit that the test was run against.  
        - `perfWarmup`?: `'true'`  
        If the test was an initial run to warmup the product.  
        - `testName`: `string`  
        The name of the test.  
        - `testResult`: `string`  
        Whether the test passed or failed.  
        - `timedCheckpoints`?: `string`  
        Timings for segments of the test.  


* DS_INTERNAL.SELECT_JUPYTER_INTERPRETER  (Telemetry.SelectJupyterInterpreter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent when we notify the user to select an interpreter to start jupyter server  
    Also sent after the user makes a selection to start the jupyter server.  
    ```

    - Properties:  
        - `result`?: `<see below>`  
        If the value or `result` is empty this means we displayed the message to the user and user hasn't made a choice yet.  
            The result of the selection.  
        notSelected - No interpreter was selected.  
        selected - An interpreter was selected (and configured to have jupyter and notebook).  
        installationCancelled - Installation of jupyter and/or notebook was cancelled for an interpreter.  
        selectAnotherInterpreter - Selected another interpreter.  
        Possible values include:  
            - `'notSelected'`  
            - `'selected'`  
            - `'installationCancelled'`  
            - `'selectAnotherInterpreter'`  


* DS_INTERNAL.SETTINGS  (Telemetry.DataScienceSettings)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    The list of settings a user has set. Sent on activation.  
    ```

    - Properties:  
        - `settingsJson`: `string`  
        A json representation of settings that the user has set.  
        The values for string based settings are transalted to 'default' | 'non-default' unless white-listed.  


* DS_INTERNAL.SHIFTENTER_BANNER_SHOWN  (Telemetry.ShiftEnterBannerShown)  
      Owner: [@amunger](https://github.com/amunger)  
    ```
    Information banner displayed to give the user the option to configure shift+enter for the Interactive Window.  
    ```



* DS_INTERNAL.SHOW_DATA_NO_PANDAS  (Telemetry.PandasNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    User tried to open the data viewer and Pandas package was not installed.  
    Note: Not a failure state, as we prompt for install after this.  
    ```



* DS_INTERNAL.SHOW_DATA_PANDAS_INSTALL_CANCELED  (Telemetry.PandasInstallCanceled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When opening the data viewer the user was prompted to install / upgrade  
    pandas and choose to cancel the operation.  
    ```



* DS_INTERNAL.SHOW_DATA_PANDAS_OK  (Telemetry.PandasOK)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When opening the data viewer the version of Pandas installed was ok.  
    ```



* DS_INTERNAL.SHOW_DATA_PANDAS_TOO_OLD  (Telemetry.PandasTooOld)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    When opening the data viewer the version of Pandas installed was too old.  
    ```



* DS_INTERNAL.START_SESSION_FAILED_JUPYTER  (Telemetry.StartSessionFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when starting a session for a local connection failed.  
    ```



* DS_INTERNAL.SWITCH_KERNEL  (Telemetry.SwitchKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Triggered when the kernel selection changes (note: This can also happen automatically when a notebook is opened).  
    WARNING: Due to changes in VS Code, this isn't necessarily a user action, hence difficult to tell if the user changed it or it changed automatically.  
    ```

    - Properties:  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Common to most of the events.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        Common to most of the events.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        Common to most of the events.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        Common to most of the events.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        Common to most of the events.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        Common to most of the events.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        Common to most of the events.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        Common to most of the events.  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        Common to most of the events.  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        Common to most of the events.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Common to most of the events.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        Common to most of the events.  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        Common to most of the events.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        Common to most of the events.  


* DS_INTERNAL.VARIABLE_EXPLORER_FETCH_TIME  (Telemetry.VariableExplorerFetchTime)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    How long did it take for a single variable request to be resolved.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.VARIABLE_EXPLORER_VARIABLE_COUNT  (Telemetry.VariableExplorerVariableCount)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Count how many variables were in a variable request.  
    ```

    - Measures:  
        - `variableCount`: `number`  
        Count of variables requested  


* DS_INTERNAL.VSCNOTEBOOK_CELL_TRANSLATION_FAILED  (Telemetry.VSCNotebookCellTranslationFailed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    We've failed to translate a Jupyter cell output for serialization into a Notebook cell.  
    ```

    - Properties:  
        - `outputType`: `string`  
        Type of the output received from the Jupyter kernel.  
        This is required to identify output types that we're not mapping correctly.  


* DS_INTERNAL.WAIT_FOR_IDLE_JUPYTER  (Telemetry.WaitForIdleJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Sent to measure the time taken to wait for a Jupyter kernel to be idle.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.WEBVIEW_STARTUP  (Telemetry.WebviewStartup)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    We started up a webview.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* ENVFILE_VARIABLE_SUBSTITUTION  (EventName.ENVFILE_VARIABLE_SUBSTITUTION)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when substituting Environment variables to calculate value of variables.  
    E.g. user has a a .env file with tokens that need to be replaced with env variables.  
    such as an env file having the variable `${HOME}`.  
    Gives us an idea of whether users have variable references in their .env files or not.  
    ```



* ENVFILE_WORKSPACE  (EventName.ENVFILE_WORKSPACE)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an environment file is detected in the workspace.  
    ```



* EXTENSION.LOAD  (EventName.EXTENSION_LOAD)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with perf measures related to activation and loading of extension.  
    ```

    - Measures:  
        - `totalActivateTime`: `number`  
        Time taken to activate the extension.  
        - `workspaceFolderCount`: `number`  
        Number of workspace folders opened  


* HASHED_PACKAGE_NAME  (EventName.HASHED_PACKAGE_NAME)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with hash of an imported python package.  
    Used to detect the popularity of a package, that would help determine which packages  
    need to be prioritized when resolving issues with intellisense or supporting similar issues related to a (known) specific package.  
    ```

    - Properties:  
        - `hashedNamev2`: `string`  
        Hash of the package name  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Common to most of the events.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `when`: `<see below>`  
        Whether the package was detected in an existing file (upon open, upon save, upon close) or when it was being used during execution.  
        Possible values include:  
            - `'onExecution'`  
            - `'onOpenCloseOrSave'`  


* JUPYTER_IS_INSTALLED  (Telemetry.JupyterInstalled)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent with result of detecting Jupyter in the current path.  
    ```

    - `/* Detection of jupyter failed`:  
        - Properties:  
            - `failed`: `true`  
            Failed to detect Jupyter.  
            - `frontEnd`: `<see below>`  
            Whether this is jupyter lab or notebook.  
            Possible values include:  
                - `'notebook'`  
                - `'lab'`  
            - `reason`: `'notInstalled'`  
            Reason for failure.  
    - `Jupyter was successfully detected`:  
        - Properties:  
            - `detection`: `'process'`  
            Jupyter is in current path of process owned by VS Code.  
            I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].  
            - `frontEnd`: `<see below>`  
            Whether this is jupyter lab or notebook.  
            Possible values include:  
                - `'notebook'`  
                - `'lab'`  
        - Measures:  
            - `frontEndVersion`: `number`  
            Version of the form 6.11, 4.8  


* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent when user opens the data viewer via the variable view and there is an error in doing so.  
    ```



* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent when user opens the data viewer via the variable view.  
    ```



* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry event sent when user opens the data viewer via the variable view and we successfully open the view.  
    ```



* PLOTVIEWER.WEBVIEW_LOADED  (Telemetry.PlotViewerWebviewLoaded)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    The Plot Viewer webview was loaded.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


