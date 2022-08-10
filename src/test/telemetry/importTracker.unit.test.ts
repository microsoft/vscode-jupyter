// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
/* eslint-disable , , @typescript-eslint/no-explicit-any, no-multi-str, no-trailing-spaces */
import { expect } from 'chai';
import rewiremock from 'rewiremock';
import { instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { EventEmitter, NotebookDocument, TextDocument } from 'vscode';

import { IDocumentManager, IVSCodeNotebook } from '../../platform/common/application/types';
import {
    isTestExecution,
    isUnitTestExecution,
    setTestExecution,
    setUnitTestExecution
} from '../../platform/common/constants';
import { disposeAllDisposables } from '../../platform/common/helpers';
import { IDisposable } from '../../platform/common/types';
import { EventName } from '../../platform/telemetry/constants';
import { getTelemetrySafeHashedString } from '../../platform/telemetry/helpers';
import { ImportTracker } from '../../standalone/import-export/importTracker.node';
import { createDocument } from '../datascience/editor-integration/helpers';

suite('Import Tracker', () => {
    const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
    const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();
    let importTracker: ImportTracker;
    let documentManager: TypeMoq.IMock<IDocumentManager>;
    let openedEventEmitter: EventEmitter<TextDocument>;
    let savedEventEmitter: EventEmitter<TextDocument>;
    const pandasHash: string = getTelemetrySafeHashedString('pandas');
    const elephasHash: string = getTelemetrySafeHashedString('elephas');
    const kerasHash: string = getTelemetrySafeHashedString('keras');
    const pysparkHash: string = getTelemetrySafeHashedString('pyspark');
    const sparkdlHash: string = getTelemetrySafeHashedString('sparkdl');
    const numpyHash: string = getTelemetrySafeHashedString('numpy');
    const scipyHash: string = getTelemetrySafeHashedString('scipy');
    const sklearnHash: string = getTelemetrySafeHashedString('sklearn');
    const randomHash: string = getTelemetrySafeHashedString('random');
    const disposables: IDisposable[] = [];
    class Reporter {
        public static eventNames: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];

        public static expectHashes(...hashes: string[]) {
            expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_PERF);
            if (hashes.length > 0) {
                expect(Reporter.eventNames).to.contain(EventName.HASHED_PACKAGE_NAME);
            }

            Reporter.properties.pop(); // HASHED_PACKAGE_PERF
            expect(Reporter.properties).to.deep.equal(hashes.map((hash) => ({ hashedNamev2: hash })));
        }

        public sendTelemetryEvent(eventName: string, properties?: {}, measures?: {}) {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        }
    }

    setup(() => {
        setTestExecution(false);
        setUnitTestExecution(false);

        openedEventEmitter = new EventEmitter<TextDocument>();
        savedEventEmitter = new EventEmitter<TextDocument>();

        documentManager = TypeMoq.Mock.ofType<IDocumentManager>();
        documentManager.setup((a) => a.onDidOpenTextDocument).returns(() => openedEventEmitter.event);
        documentManager.setup((a) => a.onDidSaveTextDocument).returns(() => savedEventEmitter.event);

        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const vscNb = mock<IVSCodeNotebook>();
        const onDidOpenCloseNbEvent = new EventEmitter<NotebookDocument>();
        disposables.push(onDidOpenCloseNbEvent);
        when(vscNb.onDidOpenNotebookDocument).thenReturn(onDidOpenCloseNbEvent.event);
        when(vscNb.onDidCloseNotebookDocument).thenReturn(onDidOpenCloseNbEvent.event);
        when(vscNb.notebookDocuments).thenReturn([]);

        importTracker = new ImportTracker(documentManager.object, instance(vscNb), disposables);
    });
    teardown(() => {
        setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
        setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
        Reporter.properties = [];
        Reporter.eventNames = [];
        Reporter.measures = [];
        rewiremock.disable();
        disposeAllDisposables(disposables);
    });

    function emitDocEvent(code: string, ev: EventEmitter<TextDocument>) {
        const textDoc = createDocument(code, 'foo.py', 1, TypeMoq.Times.atMost(100), true);
        ev.fire(textDoc.object);
    }

    test('Open document', () => {
        emitDocEvent('import pandas\r\n', openedEventEmitter);

        Reporter.expectHashes(pandasHash);
    });

    test('Already opened documents', async () => {
        const doc = createDocument('import pandas\r\n', 'foo.py', 1, TypeMoq.Times.atMost(100), true);
        documentManager.setup((d) => d.textDocuments).returns(() => [doc.object]);
        await importTracker.activate();

        Reporter.expectHashes(pandasHash);
    });

    test('Save document', () => {
        emitDocEvent('import pandas\r\n', savedEventEmitter);

        Reporter.expectHashes(pandasHash);
    });

    test('from <pkg>._ import _, _', () => {
        const elephas = `
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

        emitDocEvent(elephas, savedEventEmitter);
        Reporter.expectHashes(elephasHash, kerasHash);
    });

    test('from <pkg>._ import _', () => {
        const pyspark = `from pyspark.ml.classification import LogisticRegression
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

        emitDocEvent(pyspark, savedEventEmitter);
        Reporter.expectHashes(pysparkHash, sparkdlHash);
    });

    test('import <pkg> as _', () => {
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
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(pandasHash, numpyHash, randomHash);
    });

    test('from <pkg> import _', () => {
        const code = `from scipy import special
def drumhead_height(n, k, distance, angle, t):
   kth_zero = special.jn_zeros(n, k)[-1]
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(scipyHash);
    });

    test('from <pkg> import _ as _', () => {
        const code = `from pandas import DataFrame as df`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(pandasHash);
    });

    test('import <pkg1>, <pkg2>', () => {
        const code = `
def drumhead_height(n, k, distance, angle, t):
   import sklearn, pandas
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(sklearnHash, pandasHash);
    });

    test('Import from within a function', () => {
        const code = `
def drumhead_height(n, k, distance, angle, t):
   import sklearn as sk
   return np.cos(t) * np.cos(n*angle) * special.jn(n, distance*kth_zero)
theta = np.r_[0:2*np.pi:50j]
radius = np.r_[0:1:50j]
x = np.array([r * np.cos(theta) for r in radius])
y = np.array([r * np.sin(theta) for r in radius])
z = np.array([drumhead_height(1, 1, r, theta, 0.5) for r in radius])`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(sklearnHash);
    });

    test('Do not send the same package twice', () => {
        const code = `
import pandas
import pandas`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes(pandasHash);
    });

    test('Ignore relative imports', () => {
        const code = 'from .pandas import not_real';
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes();
    });

    test('Ignore docstring for `from` imports', () => {
        const code = `"""
from numpy import the random function
"""`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes();
    });

    test('Ignore docstring for `import` imports', () => {
        const code = `"""
import numpy for all the things
"""`;
        emitDocEvent(code, savedEventEmitter);
        Reporter.expectHashes();
    });
});
