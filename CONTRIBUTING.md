# Contributing to the Jupyter extension for Visual Studio Code

---

| `main` branch |
| ------------- |

## | ![Main Build](https://github.com/microsoft/vscode-jupyter/actions/workflows/build-test.yml/badge.svg?branch=main)

[For contributing to the [Microsoft Python Language Server](https://github.com/Microsoft/python-language-server) see its own repo; for [Pylance](https://github.com/microsoft/pylance-release) see its own repo; for [debugpy](https://github.com/microsoft/debugpy) see its own repo]

## Contributing a pull request

### Prerequisites

1. [Node.js](https://nodejs.org/) 18.15.0
2. [npm](https://www.npmjs.com/) 9.5.0
3. [Python](https://www.python.org/) 3.6 or later
4. Windows, macOS, or Linux
5. [Visual Studio Code](https://code.visualstudio.com/)
6. The following VS Code extensions:
    - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
    - [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
    - [EditorConfig for VS Code](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig)
    - [Python Extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python)

### Setup

```shell
git clone https://github.com/microsoft/vscode-jupyter
cd vscode-jupyter
npm ci
# Run this to setup the necessary pre-commit hooks.
npm run setup-precommit-hook
python3 -m venv .venv
# Activate the virtual environment as appropriate for your shell, For example, on bash it's ...
source .venv/bin/activate
# and in Windows cmd or PowerShell
.venv\Scripts\activate
# The Python code in the extension is formatted using Black.
python -m pip install black
# The Python code required in the extension
python -m pip --disable-pip-version-check install -t ./pythonFiles/lib/python --no-cache-dir --implementation py --no-deps --upgrade -r ./requirements.txt
```

### Incremental Build

Run the `Compile` build Tasks from the [Run Build Task...](https://code.visualstudio.com/docs/editor/tasks) command picker (short cut `CTRL+SHIFT+B` or `⇧⌘B`). This will leave build tasks running in the background and which will re-run as files are edited and saved. You can see the output from either task in the Terminal panel (use the selector to choose which output to look at).

You can also compile from the command-line. For a full compile you can use:

```shell
npx gulp prePublishNonBundle
```

For incremental builds you can use the following commands depending on your needs:

```shell
# This will compile everthing, but only watch for changes to the desktop bundle.
npm run compile
# This watches changes to all files, webviews, web version of extension, node version of extension, etc
# This can be resource intensive, as there are a number of bundles created, thus requiring monitoring of files for each of these numerous bundles.
npm run compile-watch-all
```

Sometimes you will need to run `npm run clean` and even `rm -r out dist`.
This is especially true if you have added or removed files.

### Errors and Warnings

TypeScript errors and warnings will be displayed in the `Problems` window of Visual Studio Code.

### Run dev build and validate your changes

To test changes, open the `vscode-jupyter` folder in VSCode, and select the workspace titled `vscode-jupyter`.
Then, open the debug panel by clicking the `Run and Debug` icon on the sidebar, select the `Extension`
option from the top menu, and click start. A new window will launch with the title
`[Extension Development Host]`.

### Running Unit Tests

Note: Unit tests are those in files with extension `.unit.test.ts`.

1. Make sure you have compiled all code (done automatically when using incremental building)
1. Ensure you have disabled breaking into 'Uncaught Exceptions' when running the Unit Tests
1. For the linters and formatters tests to pass successfully, you will need to have those corresponding Python libraries installed locally
1. Run the Tests via the `Unit Tests` launch option.

You can also run them from the command-line (after compiling):

```shell
npm run test:unittests  # runs all unit tests
npm run test:unittests -- --grep='<NAME-OF-SUITE>'
```

_To run only a specific test suite for unit tests:_
Alter the `launch.json` file in the `"Debug Unit Tests"` section by setting the `grep` field:

```js
    "args": [
        "--timeout=60000",
        "--grep", "<suite name>"
    ],
```

...this will only run the suite with the tests you care about during a test run (be sure to set the debugger to run the `Debug Unit Tests` launcher).

### Running Integration Tests (with VS Code)

Note: Integration tests are those in files with extension `*.vscode.test*.ts`.

1. Make sure you have compiled all code (done automatically when using incremental building)
1. Some of the tests require specific virtual environments. Run the 'src/test/datascience/setupTestEnvs.cmd` (or equivalent) to create them.
1. For the linters and formatters tests to pass successfully, you will need to have those corresponding Python libraries installed locally by using the `./requirements.txt` and `build/test-requirements.txt` files
1. Run the tests via `npm run` or the Debugger launch options (you can "Start Without Debugging").

You can also run the tests from the command-line (after compiling):

```shell
npm run testVSCode  # will launch the VSC UI
```

#### Customising the Test Run

If you want to change which tests are run or which version of Python is used,
you can do this by setting environment variables. The same variables work when
running from the command line or launching from within VSCode, though the
mechanism used to specify them changes a little.

-   Setting `CI_PYTHON_PATH` lets you change the version of python the tests are executed with
-   Setting `VSC_JUPYTER_CI_TEST_GREP` lets you filter the tests by name

_`CI_PYTHON_PATH`_

In some tests a Python executable is actually run. The default executable is
`python` (for now). Unless you've run the tests inside a virtual environment,
this will almost always mean Python 2 is used, which probably isn't what you
want.

By setting the `CI_PYTHON_PATH` environment variable you can
control the exact Python executable that gets used. If the executable
you specify isn't on `$PATH` then be sure to use an absolute path.

This is also the mechanism for testing against other versions of Python.

_`VSC_JUPYTER_CI_TEST_GREP`_

This environment variable allows providing a regular expression which will
be matched against suite and test "names" to be run. By default all tests
are run.

For example, to run only the tests in the `DataScience - Kernels Finder` suite (from
[`src/test/datascience/kernel-launcher/kernelFinder.vscode.test.ts`](https://github.com/microsoft/vscode-jupyter/blob/269e0790f9ef6f1571140f0650c6b5fb844f1940/src/test/datascience/kernel-launcher/kernelFinder.vscode.test.ts))
you would set the value to `Kernels Finder`.

Be sure to escape any grep-sensitive characters in your suite name.

In some rare cases in the "system" tests the `VSC_JUPYTER_CI_TEST_GREP`
environment variable is ignored. If that happens then you will need to
temporarily modify the `const defaultGrep =` line in
[`src/test/index.ts`](https://github.com/microsoft/vscode-jupyter/blob/de1bfe1cbebc0f4e570dc4ae7e1ca057abb0533e/src/test/index.ts#L62).

_Launching from VSCode_

In order to set environment variables when launching the tests from VSCode you
should edit the `launch.json` file. For example you can add the following to the
appropriate configuration you want to run to change the interpreter used during
testing:

```js
    "env": {
        "CI_PYTHON_PATH": "/absolute/path/to/interpreter/of/choice/python"
    }
```

_On the command line_

The mechanism to set environment variables on the command line will vary based
on your system, however most systems support a syntax like the following for
setting a single variable for a subprocess:

```shell
VSC_JUPYTER_CI_TEST_GREP=Sorting npm run testVSCode
```

### Testing Python Scripts

The extension has a number of scripts in ./pythonFiles. Tests for these
scripts are found in ./pythonFiles/tests. To run those tests:

-   `python2.7 pythonFiles/tests/run_all.py`
-   `python3 -m pythonFiles.tests`

By default, functional tests are included. To exclude them:

`python3 -m pythonFiles.tests --no-functional`

To run only the functional tests:

`python3 -m pythonFiles.tests --functional`

### Standard Debugging

Clone the repo into any directory, open that directory in VSCode, and use the `Extension` launch option within VSCode.

### Coding Standards

Information on our coding standards can be found [here](https://github.com/Microsoft/vscode-jupyter/blob/main/CODING_STANDARDS.md).
We have CI tests to ensure the code committed will adhere to the above coding standards.

Messages displayed to the user must be localized using/created constants from/in the [localize.ts](https://github.com/Microsoft/vscode-jupyter/blob/main/src/platform/common/utils/localize.ts) file.

## Development process

To effectively contribute to this extension, it helps to know how its
development process works. That way you know not only why the
project maintainers do what they do to keep this project running
smoothly, but it allows you to help out by noticing when a step is
missed or to learn in case someday you become a project maintainer as
well!

### Folder Structure

At a high level we have a bunch of folders. Each high level is described in this wiki [page](https://github.com/microsoft/vscode-jupyter/wiki/Source-Code-Organization)

### Typical workflow

Here's an example of a typical workflow:

1. Sync to main (get your fork's main to match vscode-jupyter's main)
1. Create branch
1. `npm ci`
1. `npm run clean`
1. Start VS code Insiders root
1. CTRL+SHIFT+B and build `Compile Web Views` and `Compile`
1. Make code changes
1. Write and [run](https://github.com/microsoft/vscode-jupyter/blob/29c4be79f64df1858692321b43c3079bb77bdd69/.vscode/launch.json#L252) unit tests if appropriate
1. Test with [`Extension`](https://github.com/microsoft/vscode-jupyter/blob/29c4be79f64df1858692321b43c3079bb77bdd69/.vscode/launch.json#L6) launch task
1. Repeat until works in normal extension
1. Test with [`Extension (web)`](https://github.com/microsoft/vscode-jupyter/blob/29c4be79f64df1858692321b43c3079bb77bdd69/.vscode/launch.json#L34) launch task
1. Run [jupyter notebook server](https://github.com/microsoft/vscode-jupyter/wiki/Connecting-to-a-remote-Jupyter-server-from-vscode.dev) to use in web testing
1. Repeat until works in web extension
1. Write integration tests and [run](https://github.com/microsoft/vscode-jupyter/blob/29c4be79f64df1858692321b43c3079bb77bdd69/.vscode/launch.json#L216) locally.
1. Submit PR
1. Check PR output to make sure tests don't fail.
1. Debug [CI test failures](https://github.com/microsoft/vscode-jupyter/wiki/Tests)

### Helping others

First and foremost, we try to be helpful to users of the extension.
We monitor
[Stack Overflow questions](https://stackoverflow.com/questions/tagged/visual-studio-code+python)
to see where people might need help. We also try to respond to all
issues in some way in a timely manner (typically in less than one
business day, definitely no more than a week). We also answer
questions that reach us in other ways, e.g. Twitter.

For pull requests, we aim to review any externally contributed PR no later
than the next sprint from when it was submitted (see
[Release Cycle](#release-cycle) below for our sprint schedule).

### Release cycle

Planning is done as monthly releases.

The extension aims to do a new release once a month. A
[release plan](https://github.com/Microsoft/vscode-jupyter/labels/release%20plan)
is created for each release to help track anything that requires a
person to do (long-term this project aims to automate as much of the
development process as possible).

All development is actively done in the `main` branch of the
repository. This allows us to have a
[development build](#development-build) which is expected to be stable at
all times. Once we reach a release candidate, it becomes
our [release branch](https://github.com/microsoft/vscode-jupyter/branches).
At that point only what is in the release branch will make it into the next
release.

### Pull requests

Key details that all pull requests are expected to handle should be
in the [pull request template](https://github.com/Microsoft/vscode-jupyter/blob/main/.github/PULL_REQUEST_TEMPLATE.md). We do expect CI to be passing for a pull request before we will consider merging it.

### Versioning

The extension sets the major version be the year of release, the minor version the
release count for that year, and the build number is a number that increments
for every build.
For example the first release in 2021 is `2021.1.<build number>`.

## Releasing

Overall steps for releasing are covered in the
[release plan](https://github.com/Microsoft/vscode-jupyter/labels/release%20plan)
([template](https://github.com/Microsoft/vscode-jupyter/blob/main/.github/release_plan.md)).

### Building a release

To create a release _build_, follow the steps outlined in the [release plan](https://github.com/Microsoft/vscode-jupyter/labels/release%20plan) (which has a [template](https://github.com/Microsoft/vscode-jupyter/blob/main/.github/release_plan.md)).

## Local Build

Steps to build the extension on your machine once you've cloned the repo:

```bash
> npm install -g @vscode/vsce
# Perform the next steps in the vscode-jupyter folder.
> npm ci
> python3 -m pip --disable-pip-version-check install -t ./pythonFiles/lib/python --no-cache-dir --implementation py --no-deps --upgrade -r requirements.txt --no-user
> npm run clean
> npm run package # This step takes around 10 minutes.
```

Resulting in a `ms-toolsai-jupyter-insiders.vsix` file in your `vscode-jupyter` folder.

⚠️ If you made changes to `package.json`, run `npm install` (instead of `npm ci`) to update `package-lock.json` and install dependencies all at once.
