# Prerequisites

-   Python 3.7 and higher
-   run `python3 -m pip install --user -r news/requirements.txt`

# Get the build green (Early in endgame week)

- [ ] Ensure that any CI test failures have issues assigned to that area's owner.
- [ ] Drive the build to green by fixing/disabling tests or pinging area owners to do so.

# Move open issues (Tuesday of VS Code endgame week, XXX XX)

- [ ] Ask the team to move all open issues to next milestone or remove milestone and put back in triage. This allows endgame champ to have a better understanding of done state.
- [ ] Schedule a bugbash if needed.

# Release candidate (Friday of VS Code endgame week, XXX XX)

-   [ ] Review [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) (Click on "microsoft/vscode-jupyter" on that page) and resolve all High/Severe issues.

    -   [ ] Focus on resolving `Critical` and `High` priority issues as others will be addressed in the `debt` week.
    -   [ ] Manually add any repository dependencies (if you can't add manually, refer [here](https://docs.opensource.microsoft.com/tools/cg/features/cgmanifest/)). Only add a cgmanifest.json if the components are not NPM or are not dev only.
        Instructions on updating `npm` dependencies in `package.json` & `package-lock.json` can be found [here](https://github.com/microsoft/vscode-jupyter/wiki/Resolving-Component-Governance-and-Dependabot-issues-(updating-package-lock.json)).
-   [ ] Create new release branch with format `release/release-YYYY.MM.100`
    -   [ ] Create a pull request against `release/release-YYYY.MM.100` for changes
    -   [ ] Bump the vscode engine version in package.json
    -   [ ] Run `npm install` to verify `package-lock.json` did not get updated aside from the vscode engine version.
        -   If there are minor changes, they can be just be updated in the release branch and later ported back to main.
    -   [ ] Update [`CHANGELOG.md`](https://github.com/Microsoft/vscode-jupyter/blob/main/CHANGELOG.md)
        -   [ ] Run [`news`](https://github.com/Microsoft/vscode-jupyter/tree/main/news) (typically `python news --final --update CHANGELOG.md | code-insiders -`)
        -   [ ] Update the date at the top to when the release is planned.
        -   [ ] Copy over the "Thanks" section from the previous release into the "Thanks" section for the new release
        -   [ ] Make sure the "Thanks" section is up-to-date (e.g. compare to versions in [`requirements.txt`](https://github.com/microsoft/vscode-jupyter/blob/main/requirements.txt))
        -   [ ] Touch up news entries (e.g. add missing periods)
        -   [ ] Check the Markdown rendering to make sure everything looks good
    -   [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Repository.txt) as appropriate. This file is manually edited so you can check with the teams if anything needs to be added here.
    -   [ ] Merge pull request into `release/release-YYYY.MM.100`
-   [ ] Update the [`release` branch](https://github.com/microsoft/vscode-jupyter/branches)
    -   [ ] If there are `release` branches that are two versions old (e.g. `release-2020.[current month - 2].100`) you can delete them at this time (you would have to un-protect the release branches temporarily to delete them).
-   [ ] Update `main` after creating the release branch. (Warning: this should happen right after creating the release branch. If this is deferred till later, the `main` and `release` branches can diverge significantly, which may cause merge conflicts.)
    -   [ ] Merge the changes from release (Changelog, delete news, ThirdPartyNotices) into `main` branch
    -   [ ] Bump the version number to the next monthly ("YYYY.M.100") release in the `main` branch
        - If latest is `2022.2.100`, them bump it to `2022.3.100`,
        - This ensures the new new pre-release targets the next version.
        -   [ ] `package.json`
        -   [ ] `package-lock.json`
        -   [ ] Confirm the 3rd part of the version ends with `100`.
    -   [ ] Create a pull request against `main`
    -   [ ] Merge pull request into `main`
-   [ ] GDPR bookkeeping (🤖)
    - https://gdpr.datasmart.ms/ search `EntityName like 'ms-toolsai.jupyter/%' and complete = 'false'`
    - Typically just update columns DataClassification, BusinessJustification, InteralOnly, Suppressed, Retired
        - Suspected PII requires more
-   [ ] Open appropriate [documentation issues](https://github.com/microsoft/vscode-docs/issues?q=is%3Aissue+is%3Aopen+label%3Apython)
    -   new features
    -   settings changes
    -   etc. (ask the team)
-   [ ] Release notes from VS Code have something about Jupyter
    -   Example doc update [here](https://github.com/microsoft/vscode-docs/pull/5256)
-   [ ] Schedule a sanity test. Aim for close after freeze so there is still time to fix release bugs before release. Ask teams before bash for specific areas that need testing.
-   [ ] Ensure that closed issues targeting this release will be verfied, asking for verification steps if needed. Sanity test can be used to help with this.
    -   `is:issue sort:updated-desc milestone:"<milestone>" label:verification-needed -label:verified`
-   [ ] Ask CTI (Python Tools CTI) to test the release candidate
    -   Test plan document: https://github.com/microsoft/vscode-jupyter/blob/main/.github/test_plan.md

# Testing (Monday of VS Code release week, XXX XX)

-  [ ] Obtain VS Code [prebuild](https://builds.code.visualstudio.com/builds/stable) for sanity testing
-  [ ] Sanity test release candidate VSIX against VS Code prebuild
   -   Make sure that the sanity test hits both macOS and Windows builds
-  [ ] Candidate bug fixes found from sanity test should be checked into `main` and cherry-picked to `release` branch

# Release (Tuesday or day before VS Code publishes, whichever is later)

## Preparation

-   [ ] Make sure the [appropriate pull requests](https://github.com/microsoft/vscode-docs/pulls) for the release notes(https://github.com/microsoft/vscode-docs/blob/vnext/release-notes/v<vscode version>.md, make note of the branch and file name).
    - [ ] Include all new new features under a section named `Jupyter` with screenshots or animated gifs.
    - [ ] Fixes, code health should remain in the Jupyter change log.
-   [ ] Make sure [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) is happy
-   [ ] Make sure there is nothing targeting this release that still needs to be validated
        (`is:issue sort:updated-desc milestone:"<milestone>" label:verification-needed -label:verified`)

## Release

-   [ ] Publish the release
    -   [ ] Verify the PR Pipeline on Github actions is green against the release branch.
    -   [ ] Manually run the [Stable pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=284) against the `release/release-YYYY.MM.100` branch
    -   [ ] Approve the `Publish` stage
    -   [ ] Check if the release was automatically published here, https://github.com/microsoft/vscode-jupyter/releases - If not, publish manually: (This has been required since the move to az pipelines)
        -   [ ] Add a new release at https://github.com/microsoft/vscode-jupyter/releases
            -   Tag is version number
            -   Branch is release branch
            -   Copy contents of release branch changelog into the release (just copy the markdown)
        -   [ ] Publish
-   [ ] Determine if a hotfix is needed
    -   [ ] Ensure the version in package.json is updated as follows:
        * If released version is `YYYY.MM.100`, then hot fix will be `YYYY.MM.110`
        * If released version is `YYYY.MM.110`, then hot fix will be `YYYY.MM.120`

# Day of VS Code publishing (Wednesday, XXX XX)
-   [ ] Go through [`info needed` issues](https://github.com/Microsoft/vscode-jupyter/issues?q=is%3Aopen+sort%3Aupdated-asc+label%3Ainfo-needed) and close any that have no activity for over a month (🤖)
-   [ ] GDPR bookkeeping (🤖)
-   [ ] If any steps were unclear or changed in this release plan please update the `release_plan.md` file to make it clear for the next release

# Day of VS Code releasing the next insider version (Wednesday, XXX XX)
-   [ ] Bump the engines.vscode version on the `main` branch to point to the next insider version. For example, from `1.58.0-insider` to `1.59.0-insider`

## Prep for the _next_ release

-   [ ] Create a new [release plan](https://raw.githubusercontent.com/microsoft/vscode-jupyter/main/.github/release_plan.md) (🤖)
    * Title `<Month> <year> Release Plan`
    * Add the labels `endgame-plan` to this issue
    * Pin this issue
-   [ ] [(Un-)pin](https://help.github.com/en/articles/pinning-an-issue-to-your-repository) [release plan issues](https://github.com/Microsoft/vscode-jupyter/labels/release-plan) (🤖)
