// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { IKernelProvider } from '../../kernels/types';
import { injectable } from 'inversify';

@injectable()
export class InstallPackageTool implements vscode.LanguageModelTool<IAddLogPointToolParams> {
	public static toolName = 'install_package_tool';

	public get name() {
		return InstallPackageTool.toolName;
	}
	public get description() {
		return 'Installs a package into the active kernel of a notebook.';
	}

    constructor(
        private readonly kernelProvider: IKernelProvider
    ) {

    }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IAddLogPointToolParams>, _token?: vscode.CancellationToken) {
		const { notebookUri, packageName, packageVersion } = options.input;

		if (!notebookUri || !packageName) {
			throw new Error('notebookUri and packageName are required parameters.');
		}

		const finalMessageString = `Installing package ${packageName}${packageVersion ? `@${packageVersion}` : ''} into notebook ${notebookUri}`;
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(finalMessageString)
		]);
	}

	prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<IAddLogPointToolParams>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return undefined;
	}
}

export interface IAddLogPointToolParams {
	notebookUri: string;
	packageName: string;
    packageVersion?: string;
}
