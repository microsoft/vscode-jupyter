# To run this file either conda or pip install the following: jupyter, torch, numpy, matplotlib, pandas, tqdm, bokeh, vega_datasets, altair, vega, plotly
# When installing torch please visit https://pytorch.org to identify the install instructions for your OS

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import torch


myNparray = np.array(
    [["Bob", 1, 2, np.inf], ["Alice", 4, np.nan, 6], ["Gina", -np.inf, 8, 9]]
)
myDataFrame = pd.DataFrame(myNparray, columns=["name", "b", "c", "d"])
mySeries = myDataFrame["name"]
myList = [x ** 2 for x in range(0, 100000)]
myString = "testing testing testing"
myTensor = torch.LongTensor([[[1, 2, 3], [4, 5, 6]]])


class Foo:
    def __init__(self):
        self.a = 100
        self.b = [1, 2, 3]


b = ["not this one"]
x = Foo()
print(x.b)  # Should open x.b, not b
