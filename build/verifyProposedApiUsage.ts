// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setFailed, error } from '@actions/core';
import { context } from '@actions/github';
import { spawnSync } from 'child_process';

const commentThatWillIgnoreVerification = `[x] Ignore Proposed API verification`;

function getModifiedPackageJson(): { enabledApiProposals: string[]; engines: { vscode: string } } | undefined {
    try {
        const { stdout, stderr } = spawnSync('git', [`show`, `HEAD:package.json`]);
        if (stdout?.toString().trim().length > 0) {
            return JSON.parse(stdout.toString().trim());
        }
    } catch (ex) {
        return;
    }
}

async function getPackageJsonInMainBranch(
    tag: string
): Promise<{ enabledApiProposals: string[]; engines: { vscode: string } }> {
    // If we can find the latest tag, thats even better.
    const url = `https://raw.githubusercontent.com/microsoft/vscode-jupyter/${tag}/package.json`;
    const response = await fetch(url);
    return await response.json();
}

async function verifyProposedApiUsage() {
    if (context.payload.pull_request?.body?.includes(commentThatWillIgnoreVerification)) {
        console.info(`Proposed API verification is ignored due to override in PR body.`);
        return;
    }
    const modifiedPackageJson = getModifiedPackageJson();
    if (!modifiedPackageJson) {
        return;
    }
    const currentPackageJson = await getPackageJsonInMainBranch('main');
    const currentApiProposals = new Set(currentPackageJson.enabledApiProposals.sort());
    const modifiedApiProposals = modifiedPackageJson.enabledApiProposals;
    const currentEngineVersion = currentPackageJson.engines.vscode;
    const modifiedEngineVersion = modifiedPackageJson.engines.vscode;
    const newApiProposalsAdded = modifiedPackageJson.enabledApiProposals.filter((api) => !currentApiProposals.has(api));
    if (!newApiProposalsAdded.length) {
        return;
    }
    if (newApiProposalsAdded.length && currentEngineVersion !== modifiedEngineVersion) {
        return;
    }

    error(`Solution 1: Update engines.vscode package.json.`);
    error(`Solution 2: Add the comment '${commentThatWillIgnoreVerification}' to the PR body & push a new commit.`);
    setFailed(
        `Proposed API added (${newApiProposalsAdded.join(', ')}) without updating the engines.vscode in package.json.`
    );
}

verifyProposedApiUsage();
