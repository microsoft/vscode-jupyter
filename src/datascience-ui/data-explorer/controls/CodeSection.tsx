import * as React from 'react';
import './HistorySection.css';
import { Code } from '../../interactive-common/code';

interface IProps {
    currentVariableName: string | undefined;
    code: string;
    monacoTheme: string;
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
        return (
            <details
                open
                className="slicing-control"
                style={{
                    borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    width: '100%'
                }}
            >
                <summary className="slice-summary">
                    <h3 className="slice-summary-detail">CODE</h3>
                </summary>
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
                        language="python"
                        readOnly={true}
                        version={0}
                        testMode={false}
                        history={undefined}
                        showWatermark={false}
                        monacoTheme={this.props.monacoTheme}
                        hasFocus={false}
                        cursorPos={0}
                        ipLocation={undefined}
                        onCreated={() => {}}
                        onChange={() => {}}
                        disableUndoStack={true}
                        focusPending={0}
                        editorOptions={{ renderFinalNewline: false }}
                        outermostParentClass=""
                        openLink={() => {}}
                        font={{ size: 12, family: 'var(--vscode-editor-font-family' }}
                    />
                </div>
            </details>
        );
    }
}
