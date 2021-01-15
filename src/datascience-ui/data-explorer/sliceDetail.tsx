import * as React from 'react';
import { Cell } from './cell';

interface ISliceDetailProps {
    highlightedAxis: number,
    index: number,
    shapeComponents: number[] | undefined,
}

export class SliceDetail extends React.Component<ISliceDetailProps> {
    public render() {
        if (this.props.shapeComponents) {
            const shape = this.props.shapeComponents.map((_component, index) => (
                <Cell
                    data={index === this.props.highlightedAxis ? this.props.index.toString() : ':'}
                    selected={index === this.props.highlightedAxis}
                    first={index === 0}
                />
            ));
            return (
                <div style={{ display: 'flex', justifyContent: 'center', alignSelf: 'center' }}>
                    <span>[</span>
                    {shape}
                    <span>]</span>
                </div>
            );
        }
        return null;
    }
}
