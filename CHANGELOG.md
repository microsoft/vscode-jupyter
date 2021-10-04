# Changelog

## 2021.9.100 (6 October 2021)

### Enhancements

1. Split Notebook renderers into a separate extension ([Jupyter Notebook Renderers](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter-renderers)), allowing users to view Notebook outputs such as plotly, vega on [github.dev](https://github.dev).
   ([#1909](https://github.com/Microsoft/vscode-jupyter/issues/1909))
1. Added support to use Run by Line and Notebook Debugging in remote kernels.
   ([#7576](https://github.com/Microsoft/vscode-jupyter/issues/7576))
1. Added ability to create notebooks using the menu option `File -> New File...`.
   ([#7363](https://github.com/Microsoft/vscode-jupyter/issues/7363))
1. Added a command to the command palette and an icon to the notebook toolbar to open the the table of contents for Notebooks.
   ([#7305](https://github.com/microsoft/vscode-jupyter/issues/7305))

### Fixes

1. Strip CR from CRLF of source when sending code to the kernel for execution.
   ([#4576](https://github.com/Microsoft/vscode-jupyter/issues/4576))
1. Show global Python kernel specs that use ipykernel to launch.
   ([#6389](https://github.com/Microsoft/vscode-jupyter/issues/6389))
1. Fixes related to remote connections in `Interactive Window`.
   ([#6881](https://github.com/Microsoft/vscode-jupyter/issues/6881))
1. Fixes to restarting of kernels when kernel dies (as opposed to manually restarting a kernel).
   ([#7167](https://github.com/Microsoft/vscode-jupyter/issues/7167))
1. Code cell submissions should go to active window in 'multiple' mode.
   ([#7249](https://github.com/Microsoft/vscode-jupyter/issues/7249))
1. Interrupt kernel button on interactive window toolbar should be disabled when kernel is not busy.
   ([#7269](https://github.com/Microsoft/vscode-jupyter/issues/7269))
1. Fix 'Connecting to...' message in interactive window not being updated in-place if a code cell is inserted before the connection completes.
   ([#7280](https://github.com/Microsoft/vscode-jupyter/issues/7280))
1. Fix changing kernel in interactive windows started with an interpreter that does not have ipykernel installed.
   ([#7288](https://github.com/Microsoft/vscode-jupyter/issues/7288))
1. Preserve leading tab characters on code lines for #%% cells submitted to interactive window.
   ([#7303](https://github.com/Microsoft/vscode-jupyter/issues/7303))
1. Display error message from Python stack trace when kernel dies (also if kernel dies when attempting to restart).
   ([#7318](https://github.com/Microsoft/vscode-jupyter/issues/7318))
1. Don't add an extra linefeed in interactive window markdown.
   ([#7355](https://github.com/Microsoft/vscode-jupyter/issues/7355))
1. Fix Debug Cell codelens opening the wrong source file after restarting the kernel in the interactive window.
   ([#7366](https://github.com/Microsoft/vscode-jupyter/issues/7366))
1. Refresh list of remote kernels if a notebook is already open.
   ([#7385](https://github.com/Microsoft/vscode-jupyter/issues/7385))
1. Fix allowing the dataframe viewer to open large data frames. Also fix variable fetching code from updating the execution count.
   ([#7420](https://github.com/Microsoft/vscode-jupyter/issues/7420))
1. Apply background to the image element in a notebook output, instead of applying it to the entire output container.
   ([#7470](https://github.com/Microsoft/vscode-jupyter/issues/7470))
1. Support retina output option for Matplotlib.
   ([#7471](https://github.com/Microsoft/vscode-jupyter/issues/7471))
1. Clicking 'Change Kernel' for interactive window started from script file when ipykernel is not installed should display the kernel picker.
   ([#7476](https://github.com/Microsoft/vscode-jupyter/issues/7476))
1. Fix `jupyter.magicCommandsAsComments` when executing code cells in the interactive window.
   ([#7481](https://github.com/Microsoft/vscode-jupyter/issues/7481))
1. `jupyter.interactive.removeCell` now supports being invoked from the command palette or with a custom keybinding when an interactive window has focus.
   ([#7541](https://github.com/Microsoft/vscode-jupyter/issues/7541))
1. Fix the context keys for the variable explorer when working with the interactive window.
   ([#7556](https://github.com/Microsoft/vscode-jupyter/issues/7556))
1. Ensure empty #%% cells are skipped and do not interfere with running of subsequent cells in the interactive window.
   ([#7581](https://github.com/Microsoft/vscode-jupyter/issues/7581))
1. Fix interactive window debugging sourcemap resolution after running a markdown cell.
   ([#7589](https://github.com/Microsoft/vscode-jupyter/issues/7589))
1. Support a highlight around a cell when goto cell is clicked in the interactive window.
   ([#7648](https://github.com/Microsoft/vscode-jupyter/issues/7648))
1. Support multiline comments in the middle of a cell being submitted to the interactive window.
   ([#7658](https://github.com/Microsoft/vscode-jupyter/issues/7658))

### Code Health

1. Basic test for plotviewer metadata and SVG setting.
   ([#7209](https://github.com/Microsoft/vscode-jupyter/issues/7209))
1. Fix failing variable view tests.
   ([#7443](https://github.com/Microsoft/vscode-jupyter/issues/7443))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)


## 2021.8.203 (1 September 2021)

### Enhancements

1. Updated the preview to debugging in native notebooks. Set the `jupyter.experimental.debugging` setting to true, and a `Debug Cell` option will appear on the dropdown in the `Execute Cell` button. Pressing it will run the cell and hit any breakpoints you've set.
   ([#1652](https://github.com/Microsoft/vscode-jupyter/issues/1652))
1. Added the `Run by Line` feature. In Python notebooks, press `F10` while selecting a cell or click the first button on the cell toolbar to start a lightweight debugging session and run the cell line by line. To set it up, follow the steps [here](https://github.com/microsoft/vscode-jupyter/wiki/Setting-Up-Run-by-Line-and-Debugging-for-Notebooks).
   ([#5607](https://github.com/Microsoft/vscode-jupyter/issues/5607))
1. Add diskpath to logging for loading third party widgets to support local testing of new widget versions.
   ([#6294](https://github.com/Microsoft/vscode-jupyter/issues/6294))
1. Default plot output to just PNG, and support showing PNGs or SVGs in the Plot Viewer control. The enablePlotViewer setting still turns on both PNG and SVG plot output, but it's now off by default, not on.
   ([#6913](https://github.com/Microsoft/vscode-jupyter/issues/6913))
1. Update Simplified Chinese translation. (thanks [FiftysixTimes7](https://github.com/FiftysixTimes7))
   ([#7049](https://github.com/Microsoft/vscode-jupyter/issues/7049))

### Fixes

1. Run by line now stops after running the last line.
   ([#6858](https://github.com/Microsoft/vscode-jupyter/issues/6858))
1. Ensure execution of `raw` cells are skipped when we have multiple cells.
   ([#6954](https://github.com/Microsoft/vscode-jupyter/issues/6954))
1. Fixes to autocompletions returned by Jupyter Kernel (sort as returned by the kernel and trigger when entering quotes).
   ([#6979](https://github.com/Microsoft/vscode-jupyter/issues/6979))
1. Populate the interactive window variable explorer when focus is in the #%% Python file.
   ([#6993](https://github.com/Microsoft/vscode-jupyter/issues/6993))
1. Reinitialize kernels after a restart, including resetting current working directory and rerunning startup commands.
   ([#7016](https://github.com/Microsoft/vscode-jupyter/issues/7016))
1. Restore support for `jupyter.collapseCellInputCodeByDefault` in native interactive window.
   ([#7031](https://github.com/Microsoft/vscode-jupyter/issues/7031))
1. Fix restart kernel in native interactive window when executing a #%% cell.
   ([#7081](https://github.com/Microsoft/vscode-jupyter/issues/7081))
1. Fix code indentation being lost on interactive window export.
   ([#7088](https://github.com/Microsoft/vscode-jupyter/issues/7088))
1. Ensure variable explorer handles kernel restarts.
   ([#7126](https://github.com/Microsoft/vscode-jupyter/issues/7126))
1. Add remappable `esc` keybinding to clear contents of native interactive window input box, bound to `interactive.input.clear` command in VS Code core.
   ([#7157](https://github.com/Microsoft/vscode-jupyter/issues/7157))
1. Fix ability to use command palette restart/interrupt from command palette when focus is in a Python file linked to an interactive window.
   ([#7158](https://github.com/Microsoft/vscode-jupyter/issues/7158))
1. Fix A/B shortcuts to insert cell in command mode instead of edit mode. All Jupyter keyboard shortcuts are now provided through the Jupyter keymap extension, which is included with the Jupyter extension and can be uninstalled.
   ([#7172](https://github.com/Microsoft/vscode-jupyter/issues/7172))
1. Fixes kernel spec generation (on Mac M1/Non ZMQ supported machines) to include the appropriate environment.
   ([#7186](https://github.com/Microsoft/vscode-jupyter/issues/7186))
1. Support kernelspec argv containing non traditional args for `{connection_file}`.
   ([#7203](https://github.com/Microsoft/vscode-jupyter/issues/7203))
1. Fix export for already-open native notebooks.
   ([#7233](https://github.com/Microsoft/vscode-jupyter/issues/7233))
1. Fix being able to save PNG plots from the plot viewer.
   ([#7265](https://github.com/Microsoft/vscode-jupyter/issues/7265))
1. When no notebook or interactive window is active then clear the variables view.
   ([#7266](https://github.com/Microsoft/vscode-jupyter/issues/7266))
1. Fix placeholder 'Connecting to...' sys info cell not being overwritten after a kernel connection is established if cells are added to the interactive window first.
   ([#7280](https://github.com/Microsoft/vscode-jupyter/issues/7280))
1. Ensure that interactive window is started with active Python interpreter after active interpreter is changed.
   ([#7301](https://github.com/Microsoft/vscode-jupyter/issues/7301))
1. Restore support for Bash Kernel.
   ([#7345](https://github.com/microsoft/vscode-jupyter/issues/7345))

### Code Health

1. Remove old Interactive Window, old Notebook Editor and LiveShare code (all of this functionality is now Natively supported by VS Code).
   ([#6488](https://github.com/Microsoft/vscode-jupyter/issues/6488))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)


## 2021.8.11 (3 August 2021)

### Enhancements

1. Updated the preview to run by line in native notebooks. Set the `jupyter.experimental.debugging` setting to true, install ipykernel 6 on your selected kernel and a `Run by Line` button will appear on cell toolbars. Pressing it will start a lightweight debugging session and let you run the cell line by line.
   ([#5607](https://github.com/microsoft/vscode-jupyter/issues/5607))

### Fixes

1. Restore plotviewer in Native Notebooks.
   ([#6315](https://github.com/Microsoft/vscode-jupyter/issues/6315))
1. Fix debugging in `Interactive Window` when using `IPyKernel 6`.
   ([#6534](https://github.com/Microsoft/vscode-jupyter/issues/6534))
1. Add a placeholder `Python 3` kernel if user doesn't have any Python interpreters, with ability to notify user to install Python extenssion or Python runtime.
   ([#5864](https://github.com/Microsoft/vscode-jupyter/issues/5864))
1. Fixes to completion items received from Jupyter.
   ([#5956](https://github.com/Microsoft/vscode-jupyter/issues/5956))
1. Run all and restarting does not actually interrupt the rest of the running cells.
   ([#5996](https://github.com/Microsoft/vscode-jupyter/issues/5996))
1. Remove popup tip that indicates to users the kernel picker is in the bottom right.
   ([#6016](https://github.com/Microsoft/vscode-jupyter/issues/6016))
1. Ensure Pyspark kernels are listed.
   ([#6316](https://github.com/Microsoft/vscode-jupyter/issues/6316))
1. Fix problem where the active interpreter is not being used for the interactive window when not running with raw kernel.
   ([#6409](https://github.com/Microsoft/vscode-jupyter/issues/6409))
1. `Ctrl+Enter` in native notebooks should put cell into command mode immediately, then run the cell.
   ([#6582](https://github.com/Microsoft/vscode-jupyter/issues/6582))
1. List non-traditional (not using `ipykernel`) global Python kernelspecs.
   ([#6622](https://github.com/Microsoft/vscode-jupyter/issues/6622))
1. Clone the Notebook metadata before udpating it.
   ([#6624](https://github.com/Microsoft/vscode-jupyter/issues/6624))
1. Format the readme to render correctly on the VS Code extensions side bar. Thanks [jyooru](https://github.com/jyooru)!
   ([#6648](https://github.com/Microsoft/vscode-jupyter/issues/6648))
1. Ensure we get Jupyter Server info correctly in Python 3.6.
   ([#6738](https://github.com/Microsoft/vscode-jupyter/issues/6738))
1. List kernels in situations where extension is installed after opening a notebook.
   ([#6824](https://github.com/Microsoft/vscode-jupyter/issues/6824))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)

### Code Health


## 2021.8.1 (19 July 2021)

### Fixes

1. Fix for kernel not starting with correct path (causes DLL load and import modules failures).
   ([#5833](https://github.com/Microsoft/vscode-jupyter/issues/5833))

## 2021.8.0 (8 July 2021)

### Enhancements

1. In preview native notebooks UI, contribute `L` keybinding to toggle line numbers for the current cell, and `shift+L` keybinding to toggle line numbers for all cells.
   ([#4438](https://github.com/Microsoft/vscode-jupyter/issues/4438))
1. Add xarray arrays to Data Viewer.
   ([#5590](https://github.com/Microsoft/vscode-jupyter/issues/5590))
1. When editing a markdown cell in preview native notebooks UI, contribute `ctrl+enter` keybinding to render current markdown cell, and `shift+enter` to render current markdown cell and skip to the next cell.
   ([#5976](https://github.com/Microsoft/vscode-jupyter/issues/5976))
1. Contribute extension-level `shift+enter` keybinding to execute current code cell and select below in preview native notebooks UI.
   ([#6037](https://github.com/Microsoft/vscode-jupyter/issues/6037))
1. Added ability to save plots in the preview native notebooks UI.
   ([#6183](https://github.com/Microsoft/vscode-jupyter/issues/6183))
1. Added a preview to run by line and debugging in native notebooks. Set the `jupyter.experimental.debugging` setting to true, install ipykernel 6 on your selected kernel and a `debug` button will appear. Pressing it will start a debugging session and let you set and hit breakpoints.
   ([#5607](https://github.com/microsoft/vscode-jupyter/issues/5607))
1. Add `jupyter.enableNativeInteractiveWindow` setting to opt into the preview native interactive window experience, with support for VS Code customizations like keybindings, themes, snippets and more.([#1388](https://github.com/microsoft/vscode-jupyter/issues/1388))

### Fixes

1. Fix problems loading other language kernels in the Interactive Window and in non insiders webviews.
   ([#893](https://github.com/Microsoft/vscode-jupyter/issues/893))
1. Only ask user to switch to `"perFile"` mode if `"jupyter.interactiveWindowMode": "multiple"` and they have submitted code from two different source files.
   ([#5471](https://github.com/Microsoft/vscode-jupyter/issues/5471))
1. On remote connections check for new or removed LiveKernelConnections on document open.
   ([#5984](https://github.com/Microsoft/vscode-jupyter/issues/5984))
1. In preview native notebooks interface, show editor title buttons only when "notebook.globalToolbar" setting is set to `false`.
   ([#6019](https://github.com/Microsoft/vscode-jupyter/issues/6019))
1. Ship require.js with our notebook preloads and renderers.
   ([#6034](https://github.com/Microsoft/vscode-jupyter/issues/6034))
1. Save output in *.ipynb even when output is created without any Jupyter output metadata.
   ([#6192](https://github.com/Microsoft/vscode-jupyter/issues/6192))
1. In preview native notebooks interface, contribute `ctrl+enter` keybinding which puts the current cell into control mode instead of leaving it in edit mode after running.
   ([#6198](https://github.com/Microsoft/vscode-jupyter/issues/6198))
1. Fix interrupt button in Native Notebook toolbar.
   ([#6254](https://github.com/Microsoft/vscode-jupyter/issues/6254))
1. Fix problem where the active interpreter is not being used for the interactive window when not running with raw kernel.
   ([#6409](https://github.com/Microsoft/vscode-jupyter/issues/6409))

### Code Health

1. Add doc switching variable view tests for native notebooks.
   ([#4355](https://github.com/Microsoft/vscode-jupyter/issues/4355))
1. Fix 'Restarting kernel will cancel cell execution & we can re-run a cell' test.
   ([#6139](https://github.com/Microsoft/vscode-jupyter/issues/6139))
1. Restore GitHub token access for CodeQL, issue locking and issue assignment workflows.
   ([#6170](https://github.com/Microsoft/vscode-jupyter/issues/6170))
1. Fix flake notebookAndWebview test.
   ([#6234](https://github.com/Microsoft/vscode-jupyter/issues/6234))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)

## 2021.6.999 (16 June 2021)

### Fixes

1. On remote connections check for new or removed LiveKernelConnections on document open.
   ([#5984](https://github.com/Microsoft/vscode-jupyter/issues/5984))
1. When editing a markdown cell in preview native notebooks UI, contribute `ctrl+enter` keybinding to render current markdown cell, and `shift+enter` to render current markdown cell and skip to the next cell.
   ([#5976](https://github.com/Microsoft/vscode-jupyter/issues/5976))
1. In preview native notebooks UI, contribute `L` keybinding to toggle line numbers for the current cell, and `shift+L` keybinding to toggle line numbers for all cells.
   ([#4438](https://github.com/Microsoft/vscode-jupyter/issues/4438))
1. Contribute extension-level `shift+enter` keybinding to execute current code cell and select below in preview native notebooks UI.
   ([#6037](https://github.com/Microsoft/vscode-jupyter/issues/6037))
1. In preview native notebooks interface, contribute `ctrl+enter` keybinding which puts the current cell into control mode instead of leaving it in edit mode after running.
   ([#6198](https://github.com/Microsoft/vscode-jupyter/issues/6198))
1. Fix interrupt button in Native Notebook toolbar.
   ([#6254](https://github.com/Microsoft/vscode-jupyter/issues/6254))

### Code Health

1. Fix 'Restarting kernel will cancel cell execution & we can re-run a cell' test.
   ([#6139](https://github.com/Microsoft/vscode-jupyter/issues/6139))

## 2021.6.99 (8 June 2021)

### Enhancements

1. Data Viewer Filter Rows must use explicit wildcards to search for substrings in string filters. For example, filtering by "stable" will not show the value "unstable" anymore, but filtering by "*stable" will show "stable" and "unstable".
   ([#1142](https://github.com/Microsoft/vscode-jupyter/issues/1142))
1. Sort variables by name and type in variable explorer.
   ([#4585](https://github.com/Microsoft/vscode-jupyter/issues/4585))
1. Limit languages dispalyed in the Cell language picker to languages supported by the kernel.
   ([#5580](https://github.com/Microsoft/vscode-jupyter/issues/5580))
1. Move native notebooks cell toolbar to the left by default.
   ([#5605](https://github.com/Microsoft/vscode-jupyter/issues/5605))
1. Display modal dialog box (so users don't miss this) when IPyKernel (or Jupyter) is missing (required to run Python in Interactive Window or Notebooks).
   ([#5798](https://github.com/Microsoft/vscode-jupyter/issues/5798))
1. Add support for [Virtual Workspaces](https://github.com/microsoft/vscode/wiki/Virtual-Workspaces).
   ([#5803](https://github.com/Microsoft/vscode-jupyter/issues/5803))
1. Losslessly compressed PNG images to save ~20KB.
   (thanks [Christopher Yeh](https://github.com/chrisyeh96))
   ([#5869](https://github.com/Microsoft/vscode-jupyter/issues/5869))
1. Adopt `notebook/toolbar` contribution point for native notebooks.
   ([#5954](https://github.com/Microsoft/vscode-jupyter/issues/5954))
1. Tweak variable view fit and finish to match VS Code.
   ([#5955](https://github.com/Microsoft/vscode-jupyter/issues/5955))
1. Replace 'Run cells above' and 'Run cell and below' commands and cell toolbar buttons with VS Code's built-in 'Execute Above Cells' and 'Execute Cell And Below' commands and unified run button.
   ([#6025](https://github.com/microsoft/vscode-jupyter/issues/6025))

### Fixes

1. Update/reinstall if module such as `IPyKernel` was installed once before or already exists.
   ([#4758](https://github.com/Microsoft/vscode-jupyter/issues/4758))
1. Stop listing default kernelspecs in kernel picker.
   ([#5445](https://github.com/Microsoft/vscode-jupyter/issues/5445))
1. Store interpreter information in notebook metadata instead of the generated kernelspec name.
   ([#5612](https://github.com/Microsoft/vscode-jupyter/issues/5612))
1. Restore the `Run Above/Below` cells command in `Command Palette`.
   ([#5746](https://github.com/Microsoft/vscode-jupyter/issues/5746))
1. Migrate 'workbench.editorAssociations' setting to new format.
   ([#5806](https://github.com/Microsoft/vscode-jupyter/issues/5806))
1. Add ABCMeta and type to variable explorer exclude list.
   ([#5865](https://github.com/Microsoft/vscode-jupyter/issues/5865))
1. Blank Python notebooks do not use active interpreter.
   ([#5874](https://github.com/Microsoft/vscode-jupyter/issues/5874))
1. Change language of cell to reflect langauges supported by the selected Kernel.
   ([#5924](https://github.com/Microsoft/vscode-jupyter/issues/5924))
1. Resolve issue related to `Interrupt` button vanishing when tabbing across notebooks while a cell is being executed.
   ([#5925](https://github.com/Microsoft/vscode-jupyter/issues/5925))
1. Delete encrypted storage in a try catch to avoid errors.
   ([#5934](https://github.com/Microsoft/vscode-jupyter/issues/5934))
1. Support new renderer API in Jupyter.
   ([#5952](https://github.com/Microsoft/vscode-jupyter/issues/5952))
1. Hide kernels belonging to deleted Python environments from kernel picker.
   ([#6164](https://github.com/Microsoft/vscode-jupyter/issues/6164))

### Code Health

1. Error category for unsupported kernelspec file args.
   ([#5492](https://github.com/Microsoft/vscode-jupyter/issues/5492))
1. Fix basic execution issues with nonConda 'remote' and nonConda 'local' test suites.
   ([#5660](https://github.com/Microsoft/vscode-jupyter/issues/5660))
1. Update to new message API for native notebook preloads.
   ([#5753](https://github.com/Microsoft/vscode-jupyter/issues/5753))
1. Rename of onDidChangeCellExecutionState.
   ([#5809](https://github.com/Microsoft/vscode-jupyter/issues/5809))
1. Fix functional ipywidget tests.
   ([#5842](https://github.com/Microsoft/vscode-jupyter/issues/5842))
1. When using remote Jupyter connections pre-fetch kernels only when opening a notebook.
   ([#5846](https://github.com/Microsoft/vscode-jupyter/issues/5846))
1. Removed execution isolation script.
   ([#5931](https://github.com/Microsoft/vscode-jupyter/issues/5931))
1. VSCode API naming changes for NotebookCellExecution, NotebookRendererScript.
   ([#6014](https://github.com/Microsoft/vscode-jupyter/issues/6014))
1. API Changes viewType => notebookType and notebook namespace to notebooks.
   ([#6046](https://github.com/microsoft/vscode-jupyter/issues/6046))
1. Update test init code to use window and not notebook for editor properties.
   ([#6098](https://github.com/Microsoft/vscode-jupyter/issues/6098))
1. Support the new renderer API in jupyter extension.
   ([#6118](https://github.com/Microsoft/vscode-jupyter/issues/6118))
1. Update to new notebookcontroller selection function name.
   ([#6121](https://github.com/Microsoft/vscode-jupyter/issues/6121))
1. Inline execution handler change to notebook API.
   ([#6137](https://github.com/Microsoft/vscode-jupyter/issues/6137))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)

## 2021.6.0 (05 May 2021)

### Enhancements

1. Manage contributed Jupyter kernels registration.
   ([#4490](https://github.com/Microsoft/vscode-jupyter/issues/4490))
1. Update variable explorer icon.
   ([#5355](https://github.com/Microsoft/vscode-jupyter/issues/5355))
1. Add keybind 'O' to toggle the output of all selected cells in a notebook.
   ([#5425](https://github.com/Microsoft/vscode-jupyter/issues/5425))
1. Recommend extensions when opening notebooks targeting specific languages.
   ([#5577](https://github.com/Microsoft/vscode-jupyter/issues/5577))

### Fixes

1. Restore the Intellisense documentation on custom editor notebook.
   ([#5124](https://github.com/Microsoft/vscode-jupyter/issues/5124))
1. Upgrade vega-transforms and support vegalite v4.
   ([#5149](https://github.com/Microsoft/vscode-jupyter/issues/5149))
1. Add a 10 minute delay to surveys.
   ([#5261](https://github.com/Microsoft/vscode-jupyter/issues/5261))
1. Display formatted markdown description for `jupyter.variableQueries` setting in settings UI.
   ([#5289](https://github.com/Microsoft/vscode-jupyter/issues/5289))
1. Pass remote Jupyter server's default kernelspec name in remote kernel connection.
   ([#5290](https://github.com/Microsoft/vscode-jupyter/issues/5290))
1. Ensure data viewer grid is resized when slice panel is toggled so that horizontal scrollbar remains visible.
   ([#5309](https://github.com/Microsoft/vscode-jupyter/issues/5309))
1. When 3rd party CDN downloads need to be enabled for ipywidgets support, display More Info and Enable Downloads buttons instead of embedding them as links in the message.
   ([#5352](https://github.com/Microsoft/vscode-jupyter/issues/5352))
1. Fix the output link in the kernel timeout message.
   ([#5360](https://github.com/Microsoft/vscode-jupyter/issues/5360))
1. Stop asking users to install ipykernel on autostart, only do it when a cell is run.
   ([#5368](https://github.com/Microsoft/vscode-jupyter/issues/5368))
1. Fix for 'Export as Python Script' option not appearing.
   ([#5403](https://github.com/Microsoft/vscode-jupyter/issues/5403))
1. Update to remove usage of .cells property from NotebookDocument. Also update TextDocument with notebook property and QuickPick.
   ([#5417](https://github.com/Microsoft/vscode-jupyter/issues/5417))
1. Delete extension context secrets if we get an error when getting them.
   Small fixes on error handling.
   ([#5419](https://github.com/Microsoft/vscode-jupyter/issues/5419))
1. When native notebook is untrusted, do not allow cell execution and prompt to trust.
   ([#5436](https://github.com/Microsoft/vscode-jupyter/issues/5436))
1. Resize the untrusted icon.
   ([#5437](https://github.com/Microsoft/vscode-jupyter/issues/5437))
1. Save notebook metadata in ipynb even if the selected Kernel is provided by some other extension.
   ([#5460](https://github.com/Microsoft/vscode-jupyter/issues/5460))
1. Invalidate cached interpreters when Python extension active interpreter changes.
   ([#5470](https://github.com/Microsoft/vscode-jupyter/issues/5470))
1. Use interpreter information stored in kernelspec.json file when starting kernels.
   ([#5495](https://github.com/Microsoft/vscode-jupyter/issues/5495))
1. Update to new selections API.
   ([#5515](https://github.com/Microsoft/vscode-jupyter/issues/5515))
1. CellStatusBarItem update for Native Notebooks. Along with other breaking API changes.
   ([#5527](https://github.com/Microsoft/vscode-jupyter/issues/5527))
1. Remove statusbar from Notebook Cells.
   ([#5541](https://github.com/Microsoft/vscode-jupyter/issues/5541))
1. Hide Jupyter commands from other types of notebooks.
   ([#5559](https://github.com/Microsoft/vscode-jupyter/issues/5559))
1. Update to newest vscode Notebook API changes.
   ([#5598](https://github.com/Microsoft/vscode-jupyter/issues/5598))
1. Increase the width of the data viewer scrollbar.
   ([#5610](https://github.com/Microsoft/vscode-jupyter/issues/5610))
1. Fix `NameError: name '_VSCODE_InfoImport' is not defined` when attempting to open the data viewer from 2 or more different scopes in a single debug session.
   ([#5627](https://github.com/Microsoft/vscode-jupyter/issues/5627))
1. Use active interpreter when starting Kernels for Interactive Window.
   ([#5628](https://github.com/Microsoft/vscode-jupyter/issues/5628))
1. Use `download` package to download widget scripts.
   ([#5633](https://github.com/Microsoft/vscode-jupyter/issues/5633))
1. Start kernel if not already started when using `Run cells above/below`.
   ([#5636](https://github.com/Microsoft/vscode-jupyter/issues/5636))

### Code Health

1. Add functional test for large data in data viewer.
   ([#5207](https://github.com/Microsoft/vscode-jupyter/issues/5207))
1. Pass `NotebookDocument` when invoking `jupyter.notebookeditor.interruptkernel`.
   ([#5242](https://github.com/Microsoft/vscode-jupyter/issues/5242))
1. Remove data slicing experiment feature gate.
   ([#5399](https://github.com/Microsoft/vscode-jupyter/issues/5399))
1. Ignore errors throw by VS Code when updating cell output during execution.
   ([#5446](https://github.com/Microsoft/vscode-jupyter/issues/5446))
1. Improvements to telemetry used to check if we're not starting the right interpreter (for a Python kernel).
   ([#5509](https://github.com/Microsoft/vscode-jupyter/issues/5509))
1. Add telemetry to check if we fail to update kernelspecs with environment variables.
   ([#5547](https://github.com/Microsoft/vscode-jupyter/issues/5547))
1. Ensure `canvas` and `playwright-chromium` are setup as optional dependencies in `package.json`.
   ([#5567](https://github.com/Microsoft/vscode-jupyter/issues/5567))
1. Fix tests after kernel push changes.
   ([#5585](https://github.com/Microsoft/vscode-jupyter/issues/5585))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
    [nbconvert](https://nbconvert.readthedocs.io/en/latest/)


## 2021.5.1 (12 April 2021)

### Code Health

1. Check the responses of prompts for installation of missing packages such as `IPyKernel`.
   ([#5432](https://github.com/Microsoft/vscode-jupyter/issues/5432))

### Fixes

1. Fix for 'Export as Python Script' option not appearing.
   ([#5403](https://github.com/Microsoft/vscode-jupyter/issues/5403))
1. Delete extension context secrets if we get an error when getting them.
   Small fixes on error handling.
   ([#5419](https://github.com/Microsoft/vscode-jupyter/issues/5419))
1. Enable correct plot background for Native Notebooks.
   ([#5353](https://github.com/Microsoft/vscode-jupyter/issues/5353))
1. Stop asking users to install ipykernel on autostart, only do it when a cell is ran.
   ([#5368](https://github.com/microsoft/vscode-jupyter/issues/5368))
1. Invalidate cached interpreters when Python extension active interpreter changes.
   ([#5470](https://github.com/microsoft/vscode-jupyter/issues/5470))

## 2021.5.0 (31 March 2021)

### Enhancements

1. Be able to provide string argument to jupyter.execSelectionInteractive for extensibility.
   (thanks [Andrew Craig](https://github.com/andycraig/))
   ([#1689](https://github.com/Microsoft/vscode-jupyter/issues/1689))

### Fixes

1. Jupyter variables tab will always be named 'Jupyter Variables'.
   ([#4458](https://github.com/Microsoft/vscode-jupyter/issues/4458))
1. Variable view will stay as long as you have a notebook open (not necessarily active).
   ([#4562](https://github.com/Microsoft/vscode-jupyter/issues/4562))
1. Add quotations to arguments with blank spaces when executing kernel processes.
   ([#4647](https://github.com/Microsoft/vscode-jupyter/issues/4647))
1. Do not prompt to install Python extension when creating a blank notebook.
   ([#4965](https://github.com/Microsoft/vscode-jupyter/issues/4965))
1. Cache the active workspace Python Interpreter.
   ([#5004](https://github.com/Microsoft/vscode-jupyter/issues/5004))
1. Don't prewarm variables for global jupyter interpreter if ZMQ is supported.
   ([#5009](https://github.com/Microsoft/vscode-jupyter/issues/5009))
1. When closing the Interactive Window, shutdown sessions started by Interactive Window.
   ([#5030](https://github.com/Microsoft/vscode-jupyter/issues/5030))
1. Stop wrapping new errors if we threw the original error.
   ([#5089](https://github.com/Microsoft/vscode-jupyter/issues/5089))
1. Ignore errors when getting the environment variables for a Python environment.
   ([#5093](https://github.com/Microsoft/vscode-jupyter/issues/5093))
1. Revert viewsContainter name to Jupyter and view name to Variables to avoid un-named viewsContainer.
   ([#5102](https://github.com/Microsoft/vscode-jupyter/issues/5102))
1. Ensure extensions depending on Jupyter do not fail to load if Jupyter extension fails to load.
   ([#5145](https://github.com/Microsoft/vscode-jupyter/issues/5145))
1. Don't display the data science banner for non-Jupyter notebooks.
   ([#5181](https://github.com/Microsoft/vscode-jupyter/issues/5181))
1. Don't use NotebookEditor.onDidDispose and support new err / out specific stream mime types.
   ([#5191](https://github.com/Microsoft/vscode-jupyter/issues/5191))
1. Prevent unnecessary activation of the Python extension.
   ([#5193](https://github.com/Microsoft/vscode-jupyter/issues/5193))
1. Update widget kernel for new NotebookOutputEventParams.
   ([#5195](https://github.com/Microsoft/vscode-jupyter/issues/5195))
1. Updates to code used to run Python in an isolated manner.
   ([#5212](https://github.com/Microsoft/vscode-jupyter/issues/5212))
1. Changes to proposed API for using resolveKernel instead of resolveNotebook. Since this change goes along with widget tests also renable and fix those tests.
   ([#5217](https://github.com/Microsoft/vscode-jupyter/issues/5217))
1. Fix data viewer display of non-numeric index columns in DataFrames.
   ([#5253](https://github.com/Microsoft/vscode-jupyter/issues/5253))
1. Display messages notifying user to enable support for CDNs when rendering IPyWidgets.
   ([#5074](https://github.com/Microsoft/vscode-jupyter/issues/5074))
1. When reopening a newly created Notebook with a Julia kernel, the cells should be detected as `Julia`.
   ([#5148](https://github.com/Microsoft/vscode-jupyter/issues/5148))
1. Support switching kernels in Native Notebooks when connecting to Jupyter.
   ([#1215](https://github.com/Microsoft/vscode-jupyter/issues/1215))
1. Refactor how Kernels are searched and selected.
   ([#4995](https://github.com/microsoft/vscode-jupyter/pull/4995))
1. Fix run selection/line to work from the active editor
   ([#5287](https://github.com/Microsoft/vscode-jupyter/issues/5287))
1. Update variable view to use the new API for native cell execution notification.
   ([#5316](https://github.com/Microsoft/vscode-jupyter/issues/5316))
1. Ensure users in CodeSpaces do not get prompted to forward Kernel Ports.
   ([#5283](https://github.com/Microsoft/vscode-jupyter/issues/5283))
1. Disable surveys in CodeSpaces.
   ([#5295](https://github.com/Microsoft/vscode-jupyter/issues/5295))
1. Ensure Git diff viewer does not get replaced by Notebook Editor.
   ([#633](https://github.com/Microsoft/vscode-jupyter/issues/633))
   (thanks [Matt Bierner](https://github.com/mjbvz))

### Code Health

1. Ability to queue telemetry until all of the data required is available.
   ([#4956](https://github.com/Microsoft/vscode-jupyter/issues/4956))
1. Fix variables test. We had a new import of sys, which was causing the variable fetching to have to do one extra fetch, pushing it over the limit to require a second chunk fetch.
   ([#5016](https://github.com/Microsoft/vscode-jupyter/issues/5016))
1. Add tests for data viewer slice data functionality.
   ([#5066](https://github.com/Microsoft/vscode-jupyter/issues/5066))
1. Remove setting `jupyter.useNotebookEditor`.
   ([#5130](https://github.com/Microsoft/vscode-jupyter/issues/5130))
1. Enable `debug` logging by default.
   ([#5238](https://github.com/Microsoft/vscode-jupyter/issues/5238))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),


## 2021.3.0 (3 March 2021)

### Enhancements

1. Add ability to view a slice of the current variable in the data viewer using either axis/index dropdowns or a slice expression input field.
   ([#305](https://github.com/Microsoft/vscode-jupyter/issues/305))
1. Enable refreshing active data viewer contents using Jupyter: Refresh Data Viewer command in the command palette, Cmd+R or Ctrl+R, or the refresh button in the editor title menu.
   ([#1143](https://github.com/Microsoft/vscode-jupyter/issues/1143))
1. Always open the data viewer in the last view group that it was moved to.
   ([#4689](https://github.com/Microsoft/vscode-jupyter/issues/4689))
1. Support for other extensions to provide a default language when creating new notebooks.
   ([#4859](https://github.com/Microsoft/vscode-jupyter/issues/4859))

### Fixes

1. Remove special casing to ignore warnings.
   ([#1312](https://github.com/Microsoft/vscode-jupyter/issues/1312))
1. Allow jupyter kernels to not be handled by the jupyter extension.
   ([#4423](https://github.com/Microsoft/vscode-jupyter/issues/4423))
1. Restore the 'Select a Kernel' command on the interactive window.
   ([#4479](https://github.com/Microsoft/vscode-jupyter/issues/4479))
1. Correctly syntax color items in native variable view.
   ([#4499](https://github.com/Microsoft/vscode-jupyter/issues/4499))
1. Don't ask for a kernel restart if the kernel was interrupted in native notebooks.
   ([#4669](https://github.com/Microsoft/vscode-jupyter/issues/4669))
1. Popup a tip when opening a notebook for the first time.
   ([#4775](https://github.com/Microsoft/vscode-jupyter/issues/4775))
1. Ensure we save the contents when closing a (webview based) notebook.
   ([#4779](https://github.com/Microsoft/vscode-jupyter/issues/4779))
1. Stop sending cells executed silently to other extensions.
   ([#4867](https://github.com/Microsoft/vscode-jupyter/issues/4867))
1. Do not prompt to install missing dependencies on GitHub Codespaces.
   ([#4882](https://github.com/Microsoft/vscode-jupyter/issues/4882))

### Code Health

1. Synchronously check if `zmq` is supported.
   ([#4764](https://github.com/Microsoft/vscode-jupyter/issues/4764))
1. Telemetry to track the commands executed using ICommandManager.
   ([#4926](https://github.com/Microsoft/vscode-jupyter/issues/4926))
1. More telemetry to track kernel failure reasons.
   ([#4940](https://github.com/Microsoft/vscode-jupyter/issues/4940))
1. Add telemetry flag to differentiate between stable vs insider builds of the extension.
   ([#4959](https://github.com/Microsoft/vscode-jupyter/issues/4959))
1. Add telemetry to check if we have started the right local Python kernel.
   ([#4999](https://github.com/Microsoft/vscode-jupyter/issues/4999))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),


## 2021.2.1 (28 February 2021)

### Fixes

1. Popup a tip when opening a notebook for the first time.
   ([#4775](https://github.com/Microsoft/vscode-jupyter/issues/4775))
1. Ensure we save the contents when closing a (webview based) notebook.
   ([#4779](https://github.com/Microsoft/vscode-jupyter/issues/4779))
1. Allow kernels to not be handled by the jupyter extension.
   ([#4423](https://github.com/Microsoft/vscode-jupyter/issues/4423)
1. Enable native notebook if sync'd settings is forcing it.
   ([#4845](https://github.com/Microsoft/vscode-jupyter/issues/4845)
1. Fix 'Export as Notebook' not working after opening a notebook on a python file.
   ([#4869](https://github.com/Microsoft/vscode-jupyter/issues/4869)

## 2021.2.0 (17 February 2021)

### Enhancements

1. Support multidimensional data in the data viewer. >2D dimensions are flattened, with the ability to double-click on a truncated cell to view the full value in a horizontally scrollable field.
   ([#298](https://github.com/Microsoft/vscode-jupyter/issues/298))
1. Support NaN, Inf, -Inf in data viewer.
   ([#299](https://github.com/Microsoft/vscode-jupyter/issues/299))
1. Support viewing PyTorch tensors and TensorFlow EagerTensors in variable explorer and data viewer.
   ([#304](https://github.com/Microsoft/vscode-jupyter/issues/304))
1. Show more detailed error messages when the kernel dies or times out.
   ([#1254](https://github.com/Microsoft/vscode-jupyter/issues/1254))
1. Do not invoke requestKernelInfo when the Kernel.info property already contains this information.
   ([#3202](https://github.com/Microsoft/vscode-jupyter/issues/3202))
1. Support rendering of outputs such as Plotly, Altair, Vega, and the like in Native Notebooks.
   ([#3936](https://github.com/Microsoft/vscode-jupyter/issues/3936))
1. Add full Simplified Chinese translation.
   (thanks [FiftysixTimes7](https://github.com/FiftysixTimes7))
   ([#4418](https://github.com/Microsoft/vscode-jupyter/issues/4418))
1. Add a button to the native notebook toolbar to show the variable panel. Disable button when panel is already visible.
   ([#4486](https://github.com/Microsoft/vscode-jupyter/issues/4486))
1. Users on AML Compute will automatically get the new Native Notebook experience.
   ([#4550](https://github.com/Microsoft/vscode-jupyter/issues/4550))
1. Improved Tensor tooltips in Python files which have been run in the interactive window.
   ([#302](https://github.com/Microsoft/vscode-jupyter/issues/302))
1. Minimize number of icons on the notebook toolbar (put the rest in overflow).
   ([#4730](https://github.com/Microsoft/vscode-jupyter/issues/4730))
1. Add survey for the new Notebooks experience experiment.
   ([#4726](https://github.com/microsoft/vscode-jupyter/issues/4726))
1. Don't overwrite the top level VS Code Save and Undo command keybindings.
   ([#4527](https://github.com/Microsoft/vscode-jupyter/issues/4527))

### Fixes

1. Added a progress notification when restarting the kernel.
   ([#1197](https://github.com/Microsoft/vscode-jupyter/issues/1197))
1. Fix error with selecting jupyter server URI when no workspace open.
   ([#4037](https://github.com/Microsoft/vscode-jupyter/issues/4037))
1. Fix Z (and CTRL+Z when using custom editor support) to update data model so that save works.
   ([#4058](https://github.com/Microsoft/vscode-jupyter/issues/4058))
1. Preload font awesome for ipywidgets.
   ([#4095](https://github.com/Microsoft/vscode-jupyter/issues/4095))
1. When comparing to existing running kernel only consider the kernelspec when launched via kernelspec.
   ([#4109](https://github.com/Microsoft/vscode-jupyter/issues/4109))
1. Fix notebook cells running out of order (for VS code insiders notebook editor).
   ([#4136](https://github.com/Microsoft/vscode-jupyter/issues/4136))
1. Support installing ipykernel when necessary in native notebooks.
   ([#4153](https://github.com/Microsoft/vscode-jupyter/issues/4153))
1. `__file__` variable is now set after changing kernel in the interactive window.
   ([#4164](https://github.com/Microsoft/vscode-jupyter/issues/4164))
1. Fix support for IPyWidgets in Interactive Window.
   ([#4203](https://github.com/Microsoft/vscode-jupyter/issues/4203))
1. Fix hover tips on notebooks (and the interactive window).
   ([#4218](https://github.com/Microsoft/vscode-jupyter/issues/4218))
1. Fix problem with creating a blank notebook from the python extension start page.
   ([#4242](https://github.com/Microsoft/vscode-jupyter/issues/4242))
1. Don't suppress whitespace at start of output for native notebooks.
   ([#4254](https://github.com/Microsoft/vscode-jupyter/issues/4254))
1. Clear output of a cell if its executed while empty.
   ([#4286](https://github.com/Microsoft/vscode-jupyter/issues/4286))
1. Wait for datascience code to activate when activating the extension.
   ([#4295](https://github.com/Microsoft/vscode-jupyter/issues/4295))
1. Fix problem when run all cells an exception is thrown, cells can no longer be run.
   ([#4309](https://github.com/Microsoft/vscode-jupyter/issues/4309))
1. Update trust icons.
   ([#4338](https://github.com/Microsoft/vscode-jupyter/issues/4338))
1. Display trusted icon when a notebook is trusted.
   ([#4339](https://github.com/Microsoft/vscode-jupyter/issues/4339))
1. Enable 'Run To Line', 'Run From Line' and 'Run Selection/Line in Interactive Window' on the editor context.
   The 'shift+enter' keybinding still follows the "jupyter.sendSelectionToInteractiveWindow" setting.
   ([#4368](https://github.com/Microsoft/vscode-jupyter/issues/4368))
1. If a kernel refuses to interrupt ask the user if they want to restart instead.
   ([#4369](https://github.com/Microsoft/vscode-jupyter/issues/4369))
1. Refresh variable explorer when docking is changed.
   ([#4485](https://github.com/Microsoft/vscode-jupyter/issues/4485))
1. Correctly handle kernel restarts in native variable viewer.
   ([#4492](https://github.com/Microsoft/vscode-jupyter/issues/4492))
1. All notebook commands should be prefixed with 'Notebook'.
   ([#4494](https://github.com/Microsoft/vscode-jupyter/issues/4494))
1. Don't retain context on variable view. Update view with current execution count when made visible.
   ([#4541](https://github.com/Microsoft/vscode-jupyter/issues/4541))
1. Remove unnecessary files from the VSIX that just take up space.
   ([#4551](https://github.com/Microsoft/vscode-jupyter/issues/4551))
1. Support set_next_input message payload.
   ([#4566](https://github.com/Microsoft/vscode-jupyter/issues/4566))
1. Fix the Variable Explorer height so the horizontal scroll bar is shown.
   ([#4598](https://github.com/Microsoft/vscode-jupyter/issues/4598))
1. Allow viewing class instance variables in the data viewer.
   ([#4606](https://github.com/Microsoft/vscode-jupyter/issues/4606))
1. Update message that recommends the python extension to a warning and mention it gives an enhanced experience.
   ([#4615](https://github.com/Microsoft/vscode-jupyter/issues/4615))
1. Correctly hide old interpreters registered as kernels from the selector.
   ([#4632](https://github.com/Microsoft/vscode-jupyter/issues/4632))
1. Allow installing python extension in codespaces.
   ([#4664](https://github.com/Microsoft/vscode-jupyter/issues/4664))
1. Add notebook codicon for Juypter viewContainer.
   ([#4538](https://github.com/Microsoft/vscode-jupyter/issues/4538))
1. Allow options to show native variable view only when looking at native notebooks.
   ([#4761](https://github.com/Microsoft/vscode-jupyter/issues/4761))
1. Fix CTRL+ENTER and ALT+ENTER to behave as expected for a jupyter notebook.
   ([#4713](https://github.com/Microsoft/vscode-jupyter/issues/4713))
1. If .NET interactive is installed, make sure to use the new notebook editor.
   ([#4771](https://github.com/Microsoft/vscode-jupyter/issues/4771))
1. Only clean up a notebook editor when it's closed, not when the panel is disposed.
   ([#4786](https://github.com/Microsoft/vscode-jupyter/issues/4786))
1. Fixes problem with duplicate jupyter kernels being generated.
   ([#4720](https://github.com/Microsoft/vscode-jupyter/issues/4720))

### Code Health

1. Deprecate src\client\datascience\kernel-launcher\helpers.ts.
   ([#1195](https://github.com/Microsoft/vscode-jupyter/issues/1195))
1. Stop preloading requirejs in ipywidgets for native notebooks.
   ([#4015](https://github.com/Microsoft/vscode-jupyter/issues/4015))
1. Add .vscode tests to test the new variable view.
   ([#4355](https://github.com/Microsoft/vscode-jupyter/issues/4355))
1. Update CI to set xvfb correctly, and new test step that can do native notebooks + old webviews.
   ([#4412](https://github.com/Microsoft/vscode-jupyter/issues/4412))
1. Run cells below test randomly failing on shutdown.
   ([#4445](https://github.com/Microsoft/vscode-jupyter/issues/4445))
1. Fix julia test to pass.
   ([#4453](https://github.com/Microsoft/vscode-jupyter/issues/4453))
1. Add UI side telemetry for variable view.
   ([#4649](https://github.com/Microsoft/vscode-jupyter/issues/4649))
1. Prevent Winston logger from exiting the Extension Host when there are unhandled exceptions.
   ([#4702](https://github.com/Microsoft/vscode-jupyter/issues/4702))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),

## 2020.12.1 (10 December 2020)

### Fixes

1. Fix support for IPyWidgets in Interactive Window.
   ([#4203](https://github.com/Microsoft/vscode-jupyter/issues/4203))

## 2020.12.0 (9 December 2020)

### Enhancements

1. Add support for IPyWidget in Native Notebooks.
   ([#251](https://github.com/Microsoft/vscode-jupyter/issues/251))

### Fixes

1. Information in the interactive window is python specific.
   ([#340](https://github.com/Microsoft/vscode-jupyter/issues/340))
1. Allow user to cancel asking about logging level.
   ([#348](https://github.com/Microsoft/vscode-jupyter/issues/348))
1. Watch for any addition of the python extension, and don't suggest a full reload when it is added.
   ([#405](https://github.com/Microsoft/vscode-jupyter/issues/405))
1. Only offer to export to python script when the metadata specifies python as its language.
   ([#407](https://github.com/Microsoft/vscode-jupyter/issues/407))
1. Hide webview based Notebook command `Select Kernel` when a Notebook is opened using the new VS Code Native Notebook editor.
   ([#426](https://github.com/Microsoft/vscode-jupyter/issues/426))
1. Correctly pass the candidate interpreter when exporting.
   ([#1363](https://github.com/Microsoft/vscode-jupyter/issues/1363))
1. ```__file__``` variable not set after restarting kernel in the interactive window.
   ([#1373](https://github.com/Microsoft/vscode-jupyter/issues/1373))
1. Fix the search path for Jupyter kernels on UNIX systems (thanks [Giulio Girardi](https://github.com/rapgenic/))
   ([#3918](https://github.com/Microsoft/vscode-jupyter/issues/3918))
1. Fix the directory for exporting from the interactive window and notebooks to match the directory where the original file was created.
   ([#3991](https://github.com/Microsoft/vscode-jupyter/issues/3991))
1. Fix variable fetching on remote machines that don't have our scripts files on them.
   ([#4006](https://github.com/Microsoft/vscode-jupyter/issues/4006))
1. Display survey prompt once per session.
   ([#4077](https://github.com/Microsoft/vscode-jupyter/issues/4077))
1. Guard against AttributeErrors in our DataViewer code.
   ([#4082](https://github.com/Microsoft/vscode-jupyter/issues/4082))
1. Ensure user cannot belong to Custom Editor experiment is already in Native Notebook experiment.
   ([#4105](https://github.com/Microsoft/vscode-jupyter/issues/4105))
1. Fix problems with code in UI getting out of sync with code being executed or saved to disk.
   ([#1701](https://github.com/Microsoft/vscode-jupyter/issues/1701))

### Code Health

1. Added an onCreated event to the Interactive Window provider so external buttons can appear on creation.
   ([#413](https://github.com/Microsoft/vscode-jupyter/issues/413))
1. Use notebookIdentity instead of the notebook when handling external buttons. It handles the case when the user doesn't autostart the kernel.
   ([#414](https://github.com/Microsoft/vscode-jupyter/issues/414))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),


## 2020.11.3 (03 December 2020)

### Fixes

1. Display survey prompt once per session.
   ([#4077](https://github.com/Microsoft/vscode-jupyter/issues/4077))

## 2020.11.2 (30 November 2020)

### Fixes

1. When removing our dynamically added editor associations always remove them if Native / Custom Editor is disabled, not just if we remember adding them.
   ([#3988](https://github.com/Microsoft/vscode-jupyter/issues/3988))
1. Ensure survey prompt is not displayed multiple times..
   ([#4002](https://github.com/Microsoft/vscode-jupyter/issues/4002))
1. Migrate references to python.dataScience.\* in when clauses of keybindings.json.
   ([#1088](https://github.com/Microsoft/vscode-jupyter/issues/1088))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),

## 2020.11.1 (19 November 2020)

### Fixes

1. Interactive window input prompt does not allow any keyboard input.
   ([#446](https://github.com/Microsoft/vscode-jupyter/issues/446))
1. Support opening Notebooks using Native Notebook editor even if the Python extension is not installed.
   ([#1074](https://github.com/Microsoft/vscode-jupyter/issues/1074))
1. Show kernel picker in the interactive window.
   ([#411](https://github.com/Microsoft/vscode-jupyter/issues/411))

### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),

## 2020.11.0 (11 November 2020)


### Thanks

Thanks to the following projects which we fully rely on to provide some of
our features:

-   [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
-   [debugpy](https://pypi.org/project/debugpy/)

Also thanks to the various projects we provide integrations with which help
make this extension useful:

-   [Jupyter](https://jupyter.org/):
    [Notebooks](https://jupyter-notebook.readthedocs.io/en/latest/?badge=latest),
    [JupyterHub](https://jupyterhub.readthedocs.io/en/stable/),
    [ipywidgets](https://ipywidgets.readthedocs.io/en/latest/),
