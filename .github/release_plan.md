# Prerequisites

-   Python 3.7 and higher
-   run `python3 -m pip install --user -r news/requirements.txt`

# Release candidate (Monday, XXX XX)

-   [ ] Update [Component Governance](https://dev.azure.com/vscode-python-datascience/vscode-python-datascience/_componentGovernance) (Click on "microsoft/vscode-jupyter" on that page). Notes are in the OneNote under Python VS Code -> Dev Process -> Component Governance.
    -   [ ] Provide details for any automatically detected npm dependencies
    -   [ ] Manually add any repository dependencies
-   [ ] Create new release branch with format `release-YYYY.MM`
    -   [ ] Create a pull request against `release-YYYY.MM` for changes
    -   [ ] Run `npm install` to make sure [`package-lock.json`](https://github.com/Microsoft/vscode-jupyter/blob/main/package.json) is up-to-date
    -   [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-jupyter/blob/main/CHANGELOG.md)
        -   [ ] Run [`news`](https://github.com/Microsoft/vscode-jupyter/tree/main/news) (typically `python news --final --update CHANGELOG.md | code-insiders -`)
        -   [ ] Copy over the "Thanks" section from the previous release into the "Thanks" section for the new release
        -   [ ] Make sure the "Thanks" section is up-to-date (e.g. compare to versions in [`requirements.txt`](https://github.com/microsoft/vscode-jupyter/blob/main/requirements.txt))
        -   [ ] Touch up news entries (e.g. add missing periods)
        -   [ ] Check the Markdown rendering to make sure everything looks good
    -   [ ] Update [`ThirdPartyNotices-Distribution.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Distribution.txt) by using https://dev.azure.com/vscode-python-datascience/vscode-python-datascience/_componentGovernance and downloading the notice (Notes for this process are in the Team OneNote under Python VS Code -> Dev Process -> Third-Party Notices / TPN file)
    -   [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Repository.txt) as appropriate. This file is manually edited so you can check with the teams if anything needs to be added here.
    -   [ ] Update the `vscode` version number in the `engines` section of package.json. Update to the next upcoming major version. So if current stable VS Code is `1.54.3` update to `^1.55.0`.
    -   [ ] Merge pull request into `release-YYYY.MM`
-   [ ] Update the [`release` branch](https://github.com/microsoft/vscode-jupyter/branches)
    -   [ ] If there are `release` branches that are two versions old (e.g. release-2020.[current month - 2]) you can delete them at this time
-   [ ] Update `main` post-release
    -   [ ] Bump the version number to the next monthly ("YYYY.MM.0") release in the `main` branch
        -   [ ] `package.json`
        -   [ ] `package-lock.json`
    -   [ ] Merge the changes from release (Changelog, delete news, ThirdPartyNotices) into `main` branch
    -   [ ] Create a pull request against `main`
    -   [ ] Merge pull request into `main`
-   [ ] GDPR bookkeeping (@greazer) (🤖; Notes in OneNote under Python VS Code -> Dev Process -> GDPR)
-   [ ] Open appropriate [documentation issues](https://github.com/microsoft/vscode-docs/issues?q=is%3Aissue+is%3Aopen+label%3Apython)
    -   new features
    -   settings changes
    -   etc. (ask the team)
-   [ ] Schedule a bug bash. Aim for close after freeze so there is still time to fix release bugs before release. Ask teams before bash for specific areas that need testing.
-   [ ] Begin drafting a [blog](http://aka.ms/pythonblog) post. Contact the PM team for this.
-   [ ] Ask CTI to test the release candidate

# Final (Monday, XXX XX)

## Preparation

-   [ ] Make sure the [appropriate pull requests](https://github.com/microsoft/vscode-docs/pulls) for the [documentation](https://code.visualstudio.com/docs/python/python-tutorial) -- including the [WOW](https://code.visualstudio.com/docs/languages/python) page -- are ready
-   [ ] Final updates to the `release-YYYY.MM` branch
    -   [ ] Create a branch against `release-YYYY.MM` for a pull request
    -   [ ] Update the version in [`package.json`](https://github.com/Microsoft/vscode-jupyter/blob/main/package.json) to remove the `-rc` (🤖)
    -   [ ] Run `npm install` to make sure [`package-lock.json`](https://github.com/Microsoft/vscode-jupyter/blob/main/package.json) is up-to-date (the only update should be the version number if `package-lock.json` has been kept up-to-date) (🤖)
    -   [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-jupyter/blob/main/CHANGELOG.md) (🤖)
        -   [ ] Update version and date for the release section
        -   [ ] Run [`news`](https://github.com/Microsoft/vscode-jupyter/tree/main/news) and copy-and-paste new entries (typically `python news --final | code-insiders -`; quite possibly nothing new to add)
    -   [ ] Update [`ThirdPartyNotices-Distribution.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Distribution.txt) by using https://tools.opensource.microsoft.com/notice (🤖; see team notes)
    -   [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Repository.txt) manually if necessary
    -   [ ] Create pull request against `release-YYYY.MM` (🤖)
    -   [ ] Merge pull request into `release-YYYY.MM`
-   [ ] Make sure component governance is happy
-   [ ] Turn off automatic uploads for insider builds from main. This prevents stable customers from getting insiders builds as they have the same engine version and higher build numbers.

## Release

-   [ ] Publish the release
    -   [ ] For an automated release
        -   [ ] Create a commit which contains the words `publish` and `release` in it (you can use --allow-empty if needed)
        -   [ ] Directly push (PR not required) the commit to the `release-xxxx.xx` branch
        -   [ ] This commit will trigger the `release` stage to run after smoke tests. [Example run](https://github.com/microsoft/vscode-jupyter/actions/runs/702919634)
        -   [ ] For release branches a mail will be sent to verify that the release should be published. Click the `Review pending deployments` button on the mail and deploy from the GitHub page. This will publish the release on the marketplace.
        -   [ ] A draft [GitHub release](https://github.com/microsoft/vscode-jupyter/releases) entry will have been created. 
        -   [ ] Update the tag on the release if needed and publish the GitHub release
    -   [ ] For manual (if needed as automatic should be tried first)
        -   [ ] Download the [Release VSIX](https://pvsc.blob.core.windows.net/extension-builds-jupyter/ms-toolsai-jupyter-release.vsix) & Make sure no extraneous files are being included in the `.vsix` file (make sure to check for hidden files)
        -   [ ] Go to https://marketplace.visualstudio.com/manage/publishers/ms-toolsai?noPrompt=true and upload the VSIX
            -   [ ] If there's errors, try diffing against old vsix that worked
        -   [ ] Go to https://github.com/microsoft/vscode-jupyter/releases and add a new release
            -   [ ] Tag is version number
            -   [ ] Branch is release branch
            -   [ ] Copy contents of release branch changelog into the release (just copy the markdown)
            -   [ ] Save
-   [ ] Publish [documentation changes](https://github.com/Microsoft/vscode-docs/pulls?q=is%3Apr+is%3Aopen+label%3Apython)
-   [ ] Publish the [blog](http://aka.ms/pythonblog) post
-   [ ] Determine if a hotfix is needed
-   [ ] Merge `release-YYYY.MM` back into `main`. Don't overwrite the version in package.json. (🤖)

## Clean up after _this_ release

-   [ ] Go through [`info needed` issues](https://github.com/Microsoft/vscode-jupyter/issues?q=is%3Aopen+label%3A%22info+needed%22+-label%3A%22data+science%22+sort%3Aupdated-asc) and close any that have no activity for over a month (🤖)
-   [ ] GDPR bookkeeping (🤖)
-   [ ] When a new engine update is released for VS Code insiders update the engine version in main and turn insiders builds back on. With the engine updated it will not be shipped to stable customers.
-   [ ] If any steps were unclear or changed in this release plan please update the `release_plan.md` file to make it clear for the next release

## Prep for the _next_ release

-   [ ] Create a new [release plan](https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/.github/release_plan.md) (🤖)
-   [ ] [(Un-)pin](https://help.github.com/en/articles/pinning-an-issue-to-your-repository) [release plan issues](https://github.com/Microsoft/vscode-jupyter/labels/release%20plan) (🤖)
