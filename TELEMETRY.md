# Telemetry created by Jupyter Extension

Expand each section to see more information about that event.

* DATASCIENCE.ADD_CELL_BELOW  (Telemetry.AddCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user adds a cell below the current cell for IW.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.CLICKED_EXPORT_NOTEBOOK_AS_QUICK_PICK  (Telemetry.ClickedExportNotebookAsQuickPick)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR format. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    User exports the IW or Notebook to a specific format.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.CREATE_NEW_INTERACTIVE  (Telemetry.CreateNewInteractive)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DATA_VIEWER_DATA_DIMENSIONALITY  (Telemetry.DataViewerDataDimensionality)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Measures not documented in GDPR numberOfDimensions</span>  
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
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR newState. Add jsDoc comments for the properties in telemetry.ts file.</span>  
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
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR source. Add jsDoc comments for the properties in telemetry.ts file.</span>  
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
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user hits the `continue` button while debugging IW  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.DEBUG_CURRENT_CELL  (Telemetry.DebugCurrentCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user debugs the cell in the IW  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.DEBUG_FILE_INTERACTIVE  (Telemetry.DebugFileInteractive)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user debugs the file in the IW  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.DEBUG_STEP_OVER  (Telemetry.DebugStepOver)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user hits the `step over` button while debugging IW  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.DEBUG_STOP  (Telemetry.DebugStop)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user hits the `stop` button while debugging IW  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.DEBUGGING.CLICKED_ON_SETUP  (DebuggingTelemetry.clickedOnSetup)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DEBUGGING.CLICKED_RUN_AND_DEBUG_CELL  (DebuggingTelemetry.clickedRunAndDebugCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DEBUGGING.CLICKED_RUNBYLINE  (DebuggingTelemetry.clickedRunByLine)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DEBUGGING.CLOSED_MODAL  (DebuggingTelemetry.closedModal)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DEBUGGING.ENDED_SESSION  (DebuggingTelemetry.endedSession)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR reason. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `reason`: `<see below>`  
        Possible values include:  
            - `'normally'`  
            - `'onKernelDisposed'`  
            - `'onAnInterrupt'`  
            - `'onARestart'`  
            - `'withKeybinding'`  


* DATASCIENCE.DEBUGGING.IPYKERNEL6_STATUS  (DebuggingTelemetry.ipykernel6Status)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR status. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `status`: `<see below>`  
        Possible values include:  
            - `'installed'`  
            - `'notInstalled'`  


* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_IW_JUPYTER  (DebuggingTelemetry.successfullyStartedIWJupyterDebugger)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry sent when we have managed to successfully start the Interactive Window debugger using the Jupyter protocol.  
    ```



* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUN_AND_DEBUG_CELL  (DebuggingTelemetry.successfullyStartedRunAndDebugCell)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DEBUGGING.SUCCESSFULLY_STARTED_RUNBYLINE  (DebuggingTelemetry.successfullyStartedRunByLine)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.DISABLE_INTERACTIVE_SHIFT_ENTER  (Telemetry.DisableInteractiveShiftEnter)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.ENABLE_INTERACTIVE_SHIFT_ENTER  (Telemetry.EnableInteractiveShiftEnter)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.ENTER_JUPYTER_URI  (Telemetry.EnterJupyterURI)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Captures the telemetry when the Uri is manually entered by the user as part of the workflow when selecting a Kernel.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.EXECUTE_CELL  (Telemetry.ExecuteCell)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Executes a cell, applies to IW and Notebook.  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.EXPORT_NOTEBOOK_AS  (Telemetry.ExportNotebookAs)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR format, cancelled, successful, opened. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Called when user imports a Jupyter Notebook into a Python file.  
    Command is `Jupyter: Import Jupyter Notebook`  
    Basically user is exporting some jupyter notebook into a Python file or other.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  
        - `cancelled`?: `boolean`  
        - `successful`?: `boolean`  
        - `opened`?: `boolean`  


* DATASCIENCE.EXPORT_NOTEBOOK_AS_COMMAND  (Telemetry.ExportNotebookAsCommand)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR format. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Called when user exports a Jupyter Notebook or IW into a Python file, HTML, PDF, etc.  
    Command is `Jupyter: Export to Python Script` or `Jupyter: Export to HTML`  
    Basically user is exporting some jupyter notebook or IW into a Python file or other.  
    ```

    - Properties:  
        - `format`: `<see below>`  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.EXPORT_NOTEBOOK_AS_FAILED  (Telemetry.ExportNotebookAsFailed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR format. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Export fails  
    ```

    - Properties:  
        - `format`: `<see below>`  
        Possible values include:  
            - `pdf`  
            - `html`  
            - `python`  
            - `ipynb`  


* DATASCIENCE.EXPORT_PYTHON_FILE  (Telemetry.ExportPythonFileInteractive)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    User exports a .py file with cells as a Jupyter Notebook.  
    ```



* DATASCIENCE.EXPORT_PYTHON_FILE_AND_OUTPUT  (Telemetry.ExportPythonFileAndOutputInteractive)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    User exports a .py file with cells along with the outputs from the current IW as a Jupyter Notebook.  
    ```



* DATASCIENCE.FAILED_SHOW_DATA_EXPLORER  (Telemetry.FailedShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.FAILED_TO_CREATE_CONTROLLER  (Telemetry.FailedToCreateNotebookController)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR kind. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `kind`: `<see below>`  
        What kind of kernel spec did we fail to create.  
        Possible values include:  
            - `'startUsingPythonInterpreter'`  
            - `'startUsingDefaultKernel'`  
            - `'startUsingLocalKernelSpec'`  
            - `'startUsingRemoteKernelSpec'`  
            - `'connectToLiveRemoteKernel'`  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  


* DATASCIENCE.FETCH_CONTROLLERS  (Telemetry.FetchControllers)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR cached, kind. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Telemetry sent when we have loaded some controllers.  
    ```

    - Properties:  
        - `cached`: `boolean`  
        Whether this is from a cached result or not  
        - `kind`: `<see below>`  
        Whether we've loaded local or remote controllers.  
        Possible values include:  
            - `'local'`  
            - `'remote'`  


* DATASCIENCE.GET_PASSWORD_ATTEMPT  (Telemetry.GetPasswordAttempt)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DATASCIENCE.GOTO_NEXT_CELL_IN_FILE  (Telemetry.GotoNextCellInFile)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.GOTO_PREV_CELL_IN_FILE  (Telemetry.GotoPrevCellInFile)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.IMPORT_NOTEBOOK  (Telemetry.ImportNotebook)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR scope. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Called when user imports a Jupyter Notebook into a Python file.  
    Command is `Jupyter: Import Jupyter Notebook`  
    Basically user is exporting some jupyter notebook into a Python file.  
    ```

    - Properties:  
        - `scope`: `<see below>`  
        Possible values include:  
            - `'command'`  
            - `'file'`  


* DATASCIENCE.INTERACTIVE_WINDOW_DEBUG_SETUP_CODE_FAILURE  (Telemetry.InteractiveWindowDebugSetupCodeFailure)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR ename, evalue. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `ename`: `string`  
        - `evalue`: `string`  


* DATASCIENCE.INTERRUPT  (Telemetry.Interrupt)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    User interrupts a cell  
    Identical to `Telemetry.InterruptJupyterTime`  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DATASCIENCE.JUPYTER_KERNEL_API_ACCESS  (Telemetry.JupyterKernelApiAccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `extensionId`: `string`  
        - `allowed`: `<see below>`  
        Possible values include:  
            - `'yes'`  
            - `'no'`  


* DATASCIENCE.JUPYTER_KERNEL_API_USAGE  (Telemetry.JupyterKernelApiUsage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `extensionId`: `string`  
        - `pemUsed`: `keyof IExportedKernelService`  


* DATASCIENCE.JUPYTER_KERNEL_FILTER_USED  (Telemetry.JupyterKernelFilterUsed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.JUPYTER_KERNEL_HIDDEN_VIA_FILTER  (Telemetry.JupyterKernelHiddenViaFilter)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.JUPYTER_NOT_INSTALLED_ERROR_SHOWN  (Telemetry.JupyterNotInstalledErrorShown)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DATASCIENCE.KERNEL_CRASH  (Telemetry.KernelCrash)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.KERNEL_SPEC_LANGUAGE  (Telemetry.KernelSpecLanguage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `language`: `string`  
        Language of the kernelSpec.  
        - `kind`: `<see below>`  
        Whether this is a local or remote kernel.  
        Possible values include:  
            - `'local'`  
            - `'remote'`  
        - `usesShell`?: `boolean`  
        Whether shell is used to start the kernel. E.g. `"/bin/sh"` is used in the argv of the kernelSpec.  
        OCaml is one such kernel.  


* DATASCIENCE.KERNEL_STARTUP_CODE_FAILURE  (Telemetry.KernelStartupCodeFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `ename`: `string`  
        - `evalue`: `string`  


* DATASCIENCE.NATIVE.CREATE_NEW_NOTEBOOK  (Telemetry.CreateNewNotebook)  
      Owner: [@unknown](https://github.com/unknown)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken.  


* DATASCIENCE.NATIVE.OPEN_NOTEBOOK_ALL  (Telemetry.OpenNotebookAll)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.NO_ACTIVE_KERNEL_SESSION  (Telemetry.NoActiveKernelSession)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Useful when we need an active kernel session in order to execute commands silently.  
    Used by the dataViewerDependencyService.  
    ```



* DATASCIENCE.NOTEBOOK_INTERRUPT  (Telemetry.NotebookInterrupt)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to interrupt a kernel  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    ```

    - `When interrupt is a success`:  
        - Properties:  
            - `result`: `<see below>`  
            The result of the interrupt,  
            Possible values include:  
                - `success`  
                - `timeout`  
                - `restart`  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    - `If there are unhandled exceptions`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            - `failed`: `true`  
            Whether there was a failure.  
            - `stackTrace`: `string`  
            Node stacktrace without PII.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  


* DATASCIENCE.NOTEBOOK_LANGUAGE  (Telemetry.NotebookLanguage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to indicate the language used in a notebook  
    ```

    - Properties:  
        - `language`: `string`  
        Language found in the notebook if a known language. Otherwise 'unknown'  


* DATASCIENCE.NOTEBOOK_RESTART  (Telemetry.NotebookRestart)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Restarts the Kernel.  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    ```

    - `Sent to capture just the time taken to restart, see comments.`:  
        - Properties:  
            - `startTimeOnly`: `true`  
            If true, this is the total time taken to restart the kernel (excluding times to stop current cells and the like).  
            Also in the case of raw kernels, we keep a separate process running, and when restarting we just switch to that process.  
            In such cases this value will be `undefined`. In the case of raw kernels this will be true only when starting a new kernel process from scratch.  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    - `If there are unhandled exceptions.`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            - `failed`: `true`  
            Whether there was a failure.  
            - `stackTrace`: `string`  
            Node stacktrace without PII.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
        - Measures:  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  


* DATASCIENCE.NOTEBOOK_START  (Telemetry.NotebookStart)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Starts a kernel, applies to IW and Notebook.  
    Check the `resourceType` to determine whether its a Jupyter Notebook or IW.  
    If `failed` is false, then its a success, else startup failed.  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.OPEN_PLOT_VIEWER  (Telemetry.OpenPlotViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.PYTHON_VARIABLE_FETCHING_CODE_FAILURE  (Telemetry.PythonVariableFetchingCodeFailure)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR ename, evalue. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `ename`: `string`  
        - `evalue`: `string`  


* DATASCIENCE.RECOMMENT_EXTENSION  (Telemetry.RecommendExtension)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR extensionId, action. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `extensionId`: `string`  
        Extension we recommended the user to install.  
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


* DATASCIENCE.REFRESH_DATA_VIEWER  (Telemetry.RefreshDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Sent when the jupyter.refreshDataViewer command is invoked  
    ```



* DATASCIENCE.RESTART_KERNEL_COMMAND  (Telemetry.RestartKernelCommand)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when IW or Notebook is restarted.  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.RUN_ALL_CELLS  (Telemetry.RunAllCells)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run all Cell Commands in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_ALL_CELLS_ABOVE  (Telemetry.RunAllCellsAbove)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run all the above cells in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_BY_LINE_VARIABLE_HOVER  (Telemetry.RunByLineVariableHover)  
      Owner: [@roblourens](https://github.com/roblourens)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.RUN_CELL_AND_ALL_BELOW  (Telemetry.RunCellAndAllBelow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run current cell and all below in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CHANGE_CELL_TO_CODE  (Telemetry.ChangeCellToCode)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CHANGE_CELL_TO_MARKDOWN  (Telemetry.ChangeCellToMarkdown)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CURRENT_CELL  (Telemetry.RunCurrentCell)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run the current Cell in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CURRENT_CELL_AND_ADD_BELOW  (Telemetry.RunCurrentCellAndAddBelow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_CURRENT_CELL_AND_ADVANCE  (Telemetry.RunCurrentCellAndAdvance)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run current cell and advance cursor in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_DELETE_CELLS  (Telemetry.DeleteCells)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_ABOVE  (Telemetry.ExtendSelectionByCellAbove)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_EXTEND_SELECTION_BY_CELL_BELOW  (Telemetry.ExtendSelectionByCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_FILE_INTERACTIVE  (Telemetry.RunFileInteractive)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run file in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_FROM_LINE  (Telemetry.RunFromLine)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_INSERT_CELL_ABOVE  (Telemetry.InsertCellAbove)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_INSERT_CELL_BELOW  (Telemetry.InsertCellBelow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_INSERT_CELL_BELOW_POSITION  (Telemetry.InsertCellBelowPosition)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Cell Edit Commands in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_MOVE_CELLS_DOWN  (Telemetry.MoveCellsDown)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_MOVE_CELLS_UP  (Telemetry.MoveCellsUp)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECT_CELL  (Telemetry.SelectCell)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECT_CELL_CONTENTS  (Telemetry.SelectCellContents)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_SELECTION_OR_LINE  (Telemetry.RunSelectionOrLine)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Run a Selection or Line in Interactive Python  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.RUN_TO_LINE  (Telemetry.RunToLine)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.SELECT_JUPYTER_INTERPRETER_Command  (Telemetry.SelectJupyterInterpreterCommand)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent when user selects an interpreter to start jupyter server.  
    ```



* DATASCIENCE.SELECT_JUPYTER_URI  (Telemetry.SelectJupyterURI)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.SELECT_LOCAL_JUPYTER_KERNEL  (Telemetry.SelectLocalJupyterKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.SELECT_REMOTE_JUPYTER_KERNEL  (Telemetry.SelectRemoteJupyterKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DATASCIENCE.SELFCERTSMESSAGECLOSE  (Telemetry.SelfCertsMessageClose)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DATASCIENCE.SELFCERTSMESSAGEENABLED  (Telemetry.SelfCertsMessageEnabled)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DATASCIENCE.SET_JUPYTER_URI_LOCAL  (Telemetry.SetJupyterURIToLocal)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.SET_JUPYTER_URI_UI_DISPLAYED  (Telemetry.SetJupyterURIUIDisplayed)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR commandSource. Add jsDoc comments for the properties in telemetry.ts file.</span>  
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
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR azure. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `azure`: `boolean`  


* DATASCIENCE.SHOW_DATA_EXPLORER  (Telemetry.ShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR rows, columns. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `rows`: `<see below>`  
        Possible values include:  
            - `null or <empty>`  
        - `columns`: `<see below>`  
        Possible values include:  
            - `null or <empty>`  


* DATASCIENCE.START_SHOW_DATA_EXPLORER  (Telemetry.StartShowDataViewer)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DATASCIENCE.USER_DID_NOT_INSTALL_JUPYTER  (Telemetry.UserDidNotInstallJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DATASCIENCE.USER_DID_NOT_INSTALL_PANDAS  (Telemetry.UserDidNotInstallPandas)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.USER_INSTALLED_JUPYTER  (Telemetry.UserInstalledJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DATASCIENCE.USER_INSTALLED_PANDAS  (Telemetry.UserInstalledPandas)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DATASCIENCE.USER_STARTUP_CODE_FAILURE  (Telemetry.UserStartupCodeFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `ename`: `string`  
        - `evalue`: `string`  


* DATAVIEWER.USING_INTERPRETER  (Telemetry.DataViewerUsingInterpreter)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    When the Data Viewer installer is using the Python interpreter.  
    ```



* DATAVIEWER.USING_KERNEL  (Telemetry.DataViewerUsingKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    When the Data Viewer installer is using the Kernel.  
    ```



* DS_INTERNAL.ACTIVE_INTERPRETER_LISTING_PERF  (Telemetry.ActiveInterpreterListingPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `firstTime`?: `boolean`  
        Whether this is the first time in the session.  
        (fetching kernels first time in the session is slower, later its cached).  
        This is a generic property supported for all telemetry (sent by decorators).  
    - Measures:  
        - `duration`: `number`  
        Total time taken to list interpreters.  


* DS_INTERNAL.CODE_LENS_ACQ_TIME  (Telemetry.CodeLensAverageAcquisitionTime)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.COMMAND_EXECUTED  (Telemetry.CommandExecuted)  
      Owner: [@unknown](https://github.com/unknown)  
    ```
    Telemetry sent when a command is executed.  
    ```

    - Properties:  
        - `command`: `string`  
        Name of the command executed.  


* DS_INTERNAL.CONNECTFAILEDJUPYTER  (Telemetry.ConnectFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  


* DS_INTERNAL.CONNECTLOCALJUPYTER  (Telemetry.ConnectLocalJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.CONNECTREMOTEEXPIREDCERTFAILEDJUPYTER  (Telemetry.ConnectRemoteExpiredCertFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Jupyter server's certificate has expired.  
    ```



* DS_INTERNAL.CONNECTREMOTEFAILEDJUPYTER  (Telemetry.ConnectRemoteFailedJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  


* DS_INTERNAL.CONNECTREMOTEJUPYTER  (Telemetry.ConnectRemoteJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


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



* DS_INTERNAL.ERROR_START_RAWKERNEL_WITHOUT_INTERPRETER  (Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `pythonExtensionInstalled`: `boolean`  
        Indicates whether the python extension is installed.  
        If we send telemetry fro this & this is `true`, then we have a bug.  
        If its `false`, then we can ignore this telemetry.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.EXECUTE_CELL_PERCEIVED_COLD  (Telemetry.ExecuteCellPerceivedCold)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent to capture first time execution of a cell.  
    If `notebook = true`, this its telemetry for Jupyter notebooks, else applies to IW.  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.EXECUTE_CELL_PERCEIVED_WARM  (Telemetry.ExecuteCellPerceivedWarm)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent to capture subsequent execution of a cell.  
    If `notebook = true`, this its telemetry for native editor/notebooks.  
    (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.FAILED_TO_UPDATE_JUPYTER_KERNEL_SPEC  (Telemetry.FailedToUpdateKernelSpec)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


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
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvType`?: `<see below>`  
        Duplicate of `envType`, the property `envType` doesn't seem to be coming through.  
        If we can get `envType`, then we'll deprecate this new property.  
        Else we just deprecate & remote the old property.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `failed`: `boolean`  
        Whether the env variables were fetched successfully or not.  
        - `source`: `<see below>`  
        Source where the env variables were fetched from.  
        If `python`, then env variables were fetched from Python extension.  
        If `jupyter`, then env variables were fetched from Jupyter extension.  
        Possible values include:  
            - `'python'`  
            - `'jupyter'`  
        - `reason`?: `<see below>`  
        Reason for not being able to get the env variables.  
        Possible values include:  
            - `'noActivationCommands'`  
            - `'unknownOS'`  
            - `'emptyVariables'`  
            - `'unhandledError'`  
            - `'emptyFromCondaRun'`  
            - `'emptyFromPython'`  
            - `'failedToGetActivatedEnvVariablesFromPython'`  
            - `'failedToGetCustomEnvVariables'`  
    - Measures:  
        - `duration`: `number`  
        Time taken.  
        Total time taken to list interpreters. Total time taken to list kernels.  


* DS_INTERNAL.GET_PASSWORD_FAILURE  (Telemetry.GetPasswordFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.GET_PASSWORD_SUCCESS  (Telemetry.GetPasswordSuccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.HASHED_OUTPUT_MIME_TYPE  (Telemetry.HashedCellOutputMimeType)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Hash of the mime type of a cell output.  
    Used to detect the popularity of a mime type, that would help determine which mime types are most common.  
    E.g. if we see widget mimetype, then we know how many use ipywidgets and the like and helps us prioritize widget issues,  
    or prioritize rendering of widgets when opening an existing notebook or the like.  
    ```

    - Properties:  
        - `hashedName`: `string`  
        Hash of the cell output mimetype  
        - `hasText`: `boolean`  
        Whether the mime type has the word 'text' in it.  
        - `hasLatex`: `boolean`  
        Whether the mime type has the word 'latex' in it.  
        - `hasHtml`: `boolean`  
        Whether the mime type has the word 'html' in it.  
        - `hasSvg`: `boolean`  
        Whether the mime type has the word 'svg' in it.  
        - `hasXml`: `boolean`  
        Whether the mime type has the word 'xml' in it.  
        - `hasJson`: `boolean`  
        Whether the mime type has the word 'json' in it.  
        - `hasImage`: `boolean`  
        Whether the mime type has the word 'image' in it.  
        - `hasGeo`: `boolean`  
        Whether the mime type has the word 'geo' in it.  
        - `hasPlotly`: `boolean`  
        Whether the mime type has the word 'plotly' in it.  
        - `hasVega`: `boolean`  
        Whether the mime type has the word 'vega' in it.  
        - `hasWidget`: `boolean`  
        Whether the mime type has the word 'widget' in it.  
        - `hasJupyter`: `boolean`  
        Whether the mime type has the word 'jupyter' in it.  
        - `hasVnd`: `boolean`  
        Whether the mime type has the word 'vnd' in it.  


* DS_INTERNAL.INTERACTIVE_FILE_TOOLTIPS_PERF  (Telemetry.InteractiveFileTooltipsPerf)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR isResultNull. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `isResultNull`: `boolean`  


* DS_INTERNAL.INTERPRETER_LISTING_PERF  (Telemetry.InterpreterListingPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time taken to list the Python interpreters.  
    ```

    - Properties:  
        - `firstTime`?: `boolean`  
        Whether this is the first time in the session.  
        (fetching kernels first time in the session is slower, later its cached).  
        This is a generic property supported for all telemetry (sent by decorators).  
    - Measures:  
        - `duration`: `number`  
        Total time taken to list interpreters.  


* DS_INTERNAL.INTERRUPT_JUPYTER_TIME  (Telemetry.InterruptJupyterTime)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    User interrupts a cell  
    Identical to `Telemetry.Interrupt`  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.INVALID_KERNEL_USED  (Telemetry.KernelInvalid)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when a kernel picked crashes on startup  
    ```



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


* DS_INTERNAL.IPYWIDGET_DISCOVERED  (Telemetry.HashedIPyWidgetNameDiscovered)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with name of a Widget found.  
    ```

    - Properties:  
        - `hashedName`: `string`  
        Hash of the widget  
        - `source`?: `<see below>`  
        Where did we find the hashed name (CDN or user environment or remote jupyter).  
        Possible values include:  
            - `'cdn'`  
            - `'local'`  
            - `'remote'`  


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
            - `widgetFolderNameHash`: `string`  
            Hash of the widget folder name.  
            - `patternUsedToRegisterRequireConfig`: `string`  
            Pattern (code style) used to register require.config enties.  
        - Measures:  
            - `requireEntryPointCount`: `number`  
            Total number of entries in the require config.  
    - `Failed to parse extension.js.`:  
        - Properties:  
            - `widgetFolderNameHash`: `string`  
            Hash of the widget folder name.  
            - `failed`: `true`  
            - `failure`: `<see below>`  
            Possible values include:  
                - `'couldNotLocateRequireConfigStart'`  
                - `'couldNotLocateRequireConfigEnd'`  
                - `'noRequireConfigEntries'`  
            - `patternUsedToRegisterRequireConfig`: `<see below>`  
            Pattern (code style) used to register require.config enties.  
            Possible values include:  
                - `null or <empty>`  


* DS_INTERNAL.IPYWIDGET_LOAD_FAILURE  (Telemetry.IPyWidgetLoadFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget module fails to load. Module name is hashed.  
    ```

    - Properties:  
        - `isOnline`: `boolean`  
        - `moduleHash`: `string`  
        - `moduleVersion`: `string`  
        - `timedout`: `boolean`  


* DS_INTERNAL.IPYWIDGET_LOAD_SUCCESS  (Telemetry.IPyWidgetLoadSuccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget module loads. Module name is hashed.  
    ```

    - Properties:  
        - `moduleHash`: `string`  
        - `moduleVersion`: `string`  


* DS_INTERNAL.IPYWIDGET_OVERHEAD  (Telemetry.IPyWidgetOverhead)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to indicate the overhead of syncing the kernel with the UI.  
    ```

    - Measures:  
        - `totalOverheadInMs`: `number`  
        - `numberOfMessagesWaitedOn`: `number`  
        - `averageWaitTime`: `number`  
        - `numberOfRegisteredHooks`: `number`  


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
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.IPYWIDGET_UNHANDLED_MESSAGE  (Telemetry.IPyWidgetUnhandledMessage)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when the widget tries to send a kernel message but nothing was listening  
    ```

    - Properties:  
        - `msg_type`: `string`  


* DS_INTERNAL.IPYWIDGET_USED_BY_USER  (Telemetry.HashedIPyWidgetNameUsed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with name of a Widget that is used.  
    ```

    - Properties:  
        - `hashedName`: `string`  
        Hash of the widget  
        - `source`?: `<see below>`  
        Where did we find the hashed name (CDN or user environment or remote jupyter).  
        Possible values include:  
            - `'cdn'`  
            - `'local'`  
            - `'remote'`  
        - `cdnSearched`: `boolean`  
        Whether we searched CDN or not.  


* DS_INTERNAL.IPYWIDGET_WIDGET_VERSION_NOT_SUPPORTED_LOAD_FAILURE  (Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when an ipywidget version that is not supported is used & we have trapped this and warned the user abou it.  
    ```

    - Properties:  
        - `moduleHash`: `string`  
        - `moduleVersion`: `string`  


* DS_INTERNAL.JUPYTER_CREATING_NOTEBOOK  (Telemetry.JupyterCreatingNotebook)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - `When things fail`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            - `failed`: `true`  
            Whether there was a failure.  
            - `stackTrace`: `string`  
            Node stacktrace without PII.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    - `When successfully created`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.JUPYTER_CUSTOM_COMMAND_LINE  (Telemetry.JupyterCommandLineNonDefault)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to when user customizes the jupyter command line  
    ```



* DS_INTERNAL.JUPYTER_IDLE_TIMEOUT  (Telemetry.SessionIdleTimeout)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.JUPYTER_INTALLED_BUT_NO_KERNELSPEC_MODULE  (Telemetry.JupyterInstalledButNotKernelSpecModule)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when jupyter has been found in interpreter but we cannot find kernelspec.  
    ```



* DS_INTERNAL.JUPYTER_REGISTER_INTERPRETER_AS_KERNEL  (Telemetry.RegisterInterpreterAsKernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.JUPYTERSTARTUPCOST  (Telemetry.StartJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.KERNEL_COUNT  (Telemetry.KernelCount)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel list.  
        - `condaEnvsSharingSameInterpreter`: `number`  
        Total number of conda environments that share the same interpreter  
        This happens when we create conda envs without the `python` argument.  
        Such conda envs don't work today in the extension.  
        Hence users with such environments could hvae issues with starting kernels or packages not getting loaded correctly or at all.  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        Total number of kernel specs in the kernel list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        Total number of interpreters in the kernel list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  
        Total number of live kernels in the kernel list.  


* DS_INTERNAL.KERNEL_LAUNCHER_PERF  (Telemetry.KernelLauncherPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to Launch a raw kernel.  
    ```

    -  Group 1:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    -  Group 2:  
        - Properties:  
            - `failed`: `true`  
            Whether there was a failure.  
            - `stackTrace`: `string`  
            Node stacktrace without PII.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  


* DS_INTERNAL.KERNEL_LISTING_PERF  (Telemetry.KernelListingPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `firstTime`?: `boolean`  
        Whether this is the first time in the session.  
        (fetching kernels first time in the session is slower, later its cached).  
        This is a generic property supported for all telemetry (sent by decorators).  
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
        Total time taken to list interpreters.  


* DS_INTERNAL.KERNEL_PROVIDER_PERF  (Telemetry.KernelProviderPerf)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to list kernels for VS Code.  
    ```



* DS_INTERNAL.KERNEL_SPEC_NOT_FOUND  (Telemetry.KernelSpecNotFound)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent to indicate 'jupyter kernelspec' is not possible.  
    ```



* DS_INTERNAL.LOCAL_KERNEL_SPEC_COUNT  (Telemetry.NumberOfLocalKernelSpecs)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total number of Local kernel specifications.  
    ```

    - Measures:  
        - `count`: `number`  
        Number of kernel specs found on disc.  


* DS_INTERNAL.NATIVE_VARIABLE_VIEW_LOADED  (Telemetry.NativeVariableViewLoaded)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.NATIVE_VARIABLE_VIEW_MADE_VISIBLE  (Telemetry.NativeVariableViewMadeVisible)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.NATIVE.NOTEBOOK_OPEN_COUNT  (Telemetry.NotebookOpenCount)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total number of Jupyter notebooks or IW opened. Telemetry Sent when VS Code is closed.  
    ```

    - Measures:  
        - `count`: `number`  


* DS_INTERNAL.NATIVE.NOTEBOOK_RUN_COUNT  (Telemetry.NotebookRunCount)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total number of cells executed. Telemetry Sent when VS Code is closed.  
    ```

    - Measures:  
        - `count`: `number`  


* DS_INTERNAL.NEW_FILE_USED_IN_INTERACTIVE  (Telemetry.NewFileForInteractiveWindow)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when a user runs the interactive window with a new file  
    ```



* DS_INTERNAL.NUMBER_OF_REMOTE_KERNEL_IDS_SAVED  (Telemetry.NumberOfSavedRemoteKernelIds)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Measures not documented in GDPR count</span>  
    - Measures:  
        - `count`: `number`  


* DS_INTERNAL.PERCEIVED_JUPYTER_STARTUP_NOTEBOOK  (Telemetry.PerceivedJupyterStartupNotebook)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time take for jupyter server to start and be ready to run first user cell.  
    (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.PREFERRED_KERNEL  (Telemetry.PreferredKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
    ```
    Telemetry sent when we have attempted to find the preferred kernel.  
    ```

    - Properties:  
        - `result`: `<see below>`  
        Possible values include:  
            - `'found'`  
            - `'notfound'`  
            - `'failed'`  
        - `language`: `string`  
        - `hasActiveInterpreter`?: `boolean`  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  


* DS_INTERNAL.PREFERRED_KERNEL_EXACT_MATCH  (Telemetry.PreferredKernelExactMatch)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR matchedReason. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `matchedReason`: `<see below>`  


* DS_INTERNAL.PYTHON_EXTENSION_INSTALLED_VIA_KERNEL_PICKER  (Telemetry.PythonExtensionInstalledViaKernelPicker)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR action. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `action`: `<see below>`  
        Possible values include:  
            - `'success'`  
            - `'failed'`  


* DS_INTERNAL.PYTHON_EXTENSION_NOT_INSTALLED  (Telemetry.PythonExtensionNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR action. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `action`: `<see below>`  
        Possible values include:  
            - `'displayed'`  
            - `'dismissed'`  
            - `'download'`  


* DS_INTERNAL.PYTHON_KERNEL_EXECUTABLE_MATCHES  (Telemetry.PythonKerneExecutableMatches)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry sent for local Python Kernels.  
    Tracking whether we have managed to launch the kernel that matches the interpreter.  
    If match=false, then this means we have failed to launch the right kernel.  
    ```

    - Properties:  
        - `match`: `<see below>`  
        Whether we've managed to correctly identify the Python Environment.  
        Possible values include:  
            - `'true'`  
            - `'false'`  
        - `kernelConnectionType`: `<see below>`  
        Type of kernel connection, whether its local, remote or a python environment.  
        Possible values include:  
            - `'startUsingLocalKernelSpec'`  
            - `'startUsingPythonInterpreter'`  
            - `'startUsingRemoteKernelSpec'`  


* DS_INTERNAL.PYTHON_MODULE_INSTALL  (Telemetry.PythonModuleInstall)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `moduleName`: `string`  
        - `isModulePresent`?: `<see below>`  
        Whether the module was already (once before) installed into the python environment or  
        whether this already exists (detected via `pip list`)  
        Possible values include:  
            - `'true'`  
            - `null or <empty>`  
        - `action`: `<see below>`  
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
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        - `pythonEnvType`?: `<see below>`  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.PYTHON_NOT_INSTALLED  (Telemetry.PythonNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR action. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `action`: `<see below>`  
        Possible values include:  
            - `'displayed'`  
            - `'dismissed'`  
            - `'download'`  


* DS_INTERNAL.RANK_KERNELS_PERF  (Telemetry.RankKernelsPerf)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Total time taken to find a kernel on disc or on a remote machine.  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_CREATING_NOTEBOOK  (Telemetry.RawKernelCreatingNotebook)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_INFO_RESPONSE  (Telemetry.RawKernelInfoResponse)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    After starting a kernel we send a request to get the kernel info.  
    This tracks the total time taken to get the response back (or wether we timedout).  
    If we timeout and later we find successful comms for this session, then timeout is too low  
    or we need more attempts.  
    ```

    - Properties:  
        - `timedout`: `boolean`  
        Whether we timedout while waiting for response for Kernel info request.  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `attempts`: `number`  
        Total number of attempts and sending a request and waiting for response.  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_PROCESS_LAUNCH  (Telemetry.RawKernelProcessLaunch)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.RAWKERNEL_SESSION_CONNECT  (Telemetry.RawKernelSessionConnect)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_DISPOSED  (Telemetry.RawKernelSessionDisposed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when a RawSession's `dispose` method is called.  
    ```

    - Properties:  
        - `stacktrace`: `<see below>`  
        This is the callstack at the time that the `dispose` method  
        is called, intended for us to be able to identify who called  
        `dispose` on the RawSession.  
        Possible values include:  
            - `null or <empty>`  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_KERNEL_PROCESS_EXITED  (Telemetry.RawKernelSessionKernelProcessExited)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when the underlying kernelProcess for a  
    RawJupyterSession exits.  
    ```

    - Properties:  
        - `exitReason`: `<see below>`  
        The kernel process's exit reason, based on the error  
        object's reason  
        Possible values include:  
            - `null or <empty>`  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `exitCode`: `number`  
        The kernel process's exit code.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_NO_IPYKERNEL  (Telemetry.RawKernelSessionStartNoIpykernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
       <span style="color:red">Properties not documented in GDPR reason. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `reason`: `<see below>`  
        Possible values include:  
            - `0`  
            - `1`  
            - `2`  
            - `3`  
            - `4`  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  


* DS_INTERNAL.RAWKERNEL_SESSION_SHUTDOWN  (Telemetry.RawKernelSessionShutdown)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    This event is sent when a RawJupyterSession's `shutdownSession`  
    method is called.  
    ```

    - Properties:  
        - `isRequestToShutdownRestartSession`: `<see below>`  
        This indicates whether the session being shutdown  
        is a restart session.  
        Possible values include:  
            - `true`  
            - `false`  
            - `null or <empty>`  
        - `stacktrace`: `<see below>`  
        This is the callstack at the time that the `shutdownSession`  
        method is called, intended for us to be ale to identify who  
        tried to shutdown the session.  
        Possible values include:  
            - `null or <empty>`  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_START  (Telemetry.RawKernelSessionStart)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - `When started successfully.`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `duration`: `number`  
            Duration of a measure in milliseconds.  
            Common measurement used across a number of events.  
            Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    - `Sent when we fail to restart a kernel and have a failureCategory.`:  
        - Properties:  
            - `failed`: `true`  
            Whether there was a failure.  
            - `failureCategory`: `<see below>`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            Possible values include:  
                - `cancelled`  
                - `timeout`  
                - `daemon`  
                - `zmq`  
                - `debugger`  
                - `kerneldied`  
                - `kernelpromisetimeout`  
                - `jupytersession`  
                - `jupyterconnection`  
                - `jupyterinstall`  
                - `jupyterselfcert`  
                - `jupyterexpiredcert`  
                - `jupyterselfexpiredcert`  
                - `invalidkernel`  
                - `noipykernel`  
                - `fetcherror`  
                - `notinstalled`  
                - `kernelspecnotfound`  
                - `unsupportedKernelSpec`  
                - `sessionDisposed`  
                - `nodeonly`  
                - `remotejupyterserverconnection`  
                - `localjupyterserverconnection`  
                - `remotejupyterserveruriprovider`  
                - `invalidremotejupyterserverurihandle`  
                - `unknown`  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
        - Measures:  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  
    - `If there are unhandled exceptions.`:  
        - Properties:  
            - `resourceType`?: `<see below>`  
            Used to determine whether this event is related to a Notebooks or Interactive window.  
            Possible values include:  
                - `'notebook'`  
                - `'interactive'`  
            - `userExecutedCell`?: `boolean`  
            Whether the user executed a cell.  
            - `kernelId`: `string`  
            Hash of the Kernel Connection id.  
            - `disableUI`?: `boolean`  
            Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
            If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
            - `resourceHash`?: `string`  
            Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
            If we run the same notebook tomorrow, the hash will be the same.  
            Used to check whether a particular notebook fails across time or not.  
            This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
            and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
            we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
            and have a better understanding of what is going on, e.g. why something failed.  
            - `kernelSessionId`: `string`  
            Unique identifier for an instance of a notebook session.  
            If we restart or run this notebook tomorrow, this id will be different.  
            Id could be something as simple as a hash of the current Epoch time.  
            - `isUsingActiveInterpreter`?: `boolean`  
            Whether this resource is using the active Python interpreter or not.  
            - `pythonEnvironmentType`?: `<see below>`  
            Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
            Possible values include:  
                - `Unknown`  
                - `Conda`  
                - `VirtualEnv`  
                - `PipEnv`  
                - `Pyenv`  
                - `Venv`  
                - `WindowsStore`  
                - `Poetry`  
                - `VirtualEnvWrapper`  
                - `Global`  
                - `System`  
            - `pythonEnvironmentPath`?: `string`  
            A key, so that rest of the information is tied to this. (hash)  
            - `pythonEnvironmentVersion`?: `string`  
            Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
            - `pythonEnvironmentPackages`?: `string`  
            Comma delimited list of hashed packages & their versions.  
            - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
            Whether kernel was started using kernel spec, interpreter, etc.  
            - `kernelLanguage`: `string`  
            Language of the kernel connection.  
            - `actionSource`: `<see below>`  
            Whether this was started by Jupyter extension or a 3rd party.  
            Possible values include:  
                - `jupyterExtension`  
                - `3rdPartyExtension`  
            - `capturedEnvVars`?: `boolean`  
            Whether we managed to capture the environment variables or not.  
            In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
            - `failed`: `true`  
            Whether there was a failure.  
            - `stackTrace`: `string`  
            Node stacktrace without PII.  
            - `failureCategory`?: `string`  
            A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
            - `failureSubCategory`?: `string`  
            Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            Name of the method in the extension that threw the exception. Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
            - `pythonErrorFile`?: `string`  
            Hash of the file name that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorFolder`?: `string`  
            Hash of the folder that contains the file in the last frame (from Python stack trace).  
            - `pythonErrorPackage`?: `string`  
            Hash of the module that contains the file in the last frame (from Python stack trace).  
        - Measures:  
            - `pythonEnvironmentCount`?: `number`  
            Total number of python environments.  
            - `interruptCount`?: `number`  
            This number gets reset after we attempt a restart or change kernel.  
            - `restartCount`?: `number`  
            This number gets reset after change the kernel.  
            - `startFailureCount`?: `number`  
            Number of times starting the kernel failed.  
            - `switchKernelCount`?: `number`  
            Number of times the kernel was changed.  
            - `kernelSpecCount`: `number`  
            Total number of kernel specs in the kernel spec list.  
            - `kernelInterpreterCount`: `number`  
            Total number of interpreters in the kernel spec list.  
            - `kernelLiveCount`: `number`  
            Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_START_EXCEPTION  (Telemetry.RawKernelSessionStartException)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_START_SUCCESS  (Telemetry.RawKernelSessionStartSuccess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_SESSION_START_USER_CANCEL  (Telemetry.RawKernelSessionStartUserCancel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.RAWKERNEL_START_RAW_SESSION  (Telemetry.RawKernelStartRawSession)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.REGISTER_AND_USE_INTERPRETER_AS_KERNEL  (Telemetry.RegisterAndUseInterpreterAsKernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.REMOTE_KERNEL_SPEC_COUNT  (Telemetry.NumberOfRemoteKernelSpecs)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total number of Remote kernel specifications.  
    ```

    - Measures:  
        - `count`: `number`  
        Number of remote kernel specs.  


* DS_INTERNAL.RESTART_JUPYTER_TIME  (Telemetry.RestartJupyterTime)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to restart a kernel.  
    Identical to `Telemetry.RestartKernel`  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.RESTART_KERNEL  (Telemetry.RestartKernel)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Total time taken to restart a kernel.  
    Identical to `Telemetry.RestartJupyterTime`  
    ```

    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.RUNTEST  (Telemetry.RunTest)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR testName, testResult, perfWarmup, commitHash, timedCheckpoints. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `testName`: `string`  
        - `testResult`: `string`  
        - `perfWarmup`?: `'true'`  
        - `commitHash`?: `string`  
        - `timedCheckpoints`?: `string`  


* DS_INTERNAL.SELECT_JUPYTER_INTERPRETER  (Telemetry.SelectJupyterInterpreter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `result`?: `<see below>`  
        The result of the selection.  
        notSelected - No interpreter was selected.  
        selected - An interpreter was selected (and configured to have jupyter and notebook).  
        installationCancelled - Installation of jupyter and/or notebook was cancelled for an interpreter.  
        Possible values include:  
            - `'notSelected'`  
            - `'selected'`  
            - `'installationCancelled'`  


* DS_INTERNAL.SELECT_JUPYTER_INTERPRETER_MESSAGE_DISPLAYED  (Telemetry.SelectJupyterInterpreterMessageDisplayed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  


* DS_INTERNAL.SHIFTENTER_BANNER_SHOWN  (Telemetry.ShiftEnterBannerShown)  
      Owner: [@amunger](https://github.com/amunger)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.SHOW_DATA_NO_PANDAS  (Telemetry.PandasNotInstalled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.SHOW_DATA_PANDAS_INSTALL_CANCELED  (Telemetry.PandasInstallCanceled)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR version. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `version`: `string`  


* DS_INTERNAL.SHOW_DATA_PANDAS_OK  (Telemetry.PandasOK)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.SHOW_DATA_PANDAS_TOO_OLD  (Telemetry.PandasTooOld)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.START_EXECUTE_NOTEBOOK_CELL_PERCEIVED_COLD  (Telemetry.StartExecuteNotebookCellPerceivedCold)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Time take for jupyter server to be busy from the time user first hit `run` cell until jupyter reports it is busy running a cell.  
    ```

    - Properties:  
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.START_JUPYTER_PROCESS  (Telemetry.StartJupyterProcess)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


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
        - `resourceType`?: `<see below>`  
        Used to determine whether this event is related to a Notebooks or Interactive window.  
        Possible values include:  
            - `'notebook'`  
            - `'interactive'`  
        - `userExecutedCell`?: `boolean`  
        Whether the user executed a cell.  
        - `kernelId`: `string`  
        Hash of the Kernel Connection id.  
        - `disableUI`?: `boolean`  
        Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.  
        If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)  
        - `resourceHash`?: `string`  
        Hash of the resource (notebook.uri or pythonfile.uri associated with this).  
        If we run the same notebook tomorrow, the hash will be the same.  
        Used to check whether a particular notebook fails across time or not.  
        This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,  
        and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or  
        we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points  
        and have a better understanding of what is going on, e.g. why something failed.  
        - `kernelSessionId`: `string`  
        Unique identifier for an instance of a notebook session.  
        If we restart or run this notebook tomorrow, this id will be different.  
        Id could be something as simple as a hash of the current Epoch time.  
        - `isUsingActiveInterpreter`?: `boolean`  
        Whether this resource is using the active Python interpreter or not.  
        - `pythonEnvironmentType`?: `<see below>`  
        Found plenty of issues when starting kernels with conda, hence useful to capture this info.  
        Possible values include:  
            - `Unknown`  
            - `Conda`  
            - `VirtualEnv`  
            - `PipEnv`  
            - `Pyenv`  
            - `Venv`  
            - `WindowsStore`  
            - `Poetry`  
            - `VirtualEnvWrapper`  
            - `Global`  
            - `System`  
        - `pythonEnvironmentPath`?: `string`  
        A key, so that rest of the information is tied to this. (hash)  
        - `pythonEnvironmentVersion`?: `string`  
        Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)  
        - `pythonEnvironmentPackages`?: `string`  
        Comma delimited list of hashed packages & their versions.  
        - `kernelConnectionType`?: `KernelConnectionMetadata['kind']`  
        Whether kernel was started using kernel spec, interpreter, etc.  
        - `kernelLanguage`: `string`  
        Language of the kernel connection.  
        - `actionSource`: `<see below>`  
        Whether this was started by Jupyter extension or a 3rd party.  
        Possible values include:  
            - `jupyterExtension`  
            - `3rdPartyExtension`  
        - `capturedEnvVars`?: `boolean`  
        Whether we managed to capture the environment variables or not.  
        In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.  
    - Measures:  
        - `pythonEnvironmentCount`?: `number`  
        Total number of python environments.  
        - `interruptCount`?: `number`  
        This number gets reset after we attempt a restart or change kernel.  
        - `restartCount`?: `number`  
        This number gets reset after change the kernel.  
        - `startFailureCount`?: `number`  
        Number of times starting the kernel failed.  
        - `switchKernelCount`?: `number`  
        Number of times the kernel was changed.  
        - `kernelSpecCount`: `number`  
        Total number of kernel specs in the kernel spec list.  
        - `kernelInterpreterCount`: `number`  
        Total number of interpreters in the kernel spec list.  
        - `kernelLiveCount`: `number`  
        Total number of live kernels in the kernel spec list.  


* DS_INTERNAL.SWITCH_TO_EXISTING_KERNEL  (Telemetry.SwitchToExistingKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR language. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `language`: `string`  


* DS_INTERNAL.SWITCH_TO_INTERPRETER_AS_KERNEL  (Telemetry.SwitchToInterpreterAsKernel)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* DS_INTERNAL.VARIABLE_EXPLORER_FETCH_TIME  (Telemetry.VariableExplorerFetchTime)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  


* DS_INTERNAL.VARIABLE_EXPLORER_VARIABLE_COUNT  (Telemetry.VariableExplorerVariableCount)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Measures not documented in GDPR variableCount</span>  
    - Measures:  
        - `variableCount`: `number`  


* DS_INTERNAL.VSCNOTEBOOK_CELL_TRANSLATION_FAILED  (Telemetry.VSCNotebookCellTranslationFailed)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `isErrorOutput`: `boolean`  


* DS_INTERNAL.WAIT_FOR_IDLE_JUPYTER  (Telemetry.WaitForIdleJupyter)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Duration of a measure in milliseconds.  
        Common measurement used across a number of events.  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken. Duration of a measure in milliseconds. Common measurement used across a number of events.  


* DS_INTERNAL.WEB_FETCH_ERROR  (Telemetry.FetchError)  
      Owner: [@unknown](https://github.com/unknown)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR currentTask. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Event sent when trying to talk to a remote server and the browser gives us a generic fetch error  
    ```

    - Properties:  
        - `currentTask`: `'connecting'`  
        What we were doing when the fetch error occurred  


* DS_INTERNAL.WEBVIEW_STARTUP  (Telemetry.WebviewStartup)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR type. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `type`: `string`  


* DS_INTERNAL.ZMQ_NATIVE_BINARIES_LOADING  (Telemetry.ZMQSupported)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when the ZMQ native binaries do work.  
    ```



* DS_INTERNAL.ZMQ_NATIVE_BINARIES_NOT_LOADING  (Telemetry.ZMQNotSupported)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent when the ZMQ native binaries do not work.  
    ```



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

    - Properties:  
        - `hasCustomEnvPath`: `boolean`  
        If there's a custom path specified in the python.envFile workspace settings.  


* ERROR  (ERROR)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `failureCategory`: `'methodException'`  
        - `failureSubCategory`: `string`  
        Name of the method in the extension that threw the exception.  
        - `failed`: `true`  
        Whether there was a failure.  
        - `stackTrace`: `string`  
        Node stacktrace without PII.  
        - `failureCategory`?: `string`  
        A reason that we generate (e.g. kerneldied, noipykernel, etc), more like a category of the error.  
        - `failureSubCategory`?: `string`  
        Further sub classification of the error. E.g. kernel died due to the fact that zmq is not installed properly.  
        Name of the method in the extension that threw the exception.  
        - `pythonErrorFile`?: `string`  
        Hash of the file name that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorFolder`?: `string`  
        Hash of the folder that contains the file in the last frame (from Python stack trace).  
        - `pythonErrorPackage`?: `string`  
        Hash of the module that contains the file in the last frame (from Python stack trace).  


* EXTENSION.LOAD  (EventName.EXTENSION_LOAD)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    ```
    Telemetry event sent with perf measures related to activation and loading of extension.  
    ```

    - Measures:  
        - `workspaceFolderCount`: `number`  
        Number of workspace folders opened  
        - `totalActivateTime`: `number`  
        Time taken to activate the extension.  
        - `codeLoadingTime`: `number`  
        Time taken to load the code.  
        - `startActivateTime`: `number`  
        Time when activation started.  
        - `endActivateTime`: `number`  
        Time when activation completed.  


* HASHED_PACKAGE_NAME  (EventName.HASHED_PACKAGE_NAME)  
      Owner: [@unknown](https://github.com/unknown)  
    ```
    Telemetry event sent with hash of an imported python package.  
    Used to detect the popularity of a package, that would help determine which packages  
    need to be prioritized when resolving issues with intellisense or supporting similar issues related to a (known) specific package.  
    ```

    - Properties:  
        - `hashedNamev2`: `string`  
        Hash of the package name  


* HASHED_PACKAGE_PERF  (EventName.HASHED_PACKAGE_PERF)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Measures:  
        - `duration`: `number`  
        Total time taken to list interpreters. Total time taken to list kernels. Time taken.  


* JUPYTER_EXPERIMENTS_OPT_IN_OUT  (EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT)  
      Owner: [@unknown](https://github.com/unknown)  
    ```
    Telemetry event sent with details when a user has requested to opt it or out of an experiment group  
    ```

    - Properties:  
        - `expNameOptedInto`?: `string`  
        Carries the name of the experiment user has been opted into manually  
        - `expNameOptedOutOf`?: `string`  
        Carries the name of the experiment user has been opted out of manually  


* JUPYTER_IS_INSTALLED  (Telemetry.JupyterInstalled)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - `/* Detection of jupyter failed`:  
        - Properties:  
            - `failed`: `true`  
            - `reason`: `'notInstalled'`  
            - `frontEnd`: `<see below>`  
            Possible values include:  
                - `'notebook'`  
                - `'lab'`  
    - `Jupyter was successfully detected`:  
        - Properties:  
            - `detection`: `'process'`  
            Jupyter is in current path of process owned by VS Code.  
            I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].  
            - `frontEnd`: `<see below>`  
            Possible values include:  
                - `'notebook'`  
                - `'lab'`  
        - Measures:  
            - `frontEndVersion`: `number`  
            Version of the form 6.11, 4.8  


* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
    ```
    Telemetry event sent when user opens the data viewer.  
    ```



* OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS_EX  (EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS)  
      Owner: [@IanMatthewHuff](https://github.com/IanMatthewHuff)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  


* PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES  (EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
    - Properties:  
        - `hasEnvVars`?: `boolean`  
        Carries `true` if environment variables are present, `false` otherwise  
        - `failed`?: `boolean`  
        Carries `true` if fetching environment variables failed, `false` otherwise  
        - `activatedInTerminal`?: `boolean`  
        Whether the environment was activated within a terminal or not.  
        - `activatedByWrapper`?: `boolean`  
        Whether the environment was activated by the wrapper class.  
        If `true`, this telemetry is sent by the class that wraps the two activation providers   .  


* TERMINAL_ENV_VAR_EXTRACTION  (Telemetry.TerminalEnvVariableExtraction)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR reason. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    ```
    Telemetry sent only when we fail to extract the env variables for a shell.  
    ```

    - Properties:  
        - `failed`: `true`  
        - `reason`: `<see below>`  
        Possible values include:  
            - `unknownOs`  
            - `getWorkspace`  
            - `terminalCreation`  
            - `fileCreation`  
            - `commandExecution`  
            - `waitForCommand`  
            - `parseOutput`  


* TERMINAL_SHELL_IDENTIFICATION  (Telemetry.TerminalShellIdentification)  
      Owner: [@donjayamanne](https://github.com/donjayamanne)  
       <span style="color:red">Feature not defined.</span>  
       <span style="color:red">Source not defined (whether its a user action or 'N/A').</span>  
       <span style="color:red">Properties not documented in GDPR reason, terminalProvided, shellIdentificationSource, hasCustomShell, hasShellInEnv. Add jsDoc comments for the properties in telemetry.ts file.</span>  
    - Properties:  
        - `failed`: `boolean`  
        - `reason`: `<see below>`  
        Possible values include:  
            - `'unknownShell'`  
            - `null or <empty>`  
        - `terminalProvided`: `boolean`  
        - `shellIdentificationSource`: `<see below>`  
        Possible values include:  
            - `'terminalName'`  
            - `'settings'`  
            - `'environment'`  
            - `'default'`  
            - `'vscode'`  
        - `hasCustomShell`: `<see below>`  
        Possible values include:  
            - `null or <empty>`  
            - `true`  
            - `false`  
        - `hasShellInEnv`: `<see below>`  
        Possible values include:  
            - `null or <empty>`  
            - `true`  
            - `false`  


