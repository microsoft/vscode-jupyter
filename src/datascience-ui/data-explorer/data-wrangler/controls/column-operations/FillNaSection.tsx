import * as React from 'react';
import { inputStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    value: string | number;
}

export class FillNaSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            value: '',
        };
        this.props.setArgs({
            value: '',
            isPreview: true
        })
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px', paddingTop: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '98%' }}>
                    <span>{'New value'}</span>
                    <input
                        value={this.state.value}
                        onChange={this.handleChangeValue}
                        className={'slice-data'}
                        style={inputStyle}
                        autoComplete="on"
                    />
                </div>
            </div>
        );
    }

    private handleChangeValue = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ value: event.currentTarget.value });
        this.props.setArgs({
            value: event.currentTarget.value,
            isPreview: true
        })
    };
}
