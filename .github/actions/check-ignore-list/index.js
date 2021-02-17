const core = require('@actions/core');
const github = require('@actions/github');
const octokit = require('@octokit/core');
const plugin = require('@octokit/plugin-paginate-rest');
const cp = require('child_process');

async function getChangedFiles() {
    const payload = github.context.payload;
    const MyOctokit = octokit.Octokit.plugin(plugin.paginateRest);
    const caller = new MyOctokit();
    if (github.context.eventName === 'pull_request') {
        const changedFiles = await caller.paginate(
            'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
            {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                pull_number: payload.pull_request.number,
                per_page: 100
            },
            (response) => response.data.map((fileData) => fileData.filename)
        );
        return changedFiles;
    } else if (github.context.eventName === 'push') {
        const changedFiles = await caller.paginate(
            'GET /repos/{owner}/{repo}/commits/{ref}',
            {
                owner: payload.repository.owner.login,
                repo: payload.repository.name,
                ref: payload.after,
                per_page: 100
            },
            (response) => response.data.files.map((fileData) => fileData.filename)
        );
        return changedFiles;
    } else {
        return [];
    }
}

async function run() {
    core.debug('Running ignore checker ...');
    try {
        // Get the eslint configuration
        const eslintjrc = require('../../../.eslintrc.js');

        // Get the list of changed files
        const changedFiles = await getChangedFiles();

        // Compare this against the ignored files
        const ignoredFiles = eslintjrc.ignorePatterns;
        const intersection = ignoredFiles.filter((v) => changedFiles.includes(v));

        if (intersection && intersection.length > 0) {
            core.setFailed(`Files are being ignored that should be linted: ${intersection.join('\n')}`);
        }

        // Run a set of stricter eslint rules against changed files only
        core.debug('Running stricter eslint rules on changed files...');
        let res = cp.spawnSync(`npm run lint:transitional ${changedFiles.join(' ')}`);
        if (res.error) {
            core.debug(res.stdout);
            core.debug(res.stderr);
            core.setFailed(`Stricter eslint rule checks failed.`);
        }
    } catch (error) {
        core.setFailed(error.message);
    } finally {
        core.debug('Finished.');
    }
}

run();
