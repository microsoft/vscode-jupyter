"Init signature: property(fget=None, fset=None, fdel=None, doc=None)  
## Docstring:  
Property attribute.  
  
  fget  
    function to be used for getting an attribute value  
  fset  
    function to be used for setting an attribute value  
  fdel  
    function to be used for del'ing an attribute  
  doc  
    docstring  
  
Typical use is to define a managed attribute x:  
  
```python  
class C(object):  
    def getx(self): return self._x  
    def setx(self, value): self._x = value  
    def delx(self): del self._x  
    x = property(getx, setx, delx, \"I'm the 'x' property.\")  
  
Decorators make defining new properties or modifying existing ones easy:  
```  
  
```python  
class C(object):  
    @property  
    def x(self):  
        \"I am the 'x' property.\"  
        return self._x  
    @x.setter  
    def x(self, value):  
        self._x = value  
    @x.deleter  
    def x(self):  
        del self._x  
Type:           type  
```  
## Subclasses:  
abstractproperty, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, _deprecated_property, ..."