# Changelog

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
