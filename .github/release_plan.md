# Get the build green (Early in endgame week)

- [ ] Ensure that any CI test failures have issues assigned to that area's owner.
- [ ] Work with the build champ to drive the build to green by fixing/disabling tests or pinging area owners to do so.

# Release candidate (Friday of endgame week)
-   [ ] Review [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) (Click on "microsoft/vscode-jupyter" on that page) and resolve all High/Severe issues.
    -   [ ] Focus on resolving `Critical` and `High` priority issues as others will be addressed in the `debt` week.
    -   [ ] Manually add any repository dependencies (if you can't add manually, refer [here](https://docs.opensource.microsoft.com/tools/cg/features/cgmanifest/)). Only add a cgmanifest.json if the components are not NPM or are not dev only.
        Instructions on updating `npm` dependencies in `package.json` & `package-lock.json` can be found [here](https://github.com/microsoft/vscode-jupyter/wiki/Resolving-Component-Governance-and-Dependabot-issues-(updating-package-lock.json)).
-   [ ] Create new release branch with format `release/release-YYYY.MM.100`.
    -   [ ] Update [`ThirdPartyNotices-Repository.txt`](https://github.com/Microsoft/vscode-jupyter/blob/main/ThirdPartyNotices-Repository.txt) as appropriate. This file is manually edited so you can check with the teams if anything needs to be added here.
-   [ ] Disable [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283). (`...` menu > Settings > Processing of new requests: Disabled)
-   [ ] Create a PR to `main` with the following changes... (Warning: this should happen right after creating the release branch. If this is deferred till later, the `main` and `release` branches can diverge significantly, which may cause merge conflicts.)
    -   [ ] Merge the changes from release (ThirdPartyNotices) into `main` branch
    -   [ ] At this point, the vscode engine version should also be the same as in the release branch- will be bumped when the next release happens
    -   [ ] Bump the version number to the next monthly ("YYYY.M.100") version number (e.g. if the latest is `2022.2.100`, bump it to `2022.3.100`).
        -   [ ] Run `npm install` to update `package-lock.json`
-   [ ] Schedule a sanity test. Ask team for specific areas that need testing.
-   [ ] Ask CTI (Python Tools CTI) to test the release candidate
    -   Test plan document: https://github.com/microsoft/vscode-jupyter/blob/main/.github/test_plan.md

# Testing (Monday of VS Code release week)

-  [ ] Obtain VS Code [stable RC](https://builds.code.visualstudio.com/builds/stable) for sanity testing
-  [ ] Sanity test release candidate VSIX against VS Code RC
   -   Make sure that the sanity test hits both macOS and Windows builds
-  [ ] Candidate bug fixes found from sanity test should be checked into `main` and cherry-picked to `release` branch
   -   After a candidate fix is merged, a pre-release build can be released by manually running [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283) against the release branch.

# Release (Tuesday or day before VS Code publishes, whichever is later)

## Preparation

-   [ ] Make sure [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) is happy

## Release

-   [ ] Verify the PR Pipeline on Github actions is green against the release branch.
-   [ ] Manually run the [Stable pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=284) against the `release/release-YYYY.MM.100` branch
-   [ ] Approve the `Publish` stage
-   [ ] Push a tag with the released version number on the commit that was released
-   [ ] If any steps were unclear or changed in this release plan please update the `release_plan.md` file to make it clear for the next release

# Day of VS Code releasing the next insider version (Wednesday)
-   [ ] Bump the engines.vscode version on the `main` branch to point to the next version. For example, from `1.58.0` to `1.59.0`
-   [ ] Reenable [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283) (`...` menu > Settings > Processing of new requests: Enabled)

# As needed

-   [ ] Determine if a hotfix is needed
    -   [ ] Ensure the version in package.json is updated as follows:
        * If released version is `YYYY.MM.100`, then hot fix will be `YYYY.MM.110`
        * If released version is `YYYY.MM.110`, then hot fix will be `YYYY.MM.120`
