import * as React from 'react';
import { DataWranglerCommands, INormalizeColumnRequest } from '../../../../../client/datascience/data-viewing/data-wrangler/types';

interface IProps {
    selectedColumn: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submitCommand(data: { command: string; args: any }): void;
    setColumns(cols: number[]): void;
}

interface IState {
    normalizeRangeStart: number;
    normalizeRangeEnd: number;
}

export class NormalizeDataSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            normalizeRangeStart: 0,
            normalizeRangeEnd: 1
        };
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100px' /* paddingTop: '6px' */ }}>
                    <span>{'New start range:'}</span>
                    <input
                        value={this.state.normalizeRangeStart}
                        onChange={this.handleNormalizeStartChange}
                        className={'slice-data'}
                        style={{ width: '140px', marginTop: '4px', marginBottom: '16px' }}
                        autoComplete="on"
                    />
                    <span>{'New end range:'}</span>
                    <input
                        value={this.state.normalizeRangeEnd}
                        onChange={this.handleNormalizeEndChange}
                        className={'slice-data'}
                        style={{ width: '140px', marginTop: '4px', marginBottom: '16px' }}
                        autoComplete="on"
                    />
                    <button
                        onClick={() => {
                                this.props.submitCommand({
                                    command: DataWranglerCommands.NormalizeColumn,
                                    args: {
                                        start: this.state.normalizeRangeStart,
                                        end: this.state.normalizeRangeEnd,
                                        targetColumn: this.props.selectedColumn
                                    } as INormalizeColumnRequest
                                });
                            }
                        }
                        style={{
                            backgroundColor: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            margin: '4px',
                            padding: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            height: '26px',
                            marginLeft: '0px'
                        }}
                    >
                        Normalize
                    </button>
                </div>
            </div>
        );
    }

    private handleNormalizeStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeStart: +event.currentTarget.value });
    };

    private handleNormalizeEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeEnd: +event.currentTarget.value });
    };
}
