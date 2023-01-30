// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import '../../platform/common/extensions';

import { inject, injectable } from 'inversify';

import { Uri } from 'vscode';
import { Identifiers, CodeSnippets } from '../../platform/common/constants';
import { IDisposableRegistry, IConfigurationService } from '../../platform/common/types';
import { DataScience } from '../../platform/common/utils/localize';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { noop } from '../../platform/common/utils/misc';
import {
    INotebookImporter,
    INbConvertInterpreterDependencyChecker,
    INbConvertExportToPythonService
} from '../../kernels/jupyter/types';
import { IFileSystemNode } from '../../platform/common/platform/types.node';

/**
 * Translates a python file into a notebook
 */
@injectable()
export class JupyterImporter implements INotebookImporter {
    public isDisposed: boolean = false;
    // Template that changes markdown cells to have # %% [markdown] in the comments
    private readonly nbconvertBaseTemplateFormat =
        // eslint-disable-next-line no-multi-str
        `{%- extends '{0}' -%}
{% block codecell %}
{1}
{{ super() }}
{% endblock codecell %}
{% block in_prompt %}{% endblock in_prompt %}
{% block input %}{{ cell.source | ipython2python }}{% endblock input %}
{% block markdowncell scoped %}{1} [markdown]
{{ cell.source | comment_lines }}
{% endblock markdowncell %}`;
    private readonly nbconvert5Null = 'null.tpl';
    private readonly nbconvert6Null = 'base/null.j2';
    private template5Promise?: Promise<string | undefined>;
    private template6Promise?: Promise<string | undefined>;

    constructor(
        @inject(IFileSystemNode) private fs: IFileSystemNode,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry,
        @inject(IConfigurationService) private configuration: IConfigurationService,
        @inject(INbConvertInterpreterDependencyChecker)
        private readonly nbConvertDependencyChecker: INbConvertInterpreterDependencyChecker,
        @inject(INbConvertExportToPythonService) private readonly exportToPythonService: INbConvertExportToPythonService
    ) {}

    public async importFromFile(sourceFile: Uri, interpreter: PythonEnvironment): Promise<string> {
        const nbConvertVersion = await this.nbConvertDependencyChecker.getNbConvertVersion(interpreter);
        // Use the jupyter nbconvert functionality to turn the notebook into a python file
        if (nbConvertVersion) {
            // nbconvert 5 and 6 use a different base template file
            // Create and select the correct one
            let template: string | undefined;
            if (nbConvertVersion.major >= 6) {
                if (!this.template6Promise) {
                    this.template6Promise = this.createTemplateFile(true);
                }

                template = await this.template6Promise;
            } else {
                if (!this.template5Promise) {
                    this.template5Promise = this.createTemplateFile(false);
                }

                template = await this.template5Promise;
            }

            let fileOutput: string = await this.exportToPythonService.exportNotebookToPython(
                sourceFile,
                interpreter,
                template
            );
            if (fileOutput.includes('get_ipython()')) {
                fileOutput = this.addIPythonImport(fileOutput);
            }
            return this.addInstructionComments(fileOutput);
        }

        throw new Error(DataScience.jupyterNbConvertNotSupported);
    }

    public dispose = () => {
        this.isDisposed = true;
    };

    private addInstructionComments = (pythonOutput: string): string => {
        const comments = DataScience.instructionComments(this.defaultCellMarker);
        return comments.concat(pythonOutput);
    };

    private get defaultCellMarker(): string {
        return this.configuration.getSettings().defaultCellMarker || Identifiers.DefaultCodeCellMarker;
    }

    private addIPythonImport = (pythonOutput: string): string => {
        return CodeSnippets.ImportIPython.format(this.defaultCellMarker, pythonOutput);
    };

    public async createTemplateFile(nbconvert6: boolean): Promise<string | undefined> {
        // Create a temp file on disk
        const file = await this.fs.createTemporaryLocalFile('.tpl');

        // Write our template into it
        if (file) {
            try {
                // Save this file into our disposables so the temp file goes away
                this.disposableRegistry.push(file);
                await this.fs.writeFile(
                    Uri.file(file.filePath),
                    this.nbconvertBaseTemplateFormat.format(
                        nbconvert6 ? this.nbconvert6Null : this.nbconvert5Null,
                        this.defaultCellMarker
                    )
                );

                // Now we should have a template that will convert
                return file.filePath;
            } catch {
                noop();
            }
        }
    }
}
