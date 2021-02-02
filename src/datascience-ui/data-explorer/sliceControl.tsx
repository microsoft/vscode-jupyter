import * as React from 'react';
import { IGetSliceRequest } from '../../client/datascience/data-viewing/types';

interface ISliceControlProps {
    originalVariableShape: number[];
    handleSliceRequest(slice: IGetSliceRequest): void;
}

interface ISliceControlState {
    value: string;
}

// Temporary UI entrypoint to slicing functionality until we get a proper UI designed
export class SliceControl extends React.Component<ISliceControlProps, ISliceControlState> {
    constructor(props: ISliceControlProps) {
        super(props);
        this.state = { value: '[' + this.props.originalVariableShape.map(() => ':').join(', ') + ']' };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    public handleChange(event: React.FormEvent<HTMLInputElement>) {
        this.setState({ value: event.currentTarget.value });
    }

    public handleSubmit(event: React.SyntheticEvent) {
        event.preventDefault();
        this.props.handleSliceRequest({ slice: this.state.value, originalVariableShape: this.props.originalVariableShape });
    }

    render() {
        return (
            <div className="slice-data-control-container" style={{ display: 'flex', justifyContent: 'space-around' }}>
                <form onSubmit={this.handleSubmit} style={{ alignSelf: 'center' }}>
                    <label>
                        {'Slice data:  '}
                        <input
                            type="text"
                            className="slice-data"
                            value={this.state.value}
                            onChange={this.handleChange}
                            style={{ width: '80px' }}
                        />
                    </label>
                    <input type="submit" value="Slice" />
                </form>
            </div>
        );
    }
}
