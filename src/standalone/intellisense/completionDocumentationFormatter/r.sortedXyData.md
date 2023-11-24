sortedXyData               package:stats               R Documentation  
  
## Create a 'sortedXyData' Object  
  
## Description:  
  
This is a constructor function for the class of ‘sortedXyData’  
objects.  These objects are mostly used in the ‘initial’ function  
for a self-starting nonlinear regression model, which will be of  
the ‘selfStart’ class.  
  
## Usage:  
```r  
sortedXyData(x, y, data)  
```  
## Arguments:  
  
  x: a numeric vector or an expression that will evaluate in  
     ‘data’ to a numeric vector  
  
  y: a numeric vector or an expression that will evaluate in  
     ‘data’ to a numeric vector  
  
    data: an optional data frame in which to evaluate expressions for  
     ‘x’ and ‘y’, if they are given as expressions  
  
## Value:  
  
A ‘sortedXyData’ object. This is a data frame with exactly two  
numeric columns, named ‘x’ and ‘y’.  The rows are sorted so the  
‘x’ column is in increasing order.  Duplicate ‘x’ values are  
eliminated by averaging the corresponding ‘y’ values.  
  
## Author(s):  
  
José Pinheiro and Douglas Bates  
  
## See Also:  
  
‘selfStart’, ‘NLSstClosestX’, ‘NLSstLfAsymptote’,  
‘NLSstRtAsymptote’  
  
## Examples:  
```r  
DNase.2 <- DNase[ DNase$Run == "2", ]  
sortedXyData( expression(log(conc)), expression(density), DNase.2 )  
```