# Changelog

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