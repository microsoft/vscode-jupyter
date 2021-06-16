import * as React from 'react';
import { Code } from '../../../interactive-common/code';
import { PYTHON_LANGUAGE } from '../../../../client/common/constants';
import { SidePanelSection } from './SidePanelSection';
import { Identifiers } from '../../../../client/datascience/constants';

interface IProps {
    currentVariableName: string | undefined;
    code: string;
    monacoTheme: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    currentVariableIndex: number | undefined;
}

export class CodeSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { currentVariableIndex: 0 };
    }

    render() {
        const codeComponent = (
            <div
                style={{
                    marginLeft: '20px',
                    marginTop: '10px',
                    marginRight: '20px',
                    width: '100%',
                    backgroundColor: 'var(--vscode-editor-background) !important'
                }}
            >
                <Code
                    code={this.props.code.trimEnd()}
                    language={PYTHON_LANGUAGE}
                    readOnly={true}
                    version={0}
                    testMode={false}
                    history={undefined}
                    showWatermark={false}
                    monacoTheme={this.props.monacoTheme}
                    codeTheme={Identifiers.GeneratedThemeName}
                    hasFocus={false}
                    cursorPos={0}
                    ipLocation={undefined}
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    onCreated={() => {}}
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    onChange={() => {}}
                    disableUndoStack={true}
                    focusPending={0}
                    editorOptions={{ renderFinalNewline: false }}
                    outermostParentClass=""
                    // eslint-disable-next-line @typescript-eslint/no-empty-function
                    openLink={() => {}}
                    font={{ size: 12, family: 'var(--vscode-editor-font-family' }}
                    showLineNumbers={false}
                />
            </div>
        );

        return <SidePanelSection title="CODE" panel={codeComponent} />;
    }
}
