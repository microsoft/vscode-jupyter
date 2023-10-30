* [Endgame Template](https://github.com/microsoft/vscode-jupyter/blob/main/.github/endgame_plan.md)

## Thursday
- [ ] Ensure that any CI test failures have issues assigned to that area's owner.
- [ ] Work with the build champ to drive the build to green by fixing/disabling tests or pinging area owners to do so.

## Friday
- [ ] Review [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) (Click on "microsoft/vscode-jupyter" on that page) and resolve all High/Severe issues.
  - [ ] Focus on resolving `Critical` and `High` priority issues as others will be addressed in the `debt` week.
  - [ ] Manually add any repository dependencies (if you can't add manually, refer [here](https://docs.opensource.microsoft.com/tools/cg/features/cgmanifest/)). Only add a cgmanifest.json if the components are not NPM or are not dev only.
        Instructions on updating `npm` dependencies in `package.json` & `package-lock.json` can be found [here](https://github.com/microsoft/vscode-jupyter/wiki/Resolving-Component-Governance-and-Dependabot-issues-(updating-package-lock.json)).
- [ ] Create new release branch with format `release/release-YYYY.MM`.
  * Note: The release branch should not be changed after this step (not including hotfixes)
- [ ] Disable [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283). (`...` menu > Settings > Processing of new requests: Disabled)
- [ ] Create a PR to `main` with the following changes... (Warning: this should happen right after creating the release branch. If this is deferred till later, the `main` and `release` branches can diverge significantly, which may cause merge conflicts.)
  - [ ] At this point, the vscode engine version should also be the same as in the release branch- will be bumped when the next release happens
  - [ ] Bump the version number in `main` to the next monthly ("YYYY.M.100") version number (e.g. if the latest is `2022.2.100`, bump it to `2022.3.100`).
    - [ ] Run `npm install` to update `package-lock.json`

## Monday (Debt/Release week)
- [ ] Obtain VS Code [stable RC](https://builds.code.visualstudio.com/builds/stable) for sanity testing
- [ ] Manually run the [Stable pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=284) against the `release/release-YYYY.MM` branch
  - Enable `Publish Extension`, you do not need an approval to build the VSIX.
  - DO NOT ask for approval for the extension publish step, this step should only be done after sanity testing is done and ready to release.
- [ ] Sanity test release candidate VSIX against VS Code RC
  Tip: You can use the dev containers in the this repo for testing against linux (just open the repo and use thd command `Dev Containers: Reopen in Container`)
  - [ ] Windows
    - [ ] win32-x64
    - [ ] win32-arm64
  - [ ] macOS
    - [ ] darwin-x64
    - [ ] darwin-arm64
  - [ ] Linux
    - [ ] linux-arm64
    - [ ] linux-armhf
    - [ ] linux-x64
    - [ ] alpine-arm64
    - [ ] alpine-x64
- [ ] Candidate bug fixes found from sanity test should be checked into `main` and cherry-picked to `release` branch
  - After a candidate fix is merged, a pre-release build can be released by manually running [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283) against the release branch.

### Satelite extensions/npm packages
- [ ] Reach out to the owners of each of these to coordinate the releases (if any).
- JupyterHub (@DonJayamanne)
    - No need to pin VS Code engine
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=521&_a=summary))
    - PreRelease directly from main branch manually ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=520))
- Jupyter (Notebook) Renderers (@DonJayamanne)
    - No need to pin VS Code engine (unless you want to test something against VS Code insiders and not ship to stable users)
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=285))
- Jupyter Powertoys (@DonJayamanne)
    - No need to pin VS Code engine (unless you want to test something against VS Code insiders and not ship to stable users, e.g. depends on some new Jupyter Extension API)
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=305))
- Jupyter Cell Tags (@rebornix)
    - No need to pin VS Code engine
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=388))
- Jupyter KeyMap (@rebornix)
    - No need to pin VS Code engine
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=260))
- Tensorboard (@DonJayamanne)
    - No need to pin VS Code engine
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=531))
    - PreRelease directly from main branch manually ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=530))
- zeromq-prebuilt (@DonJayamanne)
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=466))
    - Release by adding a git tag and pushing it upstream (e.g. 6.0.0-beta.16.8)
    - Can test bundles by manually running and publishing releases to github releases (download and test the bundles manually from github releases)
- @vscode/zeromq (@DonJayamanne)
    - To be done after relesing `zeromq-prebuilt`
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=469))
- @vscode/jupyter-extension (@DonJayamanne)
    - Release directly from main/relese branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=519&_a=summary))
- Gather (@DonJayamanne)
    - No need to pin VS Code engine
    - Release directly from main branch ([pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=290))
-

## Tuesday
- [ ] Make sure [Component Governance](https://dev.azure.com/monacotools/Monaco/_componentGovernance/191876) is happy
- [ ] Release
  - [ ] Verify the PR Pipeline on Github actions is green against the release branch.
  - [ ] Approve the `Publish` stage of the last [Stable pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=284) that's successfully sanity tested.
  - [ ] Ensure a tag with the released version number on the commit that was released was created.
    * This step occurs in the `Publish` Stage of the stable pipeline linked above.
  - [ ] If any steps were unclear or changed in this endgame plan please update the `endgame_plan.md` file to make it clear for the next release

## Wednesday/Thursday (Day of VS Code releasing the next insider version)
- [ ] Bump the engines.vscode version on the `main` branch to point to the next version. For example, from `1.58.0` to `1.59.0`
- [ ] Reenable [the pre-release devops pipeline](https://dev.azure.com/monacotools/Monaco/_build?definitionId=283) (`...` menu > Settings > Processing of new requests: Enabled)

## As needed
- [ ] Determine if a hotfix is needed
  - Use the same `release/release-YYYY.MM` branch
- [ ] Ensure the version in package.json is updated as follows:
  * If released version is `YYYY.MM.100`, then hot fix will be `YYYY.MM.110`
  * If released version is `YYYY.MM.110`, then hot fix will be `YYYY.MM.120`
- [ ] Verify all candidate issues
- [ ] Sanity test release candidate VSIX against VS Code RC
  Tip: You can use the dev containers in the this repo for testing against linux (just open the repo and use thd command `Dev Containers: Reopen in Container`)
  - [ ] Windows
    - [ ] win32-x64
    - [ ]
    - [ ] win32-arm64
  - [ ] macOS
    - [ ] darwin-x64
    - [ ] darwin-arm64
  - [ ] Linux
    - [ ] linux-arm64
    - [ ] linux-armhf
    - [ ] linux-x64
    - [ ] alpine-arm64
    - [ ] alpine-x64
- [ ] Ensure that another tag was created for the new version's commit.
  * If a tag was not pushed, investigate in the  `Publish` Stage of the stable pipeline linked above, and manually add one using: `git tag -a YYYY.MM -m YYYY.MM -s -f`
