// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable , , @typescript-eslint/no-explicit-any, no-multi-str, no-trailing-spaces */
import * as sinon from 'sinon';
import { assert, expect } from 'chai';
import { instance, mock, when } from 'ts-mockito';
import {
    EventEmitter,
    NotebookCellExecutionState,
    NotebookCellExecutionStateChangeEvent,
    NotebookCellKind,
    NotebookDocument
} from 'vscode';

import { IVSCodeNotebook, IWorkspaceService } from '../../platform/common/application/types';
import {
    InteractiveWindowView,
    isTestExecution,
    isUnitTestExecution,
    JupyterNotebookView,
    setTestExecution,
    setUnitTestExecution
} from '../../platform/common/constants';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IDisposable } from '../../platform/common/types';
import { EventName } from '../../platform/telemetry/constants';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { ImportTracker } from './importTracker';
import { ResourceTypeTelemetryProperty, getTelemetryReporter } from '../../telemetry';
import { waitForCondition } from '../../test/common';
import { createMockedNotebookDocument } from '../../test/datascience/editor-integration/helpers';

suite('Import Tracker', async () => {
    const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
    const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();
    let importTracker: ImportTracker;
    let onDidChangeNotebookCellExecutionState: EventEmitter<NotebookCellExecutionStateChangeEvent>;
    let onDidOpenNbEvent: EventEmitter<NotebookDocument>;
    let onDidCloseNbEvent: EventEmitter<NotebookDocument>;
    let onDidSaveNbEvent: EventEmitter<NotebookDocument>;
    let vscNb: IVSCodeNotebook;
    let pandasHash: string;
    let elephasHash: string;
    let kerasHash: string;
    let pysparkHash: string;
    let sparkdlHash: string;
    let numpyHash: string;
    let scipyHash: string;
    let sklearnHash: string;
    let randomHash: string;
    let disposables: IDisposable[] = [];
    class Reporter {
        public static eventNames: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];

        public static async expectHashes(
            when: 'onExecution' | 'onOpenCloseOrSave' = 'onOpenCloseOrSave',
            resourceType: ResourceTypeTelemetryProperty['resourceType'] = undefined,
            ...hashes: string[]
        ) {
            if (hashes.length > 0) {
                await waitForCondition(
                    async () => {
                        expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_NAME);
                        return true;
                    },
                    1_000,
                    'Hashed package name event not sent'
                );
                expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_NAME);
                await waitForCondition(
                    async () => {
                        Reporter.properties.filter((item) => Object.keys(item).length).length === hashes.length;
                        return true;
                    },
                    1_000,
                    () =>
                        `Incorrect number of hashed package name events sent. Expected ${hashes.length}, got ${
                            Reporter.properties.filter((item) => Object.keys(item).length).length
                        }, with values ${JSON.stringify(
                            Reporter.properties.filter((item) => Object.keys(item).length)
                        )}`
                );
            }
            const properties = Reporter.properties.filter((item) => Object.keys(item).length);
            const expected = resourceType
                ? hashes.map((hash) => ({ hashedNamev2: hash, when, resourceType }))
                : hashes.map((hash) => ({ hashedNamev2: hash, when }));
            assert.deepEqual(
                properties.sort((a, b) => a.hashedNamev2.localeCompare(b.hashedNamev2)),
                expected.sort((a, b) => a.hashedNamev2.localeCompare(b.hashedNamev2)),
                `Hashes not sent correctly, expected ${JSON.stringify(expected)} but got ${JSON.stringify(properties)}`
            );
        }

        public sendTelemetryEvent(eventName: string, properties?: {}, measures?: {}) {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        }
    }
    suiteSetup(async () => {
        pandasHash = await getTelemetrySafeHashedString('pandas');
        elephasHash = await getTelemetrySafeHashedString('elephas');
        kerasHash = await getTelemetrySafeHashedString('keras');
        pysparkHash = await getTelemetrySafeHashedString('pyspark');
        sparkdlHash = await getTelemetrySafeHashedString('sparkdl');
        numpyHash = await getTelemetrySafeHashedString('numpy');
        scipyHash = await getTelemetrySafeHashedString('scipy');
        sklearnHash = await getTelemetrySafeHashedString('sklearn');
        randomHash = await getTelemetrySafeHashedString('random');
    });
    setup(() => {
        const reporter = getTelemetryReporter();
        sinon.stub(reporter, 'sendTelemetryEvent').callsFake((eventName: string, properties?: {}, measures?: {}) => {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        });
        setTestExecution(false);
        setUnitTestExecution(false);

        vscNb = mock<IVSCodeNotebook>();
        onDidOpenNbEvent = new EventEmitter<NotebookDocument>();
        onDidCloseNbEvent = new EventEmitter<NotebookDocument>();
        onDidSaveNbEvent = new EventEmitter<NotebookDocument>();
        onDidChangeNotebookCellExecutionState = new EventEmitter<NotebookCellExecutionStateChangeEvent>();
        disposables.push(onDidOpenNbEvent);
        disposables.push(onDidCloseNbEvent);
        disposables.push(onDidSaveNbEvent);
        when(vscNb.onDidOpenNotebookDocument).thenReturn(onDidOpenNbEvent.event);
        when(vscNb.onDidCloseNotebookDocument).thenReturn(onDidCloseNbEvent.event);
        when(vscNb.onDidSaveNotebookDocument).thenReturn(onDidSaveNbEvent.event);
        when(vscNb.onDidChangeNotebookCellExecutionState).thenReturn(onDidChangeNotebookCellExecutionState.event);
        when(vscNb.notebookDocuments).thenReturn([]);
        const workspace = mock<IWorkspaceService>();
        when(workspace.getConfiguration('telemetry')).thenReturn({
            inspect: () => {
                return {
                    key: 'enableTelemetry',
                    globalValue: true
                };
            }
        } as any);
        importTracker = new ImportTracker(instance(vscNb), disposables, instance(workspace));
    });
    teardown(() => {
        sinon.restore();
        setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
        setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
        Reporter.properties = [];
        Reporter.eventNames = [];
        Reporter.measures = [];
        disposables = dispose(disposables);
    });

    test('Open document', async () => {
        const code = `import pandas\r\n`;
        const nb = createMockedNotebookDocument([{ kind: NotebookCellKind.Code, languageId: 'python', value: code }]);
        onDidOpenNbEvent.fire(nb);

        await Reporter.expectHashes('onOpenCloseOrSave', 'notebook', pandasHash);
    });
    test('Close document', async () => {
        const code = `import pandas\r\n`;
        const nb = createMockedNotebookDocument([{ kind: NotebookCellKind.Code, languageId: 'python', value: code }]);
        onDidCloseNbEvent.fire(nb);

        await Reporter.expectHashes('onOpenCloseOrSave', 'notebook', pandasHash);
    });
    test('Save document', async () => {
        const code = `import pandas\r\n`;
        const nb = createMockedNotebookDocument([{ kind: NotebookCellKind.Code, languageId: 'python', value: code }]);
        onDidSaveNbEvent.fire(nb);

        await Reporter.expectHashes('onOpenCloseOrSave', 'notebook', pandasHash);
    });

    test('Already opened documents', async () => {
        const code = `import pandas\r\n`;
        const nb = createMockedNotebookDocument([{ kind: NotebookCellKind.Code, languageId: 'python', value: code }]);
        when(vscNb.notebookDocuments).thenReturn([nb]);

        await importTracker.activate();

        await Reporter.expectHashes('onOpenCloseOrSave', 'notebook', pandasHash);
    });
    async function testImports(
        code: string,
        notebookType: typeof JupyterNotebookView | typeof InteractiveWindowView,
        ...expectedPackageHashes: string[]
    ) {
        const nb = createMockedNotebookDocument(
            [{ kind: NotebookCellKind.Code, languageId: 'python', value: code }],
            undefined,
            undefined,
            notebookType
        );
        when(vscNb.notebookDocuments).thenReturn([nb]);

        await importTracker.activate();

        await Reporter.expectHashes(
            'onOpenCloseOrSave',
            notebookType === 'jupyter-notebook' ? 'notebook' : 'interactive',
            ...expectedPackageHashes
        );
    }
    test('from <pkg>._ import _, _', async () => {
        const code = `
            from elephas.java import java_classes, adapter
            from keras.models import Sequential
            from keras.layers import Dense

            model = Sequential()
            model.add(Dense(units=64, activation='relu', input_dim=100))
            model.add(Dense(units=10, activation='softmax'))
            model.compile(loss='categorical_crossentropy', optimizer='sgd', metrics=['accuracy'])

            model.save('test.h5')

            kmi = java_classes.KerasModelImport
            file = java_classes.File("test.h5")

            java_model = kmi.importKerasSequentialModelAndWeights(file.absolutePath)

            weights = adapter.retrieve_keras_weights(java_model)
            model.set_weights(weights)`;
        await testImports(code, 'jupyter-notebook', elephasHash, kerasHash);
    });

    test('from <pkg>._ import _', async () => {
        const code = `from pyspark.ml.classification import LogisticRegression
            from pyspark.ml.evaluation import MulticlassClassificationEvaluator
            from pyspark.ml import Pipeline
            from sparkdl import DeepImageFeaturizer

            featurizer = DeepImageFeaturizer(inputCol="image", outputCol="features", modelName="InceptionV3")
            lr = LogisticRegression(maxIter=20, regParam=0.05, elasticNetParam=0.3, labelCol="label")
            p = Pipeline(stages=[featurizer, lr])

            model = p.fit(train_images_df)    # train_images_df is a dataset of images and labels

            # Inspect training error
            df = model.transform(train_images_df.limit(10)).select("image", "probability",  "uri", "label")
            predictionAndLabels = df.select("prediction", "label")
            evaluator = MulticlassClassificationEvaluator(metricName="accuracy")
            print("Training set accuracy = " + str(evaluator.evaluate(predictionAndLabels)))`;

        await testImports(code, 'interactive', pysparkHash, sparkdlHash);
    });

    test('import <pkg> as _', async () => {
        const code = `import pandas as pd
    import numpy as np
    import random as rnd

    def simplify_ages(df):
        df.Age = df.Age.fillna(-0.5)
        bins = (-1, 0, 5, 12, 18, 25, 35, 60, 120)
        group_names = ['Unknown', 'Baby', 'Child', 'Teenager', 'Student', 'Young Adult', 'Adult', 'Senior']
        categories = pd.cut(df.Age, bins, labels=group_names)
        df.Age = categories
        return df`;

        await testImports(code, 'interactive', pandasHash, numpyHash, randomHash);
    });

    test('from <pkg> import _', async () => {
        const code = `from scipy import special
    def drumhead_height(n, k, distance, angle, t):
       kth_zero = special.jn_zeros(n, k)[-1]
       return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
    theta = np.r_[0:2*np.pi:50j]
    radius = np.r_[0:1:50j]
    x = np.array([r * np.cos(theta) for r in radius])
    y = np.array([r * np.sin(theta) for r in radius])
    z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;

        await testImports(code, 'interactive', scipyHash);
    });

    test('from <pkg> import _ as _', async () => {
        const code = `from pandas import DataFrame as df`;
        await testImports(code, 'jupyter-notebook', pandasHash);
    });

    test('import <pkg1>, <pkg2>', async () => {
        const code = `
    def drumhead_height(n, k, distance, angle, t):
       import sklearn, pandas
       return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
    theta = np.r_[0:2*np.pi:50j]
    radius = np.r_[0:1:50j]
    x = np.array([r * np.cos(theta) for r in radius])
    y = np.array([r * np.sin(theta) for r in radius])
    z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        await testImports(code, 'interactive', sklearnHash, pandasHash);
    });

    test('Import from within a function', async () => {
        const code = `
    def drumhead_height(n, k, distance, angle, t):
       import sklearn as sk
       return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
    theta = np.r_[0:2*np.pi:50j]
    radius = np.r_[0:1:50j]
    x = np.array([r * np.cos(theta) for r in radius])
    y = np.array([r * np.sin(theta) for r in radius])
    z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;

        await testImports(code, 'interactive', sklearnHash);
    });

    test('Do not send the same package twice', async () => {
        const code = `
    import pandas
    import pandas`;
        await testImports(code, 'interactive', pandasHash);
    });

    test('Ignore relative imports', async () => {
        const code = 'from .pandas import not_real';
        await testImports(code, 'interactive');
    });
    test('Track packages when a cell is executed', async () => {
        const code = `import numpy`;
        const nb = createMockedNotebookDocument([{ kind: NotebookCellKind.Code, languageId: 'python', value: code }]);
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Pending });

        await Reporter.expectHashes('onExecution', 'notebook', numpyHash);

        // Executing the cell multiple will have no effect, the telemetry is only sent once.
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Pending });
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Executing });
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Idle });
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Pending });
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Executing });
        onDidChangeNotebookCellExecutionState.fire({ cell: nb.cellAt(0), state: NotebookCellExecutionState.Idle });

        await Reporter.expectHashes('onExecution', 'notebook', numpyHash);
    });
});
